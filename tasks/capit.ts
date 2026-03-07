import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import fs from "fs";
import path from "path";
import { getAddress } from "ethers";

type Json = Record<string, any>;

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function readJsonIfExists(p: string): Json {
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p: string, data: Json) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function deploymentsPath(hre: HardhatRuntimeEnvironment) {
  return path.join(process.cwd(), "deployments", `${hre.network.name}.json`);
}

function publicAddressesPath() {
  return path.join(process.cwd(), "public", "addresses.json");
}

function launchProofsPath() {
  return path.join(process.cwd(), "public", "launch_proofs.json");
}

function requireConfirm(confirm?: boolean) {
  if (!confirm) {
    throw new Error("Missing --confirm. This task sends transactions.");
  }
}

function toBigInt(v: string) {
  // allow decimal strings only
  if (!/^\d+$/.test(v)) throw new Error(`Expected integer string, got: ${v}`);
  return BigInt(v);
}

function toBytes32(hre: HardhatRuntimeEnvironment, v: string): string {
  const s = String(v);
  if (s.startsWith("0x") && s.length === 66) return s;
  return hre.ethers.keccak256(hre.ethers.toUtf8Bytes(s));
}

/**
 * Permanent fix: normalize any address casing to canonical EIP-55 checksum.
 * This prevents ethers v6 "bad address checksum" from mixed-case CLI inputs.
 */
function normAddr(v: string): string {
  return getAddress(String(v).trim().toLowerCase());
}

/**
 * Resolve signer from either:
 * - an index string like "0", "1" (Hardhat local), OR
 * - an address string
 */
async function resolveSigner(hre: HardhatRuntimeEnvironment, v: string) {
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    const idx = parseInt(s, 10);
    const signers = await hre.ethers.getSigners();
    if (!signers[idx]) throw new Error(`Signer index out of range: ${idx}`);
    return signers[idx];
  }
  return hre.ethers.getSigner(normAddr(s));
}

async function assertGenesisAllocations(
  hre: HardhatRuntimeEnvironment,
  args: {
    capit: string;
    genesisSupply: string;
    publicRecipient: string;
    reserveController: string;
    devVesting: string;
  }
) {
  const capitAddr = normAddr(args.capit);
  const publicRecipient = normAddr(args.publicRecipient);
  const reserveController = normAddr(args.reserveController);
  const devVesting = normAddr(args.devVesting);

  const capit = await hre.ethers.getContractAt("CAPITToken", capitAddr);
  const GS = toBigInt(args.genesisSupply);

  const DEV = await capit.balanceOf(devVesting);
  const RES = await capit.balanceOf(reserveController);
  const PUB = await capit.balanceOf(publicRecipient);
  const TS = await capit.totalSupply();

  const expectedDEV = (GS * 500n) / 10000n;
  const expectedRES = (GS * 2000n) / 10000n;
  const expectedPUB = GS - expectedDEV - expectedRES;

  const checks: Array<[string, boolean, any]> = [
    [
      "DEV == (GS * 500) / 10000",
      DEV === expectedDEV,
      { DEV: DEV.toString(), expectedDEV: expectedDEV.toString() }
    ],
    [
      "RES == (GS * 2000) / 10000",
      RES === expectedRES,
      { RES: RES.toString(), expectedRES: expectedRES.toString() }
    ],
    [
      "PUB == GS - DEV - RES",
      PUB === expectedPUB,
      { PUB: PUB.toString(), expectedPUB: expectedPUB.toString() }
    ],
    [
      "totalSupply == GS",
      TS === GS,
      { totalSupply: TS.toString(), GS: GS.toString() }
    ]
  ];

  let allPass = true;
  for (const [label, ok, meta] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
    if (!ok) {
      console.log(meta);
      allPass = false;
    }
  }

  if (!allPass) throw new Error("Genesis Allocation Assertions FAILED");
}

async function assertGenesisMetadata(
  hre: HardhatRuntimeEnvironment,
  args: { capit: string; cutoffTimestamp: string; snapshotHash: string }
) {
  const capitAddr = normAddr(args.capit);
  const capit = await hre.ethers.getContractAt("CAPITToken", capitAddr);

  const cut = await capit.genesisCutoffTimestamp();
  const snap = await capit.genesisSnapshotHash();

  const cutOk = BigInt(cut) === BigInt(args.cutoffTimestamp);
  const snapOk = String(snap).toLowerCase() === String(args.snapshotHash).toLowerCase();

  console.log(`${cutOk ? "PASS" : "FAIL"}: genesisCutoffTimestamp matches`);
  if (!cutOk) throw new Error(`cutoff mismatch on-chain: ${cut} vs ${args.cutoffTimestamp}`);

  console.log(`${snapOk ? "PASS" : "FAIL"}: genesisSnapshotHash matches`);
  if (!snapOk) throw new Error(`snapshotHash mismatch on-chain: ${snap} vs ${args.snapshotHash}`);
}

