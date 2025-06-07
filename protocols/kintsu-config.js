import { ethers } from 'ethers';
import { monadTestnet } from 'viem/chains';

// Kintsu Staking Platform Configuration
export const KINTSU_CONFIG = {
  PROTOCOL_NAME: "Kintsu",
  CONTRACT_ADDRESS: "0xe1d2439b75fb9746E7Bc6cB777Ae10AA7f7ef9c5",
  CHAIN: monadTestnet,
  EXPLORER_URL: "https://testnet.monadexplorer.com/tx/",
  
  // Contract details
  IS_PROXY: false,
  
  // Staking parameters
  DEPOSIT_FUNCTION: "deposit",
  BALANCE_FUNCTION: "balanceOf",
  
  // Token info
  NATIVE_TOKEN: "MON",
  REWARD_TOKEN: "Kintsu Shares",
  
  // Default settings
  // DEFAULT_STAKE_AMOUNT: "0.01",
  // MAX_GAS_PRICE: ethers.parseUnits("60", "gwei"),
  // GAS_LIMIT: "200000",
};

// Kintsu Contract ABI
export const KINTSU_ABI = [
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "assets", type: "uint96", internalType: "uint96" },
      { name: "receiver", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "shares", type: "uint96", internalType: "uint96" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
];