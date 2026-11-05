import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy BonFireAgentINFT to the current Hardhat network.
 *
 * After deployment, writes contract address to:
 *   contracts/deployments/<networkName>.json
 *
 * Backend reads this file to discover the contract address at startup.
 */
async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying BonFireAgentINFT on network: ${network.name}`);
  console.log(`Deployer address: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);

  const Factory = await ethers.getContractFactory("BonFireAgentINFT");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log(`BonFireAgentINFT deployed to: ${contractAddress}`);

  // Write deployment record for backend consumption.
  const deploymentsDir = path.resolve(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentPath = path.join(deploymentsDir, `${network.name}.json`);
  const deploymentRecord = {
    network: network.name,
    contractAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentRecord, null, 2));
  console.log(`Deployment record written to: ${deploymentPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(err);
    process.exit(1);
  });