async function assertOwnershipRenounced(hre: HardhatRuntimeEnvironment, capitAddr: string) {
  const capit = await hre.ethers.getContractAt("CAPITToken", normAddr(capitAddr));
  const owner = await capit.owner();
  const ok = owner === hre.ethers.ZeroAddress;
  console.log(`${ok ? "PASS" : "FAIL"}: owner() == address(0)`);
  if (!ok) throw new Error(`Ownership not renounced. owner=${owner}`);
}

async function assertMintRule(
  hre: HardhatRuntimeEnvironment,
  args: {
    capit: string;
    oracleMinter: string;
    publicRecipient: string;
    callerSigner: string;
    times: number;
  }
) {
  const capitAddr = normAddr(args.capit);
  const oracleMinterAddr = normAddr(args.oracleMinter);
  const publicRecipient = normAddr(args.publicRecipient);

  const capit = await hre.ethers.getContractAt("CAPITToken", capitAddr);
  const oracleMinter = await hre.ethers.getContractAt("OracleMinter", oracleMinterAddr);
  const unit = 10n ** 18n;

  // 1) Direct token.mintWell() must revert for EOAs (only OracleMinter is mintAuthority)
  const [signer0] = await hre.ethers.getSigners();
  let reverted = false;
  try {
    const tx = await capit
      .connect(signer0)
      .mintWell(hre.ethers.keccak256(hre.ethers.toUtf8Bytes("TEST-WELL-DIRECT")));
    await tx.wait();
  } catch {
    reverted = true;
  }
  console.log(`${reverted ? "PASS" : "FAIL"}: Direct token.mintWell() from EOA reverts`);
  if (!reverted) throw new Error("Mint rule assertion failed: non-mintAuthority did not revert");

  // 2) Non-authorized caller must revert when calling OracleMinter.mintWell()
  reverted = false;
  try {
    const wellIdHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("TEST-WELL-UNAUTH"));
    const proofHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("PROOF-UNAUTH"));
    const tx = await oracleMinter.connect(signer0).mintWell(wellIdHash, proofHash);
    await tx.wait();
  } catch {
    reverted = true;
  }
  console.log(`${reverted ? "PASS" : "FAIL"}: OracleMinter.mintWell() from non-authorized caller reverts`);
  if (!reverted) throw new Error("Mint rule assertion failed: non-authorized caller did not revert");

  // 3) Authorized caller (owner/multisig signer) triggers OracleMinter
  const caller = await resolveSigner(hre, args.callerSigner);

  const ts0 = await capit.totalSupply();
  const bal0 = await capit.balanceOf(publicRecipient);

  for (let i = 0; i < args.times; i++) {
    const wellIdHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`SIM-WELL-${i + 1}`));
    const proofHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`SIM-PROOF-${i + 1}`));
    const tx = await oracleMinter.connect(caller).mintWell(wellIdHash, proofHash);
    const rcpt = await tx.wait();
    console.log(`mintWell tx[${i + 1}]: ${rcpt?.hash}`);

    const tsN = await capit.totalSupply();
    const balN = await capit.balanceOf(publicRecipient);

    const expectedSupply = BigInt(ts0) + BigInt(i + 1) * unit;
    const expectedBal = BigInt(bal0) + BigInt(i + 1) * unit;

    const supplyOk = BigInt(tsN) === expectedSupply;
    const balOk = BigInt(balN) === expectedBal;

    console.log(`${supplyOk ? "PASS" : "FAIL"}: totalSupply increased by exactly 1e18 (call ${i + 1})`);
    console.log(`${balOk ? "PASS" : "FAIL"}: publicRecipient increased by exactly 1e18 (call ${i + 1})`);

    if (!supplyOk || !balOk) throw new Error("Mint rule assertion failed during sequential mints");
  }

  // 4) Duplicate wellIdHash must revert
  const dupWell = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("SIM-WELL-DUP"));
  const dupProof = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("SIM-PROOF-DUP"));
  await (await oracleMinter.connect(caller).mintWell(dupWell, dupProof)).wait();

  let dupReverted = false;
  try {
    await (await oracleMinter.connect(caller).mintWell(dupWell, dupProof)).wait();
  } catch {
    dupReverted = true;
  }
  console.log(`${dupReverted ? "PASS" : "FAIL"}: Duplicate wellIdHash reverts`);
  if (!dupReverted) throw new Error("Mint rule assertion failed: duplicate wellIdHash did not revert");
}

