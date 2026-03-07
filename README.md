# CAPIT Hardhat (v1.1)

This repository implements the **new CAPIT model**:

- **Genesis supply** is minted exactly once (a snapshot number × 1e18).
- Genesis allocation:
  - **75%** → `publicRecipient`
  - **20%** → `ReserveController`
  - **5%** → `DevVesting`
- **Post-genesis mint is immutable:** `CAPITToken.mintWell(wellIdHash)` can only be called by `mintAuthority` (the OracleMinter) and **mints exactly 1 CAPIT (1e18)** to **publicRecipient only**.
- **All mints are one-time per well:** `OracleMinter.mintWell(wellIdHash, proofHash)` records a `proofHash` commitment and prevents duplicate mints for the same `wellIdHash`.
- **Ownership is renounced** after `mintAuthority` is set.

References:
- CAPIT Technical Whitepaper v1.0 and appendices fileciteturn2file0
- Solidity Implementation Spec v1.1 (binding) fileciteturn2file1
- ReserveController Functional Spec v1.0 fileciteturn2file2
- Hardhat Task Spec v1.0 fileciteturn2file6
- Developer Vesting Spec v1.0 fileciteturn2file8

> Note on vesting math: the vesting spec includes a deterministic reference that uses **12×30-day months**. This repo follows that deterministic implementation.

## Quick start

```bash
npm install
cp .env.example .env
npm run compile
npm test
```

## Deployment

See **DEPLOYMENT.md**.
