import { ethers } from "hardhat";
import { expect } from "chai";

async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("DevVesting", function () {
  it("vests monthly (30d) over 12 months, no cliff, anyone can release", async () => {
    const [deployer, beneficiary, stranger] = await ethers.getSigners();

    // Deploy CAPIT token
    const CAPIT = await ethers.getContractFactory("CAPITToken");
    const token = await CAPIT.deploy();
    await token.waitForDeployment();

    const block = await ethers.provider.getBlock("latest");
    if (!block) throw new Error("No latest block");
    const launchTime = BigInt(block.timestamp); // used by vesting contract

    const totalAllocation = ethers.parseUnits("1200", 18); // 1200 CAPIT

    // Deploy vesting (token, beneficiary, launchTime, totalAllocation)
    const Vesting = await ethers.getContractFactory("DevVesting");
    const vesting = await Vesting.deploy(
      await token.getAddress(),
      beneficiary.address,
      Number(launchTime), // constructor expects uint64; safe for hardhat timestamps
      totalAllocation
    );
    await vesting.waitForDeployment();

    // ---- Fund vesting via Genesis allocation (5% of GS goes to devVesting) ----
    // Need GS such that DEV (5%) == totalAllocation => GS = totalAllocation * 20
    const GS = totalAllocation * 20n;

    const cutoffTimestamp = 1700000000; // any non-zero UTC unix ts for tests
    const snapshotHash =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    // For this unit test we don't care about reserve/public recipients, just need non-zero addresses.
    await token.initializeGenesis(
      GS,
      cutoffTimestamp,
      snapshotHash,
      deployer.address, // publicRecipient
      deployer.address, // reserveController
      await vesting.getAddress() // devVesting = vesting contract (gets the 5%)
    );

    // Sanity: vesting contract should have exactly totalAllocation (5% of GS)
    expect(await token.balanceOf(await vesting.getAddress())).to.equal(totalAllocation);

    // At T0 releasable should be 0
    expect(await vesting.releasable()).to.equal(0n);

    const MONTH = 30 * 24 * 60 * 60;

    // After 1 month: 1/12 vested
    await increaseTime(MONTH);
    const monthlyAmount = totalAllocation / 12n;
    expect(await vesting.releasable()).to.equal(monthlyAmount);

    // Anyone can release; tokens go to beneficiary
    const before = await token.balanceOf(beneficiary.address);
    await vesting.connect(stranger).release();
    const after = await token.balanceOf(beneficiary.address);
    expect(after - before).to.equal(monthlyAmount);

    // After full duration: total vested
    await increaseTime(MONTH * 11 + 10); // slightly beyond 12 months total
    const releasableEnd = await vesting.releasable();

    // Should be (totalAllocation - already released)
    const alreadyReleased = monthlyAmount;
    expect(releasableEnd).to.equal(totalAllocation - alreadyReleased);

    await vesting.release();
    expect(await token.balanceOf(beneficiary.address)).to.equal(totalAllocation);
  });
});