// ---------------- Task implementations ----------------

/**
 * A) capit:deploy:core
 */
task("capit:deploy:core", "Deploy CAPIT core contracts")
  .addParam("genesisSupply", "Genesis supply in wei (VerifiedHistoricallyPluggedWells * 1e18)")
  .addParam("launchTime", "Launch timestamp T0 (unix seconds)")
  .addParam("publicRecipient")
  .addParam("devBeneficiary")
  .addParam("protocolMultisig", "Protocol multisig (2-of-3) controlling reserve operations")
  .addParam("mintAuthority", "Oracle multisig or OracleMinter address")
  .addParam("quoteToken")
  .addParam("router")
  .addParam("lpPair")
  .addParam("lpLocker")
  .addParam("cooldownSeconds")
  .addParam("maxCapitPer30d")
  .addParam("maxQuotePer30d")
  .addFlag("confirm")
  .setAction(async (args, hre) => {
    requireConfirm(args.confirm);

    const [deployer] = await hre.ethers.getSigners();
    console.log(`Network: ${hre.network.name}`);
    console.log(`Deployer: ${deployer.address}`);

    // ✅ Permanent checksum fix: normalize all address inputs once
    const publicRecipient = normAddr(args.publicRecipient);
    const devBeneficiary = normAddr(args.devBeneficiary);
    const protocolMultisig = normAddr(args.protocolMultisig);
    const quoteToken = normAddr(args.quoteToken);
    const router = normAddr(args.router);
    const lpPair = normAddr(args.lpPair);
    const lpLocker = normAddr(args.lpLocker);

    const GS = toBigInt(args.genesisSupply);
    const devAllocation = (GS * 500n) / 10000n;

    const deploymentsFile = deploymentsPath(hre);
    const state = readJsonIfExists(deploymentsFile);

    // 1) Deploy CAPITToken
    const CAPIT = await hre.ethers.getContractFactory("CAPITToken");
    const capit = await CAPIT.deploy();
    await capit.waitForDeployment();

    // 2) Deploy DevVesting
    const Vesting = await hre.ethers.getContractFactory("DevVesting");
    const vesting = await Vesting.deploy(
      await capit.getAddress(),
      devBeneficiary,
      BigInt(args.launchTime),
      devAllocation
    );
    await vesting.waitForDeployment();

    // 3) Deploy ReserveController
    const Reserve = await hre.ethers.getContractFactory("ReserveController");
    const reserve = await Reserve.deploy(
      await capit.getAddress(),
      quoteToken,
      router,
      lpPair,
      lpLocker,
      protocolMultisig,
      BigInt(args.cooldownSeconds),
      BigInt(args.maxCapitPer30d),
      BigInt(args.maxQuotePer30d)
    );
    await reserve.waitForDeployment();

    // 4) Deploy OracleMinter (always), owned by protocolMultisig.
    const OracleMinter = await hre.ethers.getContractFactory("OracleMinter");
    const oracleMinter = await OracleMinter.deploy(await capit.getAddress(), protocolMultisig);
    await oracleMinter.waitForDeployment();

    // 5) Force CAPITToken mintAuthority to OracleMinter for future-proofing.
    const setTx = await capit.setMintAuthority(await oracleMinter.getAddress());
    await setTx.wait();

    // Record
    const out: Json = {
      ...state,
      network: hre.network.name,
      deployer: deployer.address,
      inputs: {
        genesisSupply: args.genesisSupply,
        launchTime: args.launchTime,
        publicRecipient,
        devBeneficiary,
        protocolMultisig,
        // NOTE: Mint authority is forced to OracleMinter per recommended setup.
        mintAuthority: await oracleMinter.getAddress(),
        quoteToken,
        router,
        lpPair,
        lpLocker,
        cooldownSeconds: args.cooldownSeconds,
        maxCapitPer30d: args.maxCapitPer30d,
        maxQuotePer30d: args.maxQuotePer30d
      },
      contracts: {
        CAPITToken: {
          address: await capit.getAddress(),
          txHash: capit.deploymentTransaction()?.hash
        },
        DevVesting: {
          address: await vesting.getAddress(),
          txHash: vesting.deploymentTransaction()?.hash
        },
        ReserveController: {
          address: await reserve.getAddress(),
          txHash: reserve.deploymentTransaction()?.hash
        },
        OracleMinter: {
          address: await oracleMinter.getAddress(),
          txHash: oracleMinter.deploymentTransaction()?.hash
        }
      }
    };

    writeJson(deploymentsFile, out);
    console.log(`Wrote ${deploymentsFile}`);
  });

