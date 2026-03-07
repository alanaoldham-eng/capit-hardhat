# Deployment (Hardhat tasks)

This repo uses **Hardhat tasks** that mirror the required script-level validations.

All tasks that send transactions require `--confirm`.

## 0) Configure .env

Create `.env` from `.env.example`.

- `PRIVATE_KEY` must be the deployer EOA private key for the selected network.
- `BASE_SEPOLIA_RPC_URL` / `BASE_MAINNET_RPC_URL` must be valid RPC endpoints.
- `ETHERSCAN_API_KEY` is your BaseScan API key.

## 1) Deploy core contracts

You will need the deployment inputs from the Launch Execution Checklist fileciteturn2file5.

Example (Base Sepolia):

```bash
npx hardhat capit:deploy:core \
  --network base-sepolia \
  --confirm \
  --genesisSupply <GS_WEI> \
  --launchTime <T0_UNIX_SECONDS> \
  --publicRecipient <PUBLIC_RECIPIENT> \
  --devBeneficiary <DEV_BENEFICIARY> \
  --protocolMultisig <PROTOCOL_MULTISIG_2_OF_3> \
  --mintAuthority <IGNORED_IN_V1_1_1> \
  --quoteToken <USDC_ADDRESS> \
  --router <DEX_ROUTER> \
  --lpPair <CAPIT_USDC_PAIR> \
  --lpLocker <LP_LOCKER> \
  --cooldownSeconds <COOLDOWN> \
  --maxCapitPer30d <CAPIT_CAP_WEI> \
  --maxQuotePer30d <QUOTE_CAP_UNITS>
```

This writes `deployments/<network>.json`.

## 2) Initialize genesis (mints supply and allocates 75/20/5)

```bash
npx hardhat capit:init:genesis \
  --network base-sepolia \
  --confirm \
  --capit <CAPIT_TOKEN_ADDRESS> \
  --genesisSupply <GS_WEI> \
  --publicRecipient <PUBLIC_RECIPIENT> \
  --reserveController <RESERVE_CONTROLLER_ADDRESS> \
  --devVesting <DEV_VESTING_ADDRESS>
```

This task prints and enforces the **Genesis Allocation Assertions** (must PASS). fileciteturn2file1

## 3) OracleMinter + mint authority

`capit:deploy:core` now **always** deploys `OracleMinter` (owned by `protocolMultisig`) and sets
`CAPITToken.mintAuthority = OracleMinter` automatically.

You generally do **not** need to run `capit:setup:oracle` anymore unless you are experimenting on
testnet *before* renouncing ownership.

## 4) (Testnet) Mint simulation

```bash
npx hardhat capit:test:mint-sim \
  --network base-sepolia \
  --capit <CAPIT_TOKEN_ADDRESS> \
  --oracleMinter <ORACLE_MINTER_ADDRESS> \
  --publicRecipient <PUBLIC_RECIPIENT> \
  --callerSigner <SIGNER_ADDRESS_OR_INDEX> \
  --times 5
```

This enforces the **Mint Rule Assertions** (must PASS). fileciteturn2file1

## 5) Renounce ownership

```bash
npx hardhat capit:renounce \
  --network base-sepolia \
  --confirm \
  --capit <CAPIT_TOKEN_ADDRESS>
```

This asserts `owner() == address(0)`.

## 6) Smoke checks

```bash
npx hardhat capit:smoke:checks \
  --network base-sepolia \
  --capit <CAPIT_TOKEN_ADDRESS> \
  --genesisSupply <GS_WEI> \
  --publicRecipient <PUBLIC_RECIPIENT> \
  --reserveController <RESERVE_CONTROLLER_ADDRESS> \
  --devVesting <DEV_VESTING_ADDRESS> \
  --mintAuthority <ORACLE_MINTER_ADDRESS>
```

## 7) Verify contracts

```bash
npx hardhat capit:verify:all --network base-sepolia --confirm
```

## 8) Export website-ready JSON

```bash
npx hardhat capit:export:addresses --network base-sepolia
```

Outputs:
- `public/addresses.json`
- `public/launch_proofs.json`
