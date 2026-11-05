/**
 * Post-build script: copies the compiled ABI from the Hardhat artifacts directory
 * to contracts/abi/BonFireAgentINFT.json so the backend can import it directly.
 *
 * This runs automatically via the "build" npm script after `hardhat compile`.
 */
const fs = require("fs");
const path = require("path");

const src = path.resolve(
  __dirname,
  "..",
  "artifacts",
  "contracts",
  "BonFireAgentINFT.sol",
  "BonFireAgentINFT.json"
);

const destDir = path.resolve(__dirname, "..", "abi");
const dest = path.join(destDir, "BonFireAgentINFT.json");

if (!fs.existsSync(src)) {
  console.error(`ABI source not found: ${src}`);
  console.error("Run 'hardhat compile' first.");
  process.exit(1);
}

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

const artifact = JSON.parse(fs.readFileSync(src, "utf8"));
const abiOnly = { abi: artifact.abi };
fs.writeFileSync(dest, JSON.stringify(abiOnly, null, 2));
console.log(`ABI written to: ${dest}`);