/**
 * B) capit:init:genesis
 */
task("capit:init:genesis", "Initialize genesis supply and allocations")
  .addParam("capit")
  .addParam("genesisSupply")
  .addParam("cutoffTimestamp", "Genesis cutoff timestamp (unix seconds UTC)")
  .addParam("snapshotHash", "bytes32 keccak256 hash of archived genesis snapshot bundle / manifest")
  .addParam("publicRecipient")
  .addParam("reserveController")
  .addParam("devVesting")
  .addFlag("confirm")
  .setAction(async (args, hre) => {
    requireConfirm(args.confirm);

    const capitAddr = normAddr(args.capit);
    const publicRecipient = normAddr(args.publicRecipient);
    const reserveController = normAddr(args.reserveController);
    const devVesting = normAddr(args.devVesting);

    const capit = await hre.ethers.getContractAt("CAPITToken", capitAddr);
    const tx = await capit.initializeGenesis(
      BigInt(args.genesisSupply),
      BigInt(args.cutoffTimestamp),
      args.snapshotHash,
      publicRecipient,
      reserveController,
      devVesting
    );
    const rcpt = await tx.wait();
    console.log(`Genesis init tx: ${rcpt?.hash}`);

    await assertGenesisAllocations(hre, {
      ...args,
      capit: capitAddr,
      publicRecipient,
      reserveController,
      devVesting
    });
    await assertGenesisMetadata(hre, { ...args, capit: capitAddr });

    const deploymentsFile = deploymentsPath(hre);
    const state = readJsonIfExists(deploymentsFile);
    state.genesis = {
      txHash: rcpt?.hash,
      genesisSupply: args.genesisSupply
    };
    writeJson(deploymentsFile, state);

    const proofsFile = launchProofsPath();
    const proofs = readJsonIfExists(proofsFile);
    proofs[hre.network.name] = proofs[hre.network.name] || {};
    proofs[hre.network.name].genesisInitTx = rcpt?.hash;
    writeJson(proofsFile, proofs);
    console.log(`Updated ${deploymentsFile} and ${proofsFile}`);
  });

/**
 * C) capit:setup:oracle
 */
task("capit:setup:oracle", "Set mint authority prior to renouncing ownership")
  .addParam("capit")
  .addParam("mintAuthority")
  .addFlag("confirm")
  .setAction(async (args, hre) => {
    requireConfirm(args.confirm);

    const capitAddr = normAddr(args.capit);
    const mintAuthority = normAddr(args.mintAuthority);

    const capit = await hre.ethers.getContractAt("CAPITToken", capitAddr);
    const tx = await capit.setMintAuthority(mintAuthority);
    const rcpt = await tx.wait();
    console.log(`Mint authority set tx: ${rcpt?.hash}`);

    const onchain = await capit.mintAuthority();
    if (onchain.toLowerCase() !== mintAuthority.toLowerCase()) {
      throw new Error(`mintAuthority mismatch on-chain: ${onchain}`);
    }

    const deploymentsFile = deploymentsPath(hre);
    const state = readJsonIfExists(deploymentsFile);
    state.oracle = { txHash: rcpt?.hash, mintAuthority };
    writeJson(deploymentsFile, state);

    const proofsFile = launchProofsPath();
    const proofs = readJsonIfExists(proofsFile);
    proofs[hre.network.name] = proofs[hre.network.name] || {};
    proofs[hre.network.name].mintAuthoritySetTx = rcpt?.hash;
    writeJson(proofsFile, proofs);
  });

/**
 * D) capit:renounce
 */
