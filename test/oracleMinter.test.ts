import { ethers } from "hardhat";
import { expect } from "chai";

const UNIT = 10n ** 18n;

function hashStr(s: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(s));
}

describe("OracleMinter", function () {
  it("requires (wellIdHash, proofHash), enforces uniqueness, and supports owner + authorized bot", async () => {
    const [publicRecipient, reserve, devVesting, multisigOwner, bot, attacker] = await ethers.getSigners();

    const CAPIT = await ethers.getContractFactory("CAPITToken");
    const token = await CAPIT.deploy();
    await token.waitForDeployment();

    const GS = 1000n * UNIT;
    await token.initializeGenesis(
      GS,
      1700000000,
      hashStr("GENESIS-MANIFEST"),
      publicRecipient.address,
      reserve.address,
      devVesting.address
    );

    const OracleMinter = await ethers.getContractFactory("OracleMinter");
    const oracle = await OracleMinter.deploy(await token.getAddress(), multisigOwner.address);
    await oracle.waitForDeployment();

    await token.setMintAuthority(await oracle.getAddress());

    const wellA = hashStr("WELL-A");
    const proofA = hashStr("PROOF-A");

    // missing params / zero params should revert
    await expect(oracle.connect(multisigOwner).mintWell(ethers.ZeroHash, proofA)).to.be.reverted;
    await expect(oracle.connect(multisigOwner).mintWell(wellA, ethers.ZeroHash)).to.be.reverted;

    // attacker cannot mint
    await expect(oracle.connect(attacker).mintWell(wellA, proofA)).to.be.reverted;

    // owner can mint
    const ts0 = await token.totalSupply();
    await oracle.connect(multisigOwner).mintWell(wellA, proofA);
    expect(await token.totalSupply()).to.equal(BigInt(ts0) + UNIT);
    expect(await oracle.wellMinted(wellA)).to.equal(true);
    expect(await oracle.wellProofHash(wellA)).to.equal(proofA);

    // duplicate wellIdHash reverts
    await expect(oracle.connect(multisigOwner).mintWell(wellA, proofA)).to.be.reverted;

    // authorize bot
    await oracle.connect(multisigOwner).setAuthorizedCaller(bot.address, true);
    expect(await oracle.isAuthorizedCaller(bot.address)).to.equal(true);

    const wellB = hashStr("WELL-B");
    const proofB = hashStr("PROOF-B");
    const ts1 = await token.totalSupply();
    await oracle.connect(bot).mintWell(wellB, proofB);
    expect(await token.totalSupply()).to.equal(BigInt(ts1) + UNIT);

    // revoke bot
    await oracle.connect(multisigOwner).setAuthorizedCaller(bot.address, false);
    await expect(oracle.connect(bot).mintWell(hashStr("WELL-C"), hashStr("PROOF-C"))).to.be.reverted;
  });
});
