// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title DevVesting
 * @notice Deterministic vesting for CAPIT developer allocation:
 * - No cliff
 * - 12 fixed-length months, where 1 month = 30 days (audit-friendly)
 * - No revoke, no acceleration, no admin override
 * - Beneficiary immutable
 * - Anyone can call release(); tokens always go to beneficiary
 */
contract DevVesting {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable beneficiary;
    uint64 public immutable launchTime; // T0

    uint64 public constant MONTH = 30 days;
    uint8 public constant MONTHS = 12;

    uint256 public immutable totalAllocation; // funded amount
    uint256 public immutable monthlyAmount; // floor(total/12)
    uint256 public immutable roundingRemainder; // total - monthlyAmount*12

    uint256 public released;

    event TokensReleased(address indexed beneficiary, uint256 amount);

    error ZeroAddress();
    error ZeroAllocation();
    error NothingToRelease();

    constructor(
        address _token,
        address _beneficiary,
        uint64 _launchTime,
        uint256 _totalAllocation
    ) {
        if (_token == address(0) || _beneficiary == address(0)) revert ZeroAddress();
        if (_totalAllocation == 0) revert ZeroAllocation();

        token = IERC20(_token);
        beneficiary = _beneficiary;
        launchTime = _launchTime;
        totalAllocation = _totalAllocation;

        monthlyAmount = _totalAllocation / MONTHS;
        roundingRemainder = _totalAllocation - (monthlyAmount * MONTHS);
    }

    function vestedAmount(uint64 timestamp) public view returns (uint256) {
        if (timestamp < launchTime) return 0;

        uint64 elapsed = timestamp - launchTime;
        uint256 monthsElapsed = uint256(elapsed / MONTH);

        if (monthsElapsed >= MONTHS) {
            return totalAllocation;
        }

        uint256 vested = monthsElapsed * monthlyAmount;
        // defensive cap
        if (vested > totalAllocation) return totalAllocation;
        return vested;
    }

    function releasable() public view returns (uint256) {
        uint256 vested = vestedAmount(uint64(block.timestamp));
        if (vested <= released) return 0;
        return vested - released;
    }

    function release() external {
        uint256 amount = releasable();
        if (amount == 0) revert NothingToRelease();
        released += amount;
        token.safeTransfer(beneficiary, amount);
        emit TokensReleased(beneficiary, amount);
    }

    function vestingEndTime() external view returns (uint64) {
        return launchTime + uint64(MONTH) * MONTHS;
    }

    function requiredFunding() external view returns (uint256) {
        return totalAllocation;
    }
}