task("capit:renounce", "Renounce CAPITToken ownership permanently")
  .addParam("capit")
  .addFlag("confirm")
  .setAction(async (args, hre) => {
    requireConfirm(args.confirm);

    const capitAddr = normAddr(args.capit);
    const capit = await hre.ethers.getContractAt("CAPITToken", capitAddr);

    const genesisInitialized = await capit.genesisInitialized();
    const mintAuthority = await capit.mintAuthority();
    if (!genesisInitialized) throw new Error("Refusing to renounce: genesisInitialized == false");
    if (mintAuthority === hre.ethers.ZeroAddress) throw new Error("Refusing to renounce: mintAuthority not set");

    const tx = await capit.renounceOwnership();
    const rcpt = await tx.wait();
    console.log(`Renounce tx: ${rcpt?.hash}`);

    await assertOwnershipRenounced(hre, capitAddr);

    const deploymentsFile = deploymentsPath(hre);
    const state = readJsonIfExists(deploymentsFile);
    state.renounce = { txHash: rcpt?.hash };
    writeJson(deploymentsFile, state);

    const proofsFile = launchProofsPath();
    const proofs = readJsonIfExists(proofsFile);
    proofs[hre.network.name] = proofs[hre.network.name] || {};
    proofs[hre.network.name].ownershipRenounceTx = rcpt?.hash;
    writeJson(proofsFile, proofs);
  });

/**
 * E) capit:smoke:checks
 */
task("capit:smoke:checks", "Run post-deploy invariant checks")
  .addParam("capit")
  .addParam("genesisSupply")
  .addParam("cutoffTimestamp", "Genesis cutoff timestamp (unix seconds UTC)")
  .addParam("snapshotHash", "bytes32 keccak256 hash of archived genesis snapshot bundle / manifest")
  .addParam("publicRecipient")
  .addParam("reserveController")
  .addParam("devVesting")
  .addParam("mintAuthority")
  .setAction(async (args, hre) => {
    console.log(`Network: ${hre.network.name}`);

    const capitAddr = normAddr(args.capit);
    const publicRecipient = normAddr(args.publicRecipient);
    const reserveController = normAddr(args.reserveController);
    const devVesting = normAddr(args.devVesting);
    const mintAuthority = normAddr(args.mintAuthority);

    await assertGenesisAllocations(hre, {
      ...args,
      capit: capitAddr,
      publicRecipient,
      reserveController,
      devVesting
    });
    await assertGenesisMetadata(hre, { ...args, capit: capitAddr });

    const capit = await hre.ethers.getContractAt("CAPITToken", capitAddr);
    const mintAuth = await capit.mintAuthority();
    console.log(`${mintAuth.toLowerCase() === mintAuthority.toLowerCase() ? "PASS" : "FAIL"}: mintAuthority matches expected`);

    const owner = await capit.owner();
    if (owner === hre.ethers.ZeroAddress) {
      console.log("INFO: ownership already renounced");
      await assertOwnershipRenounced(hre, capitAddr);
    } else {
      console.log(`INFO: ownership not renounced yet (owner=${owner})`);
    }

    const deploymentsFile = deploymentsPath(hre);
    const state = readJsonIfExists(deploymentsFile);
    state.smokeChecks = { ranAt: new Date().toISOString(), status: "PASS" };
    writeJson(deploymentsFile, state);
  });

/**
 * F) capit:verify:all
 */
task("capit:verify:all", "Verify all deployed contracts on BaseScan")
  .addFlag("confirm")
  .setAction(async (args, hre) => {
    requireConfirm(args.confirm);

    const deploymentsFile = deploymentsPath(hre);
    const state = readJsonIfExists(deploymentsFile);
    const contracts = state.contracts || {};

    if (!contracts.CAPITToken?.address) throw new Error(`Missing CAPITToken address in ${deploymentsFile}`);

    console.log("Verifying CAPITToken...");
    await hre.run("verify:verify", {
      address: contracts.CAPITToken.address,
      constructorArguments: []
    });

    console.log("Verifying DevVesting...");
    await hre.run("verify:verify", {
      address: contracts.DevVesting.address,
      constructorArguments: [
        contracts.CAPITToken.address,
        normAddr(state.inputs.devBeneficiary),
        BigInt(state.inputs.launchTime),
        (toBigInt(state.inputs.genesisSupply) * 500n) / 10000n
      ]
    });

    console.log("Verifying ReserveController...");
    await hre.run("verify:verify", {
      address: contracts.ReserveController.address,
      constructorArguments: [
        contracts.CAPITToken.address,
        normAddr(state.inputs.quoteToken),
        normAddr(state.inputs.router),
        normAddr(state.inputs.lpPair),
        normAddr(state.inputs.lpLocker),
        normAddr(state.inputs.protocolMultisig),
        BigInt(state.inputs.cooldownSeconds),
        BigInt(state.inputs.maxCapitPer30d),
        BigInt(state.inputs.maxQuotePer30d)
      ]
    });

    state.verification = { verifiedAt: new Date().toISOString(), status: "DONE" };
    writeJson(deploymentsFile, state);
  });

