import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config();

// Register CAPIT tasks
import "./tasks/capit";

const {
  BASE_SEPOLIA_RPC_URL,
  BASE_MAINNET_RPC_URL,
  PRIVATE_KEY,
  ETHERSCAN_API_KEY,
} = process.env;

// Normalize PRIVATE_KEY (allow users to paste without 0x)
const normalizedPk =
  PRIVATE_KEY && PRIVATE_KEY.trim().length > 0
    ? (PRIVATE_KEY.trim().startsWith("0x") ? PRIVATE_KEY.trim() : `0x${PRIVATE_KEY.trim()}`)
    : "";

// For real networks (Base Sepolia / Base Mainnet)
const accounts = normalizedPk ? [normalizedPk] : [];

// For localhost/hardhat deterministic multi-signer testing
const LOCAL_MNEMONIC = "test test test test test test test test test test test junk";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },

  // Optional but nice for demos/tests
  mocha: {
    timeout: 120000,
  },

  networks: {
    // In-process Hardhat network (used by `npx hardhat test`)
    hardhat: {
      chainId: 31337,
      accounts: {
        mnemonic: LOCAL_MNEMONIC,
        count: 20,
      },
    },

    // External node started by `npx hardhat node`
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      accounts: {
        mnemonic: LOCAL_MNEMONIC,
        count: 20,
      },
    },

    // Base Sepolia
    "base-sepolia": {
      url: BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts,
    },

    // Base Mainnet
    base: {
      url: BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts,
    },
  },

  etherscan: {
    apiKey: {
      "base-sepolia": ETHERSCAN_API_KEY || "",
      base: ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
    ],
  },
};

export default config;