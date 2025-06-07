import { ethers } from 'ethers';
import { monadTestnet } from 'viem/chains';

// APRIORI Configuration
export const APRIORI_CONFIG = {
  PROTOCOL_NAME: "APRIORI",
  CONTRACT_ADDRESS: "0xb2f82D0f38dc453D596Ad40A37799446Cc89274A",
  CHAIN: monadTestnet,
  EXPLORER_URL: "https://testnet.monadexplorer.com/tx/",
  
  // Contract details
  IS_PROXY: false, // Assumed non-proxy; update if needed
  DEPOSIT_FUNCTION: "deposit",
  BALANCE_FUNCTION: "maxRedeem", // Used to check redeemable shares
  
  // Token info
  NATIVE_TOKEN: "MON",
  REWARD_TOKEN: "sMON", // Assumed reward token name
  
  // Default settings
  DEFAULT_STAKE_AMOUNT: "0.01",
  MAX_GAS_PRICE: ethers.parseUnits("60", "gwei"),
  GAS_LIMIT: "300000",
};

// APRIORI ABI
export const APRIORI_ABI = [
  {
    "type": "function",
    "name": "deposit",
    "inputs": [
      {
        "name": "assets",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "shares",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable",
  },
  {
    "type": "function",
    "name": "requestRedeem",
    "inputs": [
      {
        "name": "shares",
        "type": "uint256",
        "internalType": "uint256"
      }, 
      {
        "name": "controller",
        "type": "address",
        "internalType": "address"
      }, 
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "requestId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "maxRedeem",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "maxShares",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  }
];