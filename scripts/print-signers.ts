import { ethers } from "hardhat";

async function main() {
  const signers = await ethers.getSigners();

  console.log("Total signers:", signers.length);
  console.log("--------------------------------------------------");

  for (let i = 0; i < signers.length; i++) {
    const address = await signers[i].getAddress();
    const balance = await ethers.provider.getBalance(address);

    console.log(
      `Index: ${i}\nAddress: ${address}\nBalance: ${ethers.formatEther(balance)} ETH\n`
    );
  }

  console.log("--------------------------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});