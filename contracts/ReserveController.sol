// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUniswapV2RouterLike {
    function factory() external view returns (address);

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity);
}

interface IUniswapV2FactoryLike {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

/**
 * @title ReserveController
 * @notice Custodies the 20% Public Reserve allocation and may ONLY add liquidity to a single
 *         approved CAPIT/QUOTE pool under strict cooldown + rolling 30-day caps. LP tokens
 *         are forwarded directly to an LP locker.
 *
 * Prohibitions (intentionally absent): swaps, arbitrary withdrawals, arbitrary transfers,
 * generalized execute(), upgradeability.
 */
contract ReserveController {
    using SafeERC20 for IERC20;

    IERC20 public immutable capit;
    IERC20 public immutable quote;
    address public immutable router;
    address public immutable lpPair;
    address public immutable lpLocker;

    address public immutable operator; // protocol multisig

    uint64 public immutable cooldownSeconds;
    uint256 public immutable maxCapitPer30d;
    uint256 public immutable maxQuotePer30d;

    // rolling window tracking
    uint64 public windowStart;
    uint256 public capitUsedInWindow;
    uint256 public quoteUsedInWindow;

    uint64 public lastAddLiquidityAt;

    event LiquidityAdded(
        uint256 capitAmount,
        uint256 quoteAmount,
        uint256 liquidity,
        address router,
        address lpPair,
        address lpLocker,
        uint256 timestamp
    );

    error NotOperator();
    error CooldownActive(uint64 nextAllowedAt);
    error CapExceeded();
    error PairMismatch();

    constructor(
        address _capit,
        address _quote,
        address _router,
        address _lpPair,
        address _lpLocker,
        address _operator,
        uint64 _cooldownSeconds,
        uint256 _maxCapitPer30d,
        uint256 _maxQuotePer30d
    ) {
        require(_capit != address(0) && _quote != address(0), "token=0");
        require(_router != address(0) && _lpPair != address(0) && _lpLocker != address(0), "router/pair/locker=0");
        require(_operator != address(0), "operator=0");

        capit = IERC20(_capit);
        quote = IERC20(_quote);
        router = _router;
        lpPair = _lpPair;
        lpLocker = _lpLocker;
        operator = _operator;

        cooldownSeconds = _cooldownSeconds;
        maxCapitPer30d = _maxCapitPer30d;
        maxQuotePer30d = _maxQuotePer30d;

        windowStart = uint64(block.timestamp);
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    function _rollWindowIfNeeded() internal {
        // 30 days rolling window with reset after 30d elapsed
        if (block.timestamp >= windowStart + 30 days) {
            windowStart = uint64(block.timestamp);
            capitUsedInWindow = 0;
            quoteUsedInWindow = 0;
        }
    }

    function _enforcePair() internal view {
        address factory = IUniswapV2RouterLike(router).factory();
        address pair = IUniswapV2FactoryLike(factory).getPair(address(capit), address(quote));
        if (pair != lpPair) revert PairMismatch();
    }

    /**
     * @notice Adds liquidity to the approved CAPIT/QUOTE pool.
     * @param capitAmount Desired CAPIT amount
     * @param quoteAmount Desired quote amount
     * @param capitMin Min CAPIT amount (slippage guard)
     * @param quoteMin Min quote amount (slippage guard)
     * @param deadline Uniswap deadline
     *
     * LP tokens are sent directly to lpLocker.
     */
    function addLiquidity(
        uint256 capitAmount,
        uint256 quoteAmount,
        uint256 capitMin,
        uint256 quoteMin,
        uint256 deadline
    ) external onlyOperator returns (uint256 usedCapit, uint256 usedQuote, uint256 liquidity) {
        _enforcePair();

        // cooldown
        if (lastAddLiquidityAt != 0 && block.timestamp < lastAddLiquidityAt + cooldownSeconds) {
            revert CooldownActive(uint64(lastAddLiquidityAt + cooldownSeconds));
        }

        _rollWindowIfNeeded();

        // caps
        if (capitUsedInWindow + capitAmount > maxCapitPer30d) revert CapExceeded();
        if (quoteUsedInWindow + quoteAmount > maxQuotePer30d) revert CapExceeded();

        // approve router
        capit.safeIncreaseAllowance(router, capitAmount);
        quote.safeIncreaseAllowance(router, quoteAmount);

        // add liquidity; send LP tokens directly to locker so controller never holds them
        (usedCapit, usedQuote, liquidity) = IUniswapV2RouterLike(router).addLiquidity(
            address(capit),
            address(quote),
            capitAmount,
            quoteAmount,
            capitMin,
            quoteMin,
            lpLocker,
            deadline
        );

        // accounting uses desired amounts (conservative) or actual used amounts? Spec says cap for deployed.
        // Use actual used amounts returned by router.
        capitUsedInWindow += usedCapit;
        quoteUsedInWindow += usedQuote;
        lastAddLiquidityAt = uint64(block.timestamp);

        emit LiquidityAdded(usedCapit, usedQuote, liquidity, router, lpPair, lpLocker, block.timestamp);
    }

    /**
     * @notice Optional recovery for accidental non-core tokens sent to this contract.
     * @dev Strictly prohibits recovering CAPIT and quote.
     */
    function recoverNonCoreToken(address token, address to, uint256 amount) external onlyOperator {
        require(token != address(capit) && token != address(quote), "CORE_TOKEN");
        IERC20(token).safeTransfer(to, amount);
    }
}
