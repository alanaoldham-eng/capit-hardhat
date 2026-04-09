# CAPIT deployment and operations runbook

All state-changing tasks require `--confirm` and now refuse to run on live networks
(`base-sepolia`, `base`) when `PRIVATE_KEY` is not configured.

## 1) Exact steps to re-create the Sepolia deployment

Use this when you need a clean Sepolia re-deploy that mirrors production flow.

### Step 0 — Prepare environment

```bash
npm install
cp .env.example .env
```

Fill `.env`:

- `PRIVATE_KEY`: Sepolia deployer EOA private key.
- `BASE_SEPOLIA_RPC_URL`: your preferred Base Sepolia RPC.
- `ETHERSCAN_API_KEY`: for `capit:verify:all`.

### Step 1 — Compile and test locally

```bash
npm run compile
npm test
```

### Step 2 — Set launch inputs

Gather immutable launch inputs first:

- `GS_WEI` (genesis supply in wei)
- `T0_UNIX_SECONDS` (launch time)
- `CUTOFF_UNIX_SECONDS` (genesis cutoff timestamp)
- `SNAPSHOT_HASH` (`bytes32` keccak256 of archived snapshot manifest)
- `PUBLIC_RECIPIENT`, `DEV_BENEFICIARY`, `PROTOCOL_MULTISIG`
- Reserve params: `QUOTE_TOKEN`, `ROUTER`, `LP_PAIR`, `LP_LOCKER`, `COOLDOWN`, `CAPIT_CAP_WEI`, `QUOTE_CAP_UNITS`

### Step 3 — Deploy contracts

```bash
npx hardhat capit:deploy:core \
  --network base-sepolia \
  --confirm \
  --genesisSupply "$GS_WEI" \
  --launchTime "$T0_UNIX_SECONDS" \
  --publicRecipient "$PUBLIC_RECIPIENT" \
  --devBeneficiary "$DEV_BENEFICIARY" \
  --protocolMultisig "$PROTOCOL_MULTISIG" \
  --mintAuthority "$PROTOCOL_MULTISIG" \
  --quoteToken "$QUOTE_TOKEN" \
  --router "$ROUTER" \
  --lpPair "$LP_PAIR" \
  --lpLocker "$LP_LOCKER" \
  --cooldownSeconds "$COOLDOWN" \
  --maxCapitPer30d "$CAPIT_CAP_WEI" \
  --maxQuotePer30d "$QUOTE_CAP_UNITS"
```

Output is written to `deployments/base-sepolia.json`.

### Step 4 — Initialize genesis

```bash
npx hardhat capit:init:genesis \
  --network base-sepolia \
  --confirm \
  --capit <CAPIT_TOKEN_ADDRESS> \
  --genesisSupply "$GS_WEI" \
  --cutoffTimestamp "$CUTOFF_UNIX_SECONDS" \
  --snapshotHash "$SNAPSHOT_HASH" \
  --publicRecipient "$PUBLIC_RECIPIENT" \
  --reserveController <RESERVE_CONTROLLER_ADDRESS> \
  --devVesting <DEV_VESTING_ADDRESS>
```

This validates 75/20/5 genesis balances and metadata assertions.

### Step 5 — Run smoke checks

```bash
npx hardhat capit:smoke:checks \
  --network base-sepolia \
  --capit <CAPIT_TOKEN_ADDRESS> \
  --genesisSupply "$GS_WEI" \
  --cutoffTimestamp "$CUTOFF_UNIX_SECONDS" \
  --snapshotHash "$SNAPSHOT_HASH" \
  --publicRecipient "$PUBLIC_RECIPIENT" \
  --reserveController <RESERVE_CONTROLLER_ADDRESS> \
  --devVesting <DEV_VESTING_ADDRESS> \
  --mintAuthority <ORACLE_MINTER_ADDRESS>
```

### Step 6 — (Optional testnet) manual mint simulation

```bash
npx hardhat capit:test:mint-sim \
  --network base-sepolia \
  --capit <CAPIT_TOKEN_ADDRESS> \
  --oracleMinter <ORACLE_MINTER_ADDRESS> \
  --publicRecipient "$PUBLIC_RECIPIENT" \
  --callerSigner <AUTHORIZED_SIGNER_ADDRESS> \
  --times 3
```

### Step 7 — Renounce CAPIT ownership

```bash
npx hardhat capit:renounce \
  --network base-sepolia \
  --confirm \
  --capit <CAPIT_TOKEN_ADDRESS>
```

### Step 8 — Verify + export artifacts

```bash
npx hardhat capit:verify:all --network base-sepolia --confirm
npx hardhat capit:export:addresses --network base-sepolia
```

Expected outputs:

- `deployments/base-sepolia.json`
- `public/addresses.json`
- `public/launch_proofs.json`

---

## 2) Prepare for Base mainnet (preflight checklist)

1. **Use a distinct mainnet deployer key** in `.env` and confirm funding.
2. **Pin `BASE_MAINNET_RPC_URL`** to a reliable provider; do not rely on fallback public RPC for launch.
3. **Re-run local tests** and any dry-run on `base-sepolia` with final parameters.
4. **Freeze launch constants** (`GS_WEI`, cutoff timestamp, snapshot hash, reserve limits).
5. **Run deploy/init/smoke/verify/export** on `--network base` with the same sequence as Sepolia.
6. **Renounce ownership only after smoke checks pass** and mint authority is correct.
7. **Archive artifacts** (`deployments/base.json`, tx hashes, snapshot manifest, verification links).

---

## 3) PRIVATE_KEY switch runbook (deployer -> protocol multisig signer)

Goal: run manual mint tests through `OracleMinter` using an authorized protocol signer.

1. **Back up current `.env`**:
   ```bash
   cp .env .env.deployer.backup
   ```
2. **Replace `PRIVATE_KEY`** with a key that can execute `OracleMinter.mintWell` (owner/authorized signer).
3. **Validate active signer before minting**:
   ```bash
   npx hardhat run scripts/print-signers.ts --network base-sepolia
   ```
   Confirm signer address matches expected multisig signer/operator wallet.
4. **Run one manual mint**:
   ```bash
   npx hardhat capit:mint:manual \
     --network base-sepolia \
     --confirm \
     --oracleMinter <ORACLE_MINTER_ADDRESS> \
     --wellId "manual-test-<date>-001" \
     --proof "ipfs://<proof-cid-or-hash>" \
     --callerSigner <AUTHORIZED_SIGNER_ADDRESS>
   ```
5. **Check post-mint state** using `capit:smoke:checks` or direct read calls.
6. **Restore deployer key after testing**:
   ```bash
   cp .env.deployer.backup .env
   ```
7. **Record operator log**: signer address, wellIdHash, proofHash, tx hash, reviewer.
