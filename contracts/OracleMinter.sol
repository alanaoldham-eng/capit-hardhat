// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface ICAPITToken {
    function mintWell(bytes32 wellIdHash) external;
}

/**
 * @title OracleMinter
 * @notice Minimal, future-proof mint gate for CAPIT.
 *
 * Design goals:
 * - CAPITToken's mintAuthority is set to this contract.
 * - Phase 1: a protocol Safe (multisig) manually calls mintWell(wellIdHash, proofHash).
 * - Phase 2: the Safe authorizes an automation bot address to call mintWell(wellIdHash, proofHash).
 * - No CAPITToken migration is required to move from manual -> automated.
 *
 * This contract enforces:
 * - Uniqueness: each wellIdHash can only be minted once.
 * - Proof commitment: each mint records a proofHash (bytes32 commitment to off-chain evidence).
 *
 * More advanced oracle request/fulfill flows can be layered later without changing CAPITToken.
 */
contract OracleMinter is Ownable {
    ICAPITToken public immutable capit;

    mapping(bytes32 => bool) public wellMinted;

    /// @notice Proof hash recorded for each minted wellIdHash.
    /// @dev bytes32 commitment to off-chain evidence (e.g., API response hash, document bundle hash).
    mapping(bytes32 => bytes32) public wellProofHash;

    mapping(address => bool) public isAuthorizedCaller;

    event AuthorizedCallerSet(address indexed caller, bool allowed);
    event OracleMintTriggered(address indexed caller, bytes32 indexed wellIdHash, bytes32 indexed proofHash, uint256 timestamp);
    event WellIdConsumed(bytes32 indexed wellIdHash, bytes32 indexed proofHash);

    error NotAuthorized();
    error ZeroAddress();
    error WellAlreadyMinted();
    error ZeroWellId();
    error ZeroProofHash();

    constructor(address capitToken, address owner_) Ownable(owner_) {
        if (capitToken == address(0) || owner_ == address(0)) revert ZeroAddress();
        capit = ICAPITToken(capitToken);
    }

    modifier onlyAuthorized() {
        if (msg.sender != owner() && !isAuthorizedCaller[msg.sender]) revert NotAuthorized();
        _;
    }

    /**
     * @notice Authorize / revoke an external caller.
     * @dev Intended for Phase 2 automation bot(s). Owner is expected to be a Safe.
     */
    function setAuthorizedCaller(address caller, bool allowed) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        isAuthorizedCaller[caller] = allowed;
        emit AuthorizedCallerSet(caller, allowed);
    }

    /**
     * @notice Triggers the CAPIT +1 mint.
     * @dev CAPITToken mints exactly 1e18 to publicRecipient.
     */
    /// @notice Triggers the CAPIT +1 mint for a unique wellIdHash.
    /// @param wellIdHash keccak256 of the canonical well identifier.
    /// @param proofHash keccak256 commitment to evidence validating the well status.
    /// @dev CAPITToken mints exactly 1e18 to publicRecipient.
    function mintWell(bytes32 wellIdHash, bytes32 proofHash) external onlyAuthorized {
        if (wellIdHash == bytes32(0)) revert ZeroWellId();
        if (proofHash == bytes32(0)) revert ZeroProofHash();
        if (wellMinted[wellIdHash]) revert WellAlreadyMinted();
        wellMinted[wellIdHash] = true;
        wellProofHash[wellIdHash] = proofHash;
        emit WellIdConsumed(wellIdHash, proofHash);

        capit.mintWell(wellIdHash);
        emit OracleMintTriggered(msg.sender, wellIdHash, proofHash, block.timestamp);
    }
}