/**
 * G) capit:export:addresses
 */
task("capit:export:addresses", "Generate public/addresses.json and public/launch_proofs.json")
  .setAction(async (_, hre) => {
    const deploymentsFile = deploymentsPath(hre);
    const state = readJsonIfExists(deploymentsFile);

    const out = {
      network: hre.network.name,
      CAPITToken: state.contracts?.CAPITToken?.address,
      DevVesting: state.contracts?.DevVesting?.address,
      ReserveController: state.contracts?.ReserveController?.address,
      OracleMinter: state.contracts?.OracleMinter?.address,
      mintAuthority: state.inputs?.mintAuthority,
      protocolMultisig: state.inputs?.protocolMultisig,
      publicRecipient: state.inputs?.publicRecipient,
      devBeneficiary: state.inputs?.devBeneficiary,
      quoteToken: state.inputs?.quoteToken,
      router: state.inputs?.router,
      lpPair: state.inputs?.lpPair,
      lpLocker: state.inputs?.lpLocker
    };

    writeJson(publicAddressesPath(), out);

    const proofsFile = launchProofsPath();
    const proofs = readJsonIfExists(proofsFile);
    proofs[hre.network.name] = proofs[hre.network.name] || {};
    proofs[hre.network.name].deploymentsFile = `deployments/${hre.network.name}.json`;
    writeJson(proofsFile, proofs);

    console.log(`Wrote ${publicAddressesPath()} and updated ${proofsFile}`);
  });

/**
 * H) capit:test:mint-sim (testnet only)
 */
task("capit:test:mint-sim", "Test oracle-only +1 mint rule (testnet only)")
  .addParam("capit")
  .addParam("oracleMinter")
  .addParam("publicRecipient")
  .addParam("callerSigner", "Signer address (or index) that can call OracleMinter (typically the protocol multisig owner signer on testnet)")
  .addOptionalParam("times", "Number of sequential mints", "5")
  .setAction(async (args, hre) => {
    if (hre.network.name !== "base-sepolia" && hre.network.name !== "hardhat") {
      throw new Error("capit:test:mint-sim is intended for testnet only");
    }

    await assertMintRule(hre, {
      capit: args.capit,
      oracleMinter: args.oracleMinter,
      publicRecipient: args.publicRecipient,
      callerSigner: args.callerSigner,
      times: parseInt(String(args.times), 10)
    });

    const deploymentsFile = deploymentsPath(hre);
    const state = readJsonIfExists(deploymentsFile);
    state.mintSim = { ranAt: new Date().toISOString(), times: parseInt(String(args.times), 10) };
    writeJson(deploymentsFile, state);
  });

/**
 * I) capit:mint:manual (Phase 1)
 */
task("capit:mint:manual", "Manual +1 mint via OracleMinter (Phase 1)")
  .addParam("oracleMinter", "OracleMinter contract address")
  .addParam("wellId", "Canonical well identifier OR 0x-prefixed bytes32 wellIdHash")
  .addParam("proof", "Proof identifier OR 0x-prefixed bytes32 proofHash")
  .addParam("callerSigner", "Signer address (or index) that can call OracleMinter (owner or authorized caller)")
  .addFlag("confirm")
  .setAction(async (args, hre) => {
    requireConfirm(args.confirm);

    const oracleMinter = await hre.ethers.getContractAt("OracleMinter", normAddr(args.oracleMinter));
    const caller = await resolveSigner(hre, args.callerSigner);

    const wellIdHash = toBytes32(hre, args.wellId);
    const proofHash = toBytes32(hre, args.proof);

    console.log("wellIdHash:", wellIdHash);
    console.log("proofHash:", proofHash);

    const tx = await oracleMinter.connect(caller).mintWell(wellIdHash, proofHash);
    const rcpt = await tx.wait();
    console.log("mint tx:", rcpt?.hash);
  });