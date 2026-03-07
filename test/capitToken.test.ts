import { ethers } from "hardhat";
import { expect } from "chai";

const UNIT = 10n ** 18n;

describe("CAPITToken (v1.1 +1 mint model)", function () {
  it("initializes genesis exactly once with 75/20/5 allocation and remainder to public", async () => {
    const [deployer, publicRecipient, reserve, devVesting] = await ethers.getSigners();

    const CAPIT = await ethers.getContractFactory("CAPITToken");
    const token = await CAPIT.deploy();
    await token.waitForDeployment();

    const GS = 1_000_000n * UNIT;

    await token.initializeGenesis(GS, 1700000000, ethers.keccak256(ethers.toUtf8Bytes("GENESIS-MANIFEST")), publicRecipient.address, reserve.address, devVesting.address);

    const dev = (GS * 500n) / 10000n;
    const res = (GS * 2000n) / 10000n;
    const pub = GS - dev - res;

    expect(await token.totalSupply()).to.equal(GS);
    expect(await token.genesisCutoffTimestamp()).to.equal(1700000000);
    expect(await token.genesisSnapshotHash()).to.equal(ethers.keccak256(ethers.toUtf8Bytes("GENESIS-MANIFEST")));
    expect(await token.balanceOf(devVesting.address)).to.equal(dev);
    expect(await token.balanceOf(reserve.address)).to.equal(res);
    expect(await token.balanceOf(publicRecipient.address)).to.equal(pub);

    await expect(
      token.initializeGenesis(
        GS,
        1700000000,
        ethers.keccak256(ethers.toUtf8Bytes("GENESIS-MANIFEST")),
        publicRecipient.address,
        reserve.address,
        devVesting.address
      )
    ).to.be.reverted;
  });

  it("enforces oracle-only +1 mint to immutable publicRecipient", async () => {
    const [deployer, publicRecipient, reserve, devVesting, protocolMultisig, attacker] =
      await ethers.getSigners();

    const CAPIT = await ethers.getContractFactory("CAPITToken");
    const token = await CAPIT.deploy();
    await token.waitForDeployment();

    const GS = 10_000n * UNIT;
    await token.initializeGenesis(GS, 1700000000, ethers.keccak256(ethers.toUtf8Bytes("GENESIS-MANIFEST")), publicRecipient.address, reserve.address, devVesting.address);

    // Deploy OracleMinter, owned by protocolMultisig
    const OracleMinter = await ethers.getContractFactory("OracleMinter");
    const oracleMinter = await OracleMinter.deploy(await token.getAddress(), protocolMultisig.address);
    await oracleMinter.waitForDeployment();

    // Set mint authority to OracleMinter
    await token.setMintAuthority(await oracleMinter.getAddress());

    // attacker cannot call token.mintWell()
    await expect(token.connect(attacker).mintWell(ethers.keccak256(ethers.toUtf8Bytes("WELL")))).to.be.reverted;

    // attacker cannot call oracleMinter.mintWell()
    await expect(
      oracleMinter
        .connect(attacker)
        .mintWell(
          ethers.keccak256(ethers.toUtf8Bytes("WELL")),
          ethers.keccak256(ethers.toUtf8Bytes("PROOF"))
        )
    ).to.be.reverted;

    const supply0 = await token.totalSupply();
    const pub0 = await token.balanceOf(publicRecipient.address);

    // protocolMultisig (owner) can trigger oracleMinter
    await oracleMinter
      .connect(protocolMultisig)
      .mintWell(
        ethers.keccak256(ethers.toUtf8Bytes("WELL-1")),
        ethers.keccak256(ethers.toUtf8Bytes("PROOF-1"))
      );

    expect(await token.totalSupply()).to.equal(BigInt(supply0) + UNIT);
    expect(await token.balanceOf(publicRecipient.address)).to.equal(BigInt(pub0) + UNIT);
  });

  it("allows owner renouncement after setup", async () => {
    const [deployer, publicRecipient, reserve, devVesting, protocolMultisig] = await ethers.getSigners();

    const CAPIT = await ethers.getContractFactory("CAPITToken");
    const token = await CAPIT.deploy();
    await token.waitForDeployment();

    const GS = 1000n * UNIT;
    await token.initializeGenesis(GS, 1700000000, ethers.keccak256(ethers.toUtf8Bytes("GENESIS-MANIFEST")), publicRecipient.address, reserve.address, devVesting.address);

    const OracleMinter = await ethers.getContractFactory("OracleMinter");
    const oracleMinter = await OracleMinter.deploy(await token.getAddress(), protocolMultisig.address);
    await oracleMinter.waitForDeployment();

    await token.setMintAuthority(await oracleMinter.getAddress());

    await token.renounceOwnership();
    expect(await token.owner()).to.equal(ethers.ZeroAddress);

    // cannot set mint authority anymore
    await expect(token.setMintAuthority(await oracleMinter.getAddress())).to.be.reverted;
  });
});
