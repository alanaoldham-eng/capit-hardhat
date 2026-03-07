import { ethers } from "hardhat";
import { expect } from "chai";

describe("ReserveController", function () {
  it("only operator can call addLiquidity", async () => {
    const [deployer, operator, attacker] = await ethers.getSigners();

    const CAPIT = await ethers.getContractFactory("CAPITToken");
    const token = await CAPIT.deploy();
    await token.waitForDeployment();

    // dummy quote token: use another CAPITToken instance as ERC20
    const quote = await CAPIT.deploy();
    await quote.waitForDeployment();

    const Reserve = await ethers.getContractFactory("ReserveController");
    const reserve = await Reserve.deploy(
      await token.getAddress(),
      await quote.getAddress(),
      operator.address, // router (dummy)
      operator.address, // lpPair (dummy)
      operator.address, // lpLocker (dummy)
      operator.address, // operator
      3600,
      ethers.parseUnits("1000", 18),
      ethers.parseUnits("1000", 18)
    );
    await reserve.waitForDeployment();

    await expect(
      reserve.connect(attacker).addLiquidity(1, 1, 0, 0, Math.floor(Date.now() / 1000) + 3600)
    ).to.be.reverted;
  });
});
