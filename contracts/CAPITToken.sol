// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CAPITToken
 * @notice CAPIT is a slow-emission national ledger token:
 * - Genesis supply is minted exactly once via initializeGenesis().
 * - Genesis allocation: 75% publicRecipient, 20% reserveController, 5% devVesting.
 * - Post-genesis minting is immutable: oracle-only, +1 CAPIT (1e18) per call, to publicRecipient only.
 * - Ownership is renounced after genesis + mintAuthority configuration.
 */
contract CAPITToken is ERC20, Ownable {
    // ---- Constants ----
    uint16 public constant PUBLIC_BPS = 7500; // 75%
    uint16 public constant RESERVE_BPS = 2000; // 20%
    uint16 public constant DEV_BPS = 500; // 5%
    uint16 public constant BPS_DENOM = 10000;

    uint256 public constant MINT_UNIT = 1e18; // exactly 1 CAPIT per mintWell()

    // ---- Required public state ----
    address public publicRecipient;
    address public reserveController;
    address public devVesting;
    address public mintAuthority;
    bool public genesisInitialized;
    uint64 public genesisCutoffTimestamp;
    bytes32 public genesisSnapshotHash;

    // ---- Events ----
    event GenesisInitialized(
        uint256 genesisSupply,
        uint64 cutoffTimestamp,
        bytes32 snapshotHash,
        address publicRecipient,
        address reserveController,
        address devVesting
    );

    event GenesisMetadata(
        uint64 cutoffTimestamp,
        bytes32 snapshotHash
    );
event MintAuthoritySet(address mintAuthority);

    event WellMinted(
        bytes32 indexed wellIdHash,
        address indexed to,
        uint256 amount,
        uint256 newTotalSupply,
        uint256 timestamp
    );

    error ZeroAddress();
    error GenesisAlreadyInitialized();
    error GenesisNotInitialized();
    error NotMintAuthority();
    error MintAuthorityNotSet();

    constructor() ERC20("CAPIT", "CAPIT") Ownable(msg.sender) {}

    /**
     * @notice Mints GENESIS_SUPPLY exactly once and allocates it per basis points.
     * @dev Remainder (if any) is assigned to publicRecipient by computing PUB = GS - DEV - RES.
     */
    function initializeGenesis(
        uint256 genesisSupply,
        uint64 cutoffTimestamp,
        bytes32 snapshotHash,
        address _publicRecipient,
        address _reserveController,
        address _devVesting
    ) external onlyOwner {
        if (genesisInitialized) revert GenesisAlreadyInitialized();
        require(genesisSupply > 0, "GS=0");
        require(cutoffTimestamp > 0, "CUT=0");
        require(snapshotHash != bytes32(0), "SNAP=0");
        if (_publicRecipient == address(0) || _reserveController == address(0) || _devVesting == address(0)) {
            revert ZeroAddress();
        }

        publicRecipient = _publicRecipient;
        reserveController = _reserveController;
        devVesting = _devVesting;
        genesisCutoffTimestamp = cutoffTimestamp;
        genesisSnapshotHash = snapshotHash;

        uint256 devAmt = (genesisSupply * DEV_BPS) / BPS_DENOM;
        uint256 resAmt = (genesisSupply * RESERVE_BPS) / BPS_DENOM;
        uint256 pubAmt = genesisSupply - devAmt - resAmt;

        genesisInitialized = true;

        _mint(devVesting, devAmt);
        _mint(reserveController, resAmt);
        _mint(publicRecipient, pubAmt);

        emit GenesisInitialized(genesisSupply, cutoffTimestamp, snapshotHash, publicRecipient, reserveController, devVesting);
        emit GenesisMetadata(cutoffTimestamp, snapshotHash);
    }

    /**
     * @notice Sets the only address permitted to call mintWell().
     * @dev Must be called before ownership is renounced.
     */
    function setMintAuthority(address _mintAuthority) external onlyOwner {
        if (_mintAuthority == address(0)) revert ZeroAddress();
        mintAuthority = _mintAuthority;
        emit MintAuthoritySet(_mintAuthority);
    }

    /**
     * @notice Oracle-only post-genesis mint. Mints exactly 1 CAPIT to publicRecipient.
     * @dev No arbitrary recipient, no arbitrary amount.
     */
    function mintWell(bytes32 wellIdHash) external {
        if (!genesisInitialized) revert GenesisNotInitialized();
        if (mintAuthority == address(0)) revert MintAuthorityNotSet();
        if (msg.sender != mintAuthority) revert NotMintAuthority();
        require(wellIdHash != bytes32(0), "WELL=0");

        _mint(publicRecipient, MINT_UNIT);
        emit WellMinted(wellIdHash, publicRecipient, MINT_UNIT, totalSupply(), block.timestamp);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
