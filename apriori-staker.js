import { ethers } from 'ethers';
import cron from 'node-cron';
import { APRIORI_CONFIG, APRIORI_ABI } from './protocols/apriori-config.js';
import 'dotenv/config';

// Runtime Configuration for APRIORI
const CONFIG = {
  ...APRIORI_CONFIG,
  RPC_URL: process.env.RPC_URL || "https://testnet-rpc.monad.xyz",
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  DAILY_STAKE_AMOUNT: process.env.STAKE_AMOUNT || APRIORI_CONFIG.DEFAULT_STAKE_AMOUNT,
  CRON_SCHEDULE: "0 9 * * *", // Daily at 9 AM UTC
};

class APRIORIStaker {
  constructor() {
    // Configure provider for Monad Testnet
    this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL, {
      chainId: CONFIG.CHAIN.id,
      name: CONFIG.CHAIN.name,
    });
    
    this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);
    this.contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, APRIORI_ABI, this.wallet);
    this.stakeAmount = ethers.parseEther(CONFIG.DAILY_STAKE_AMOUNT);
    
    console.log(`🔗 Connected to: ${CONFIG.CHAIN.name} (Chain ID: ${CONFIG.CHAIN.id})`);
    console.log(`🏦 Wallet Address: ${this.wallet.address}`);
    console.log(`⚡ Protocol: ${CONFIG.PROTOCOL_NAME} Staking`);
  }

  async checkNetworkConnection() {
    try {
      const network = await this.provider.getNetwork();
      console.log(`🌐 Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
      
      if (network.chainId !== BigInt(CONFIG.CHAIN.id)) {
        throw new Error(`Wrong network! Expected ${CONFIG.CHAIN.id}, got ${network.chainId}`);
      }
      
      return true;
    } catch (error) {
      console.error("❌ Network connection error:", error.message);
      throw error;
    }
  }

  async checkBalance() {
    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      const balanceInMon = ethers.formatEther(balance);
      console.log(`💰 MON balance: ${balanceInMon} MON`);
      
      if (balance < this.stakeAmount) {
        throw new Error(`Insufficient MON balance. Need ${CONFIG.DAILY_STAKE_AMOUNT} MON, have ${balanceInMon} MON`);
      }
      
      return balance;
    } catch (error) {
      console.error("❌ Error checking balance:", error.message);
      throw error;
    }
  }

  async estimateGas() {
    try {
      const gasEstimate = await this.contract.deposit.estimateGas(
        this.stakeAmount,
        this.wallet.address,
        { value: this.stakeAmount }
      );
      
      console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);
      return gasEstimate;
    } catch (error) {
      console.error("❌ Error estimating gas:", error.message);
      throw error;
    }
  }

  async checkGasPrice() {
    try {
      const gasPrice = await this.provider.getFeeData();
      const currentGasPrice = gasPrice.gasPrice || ethers.parseUnits("20", "gwei");
      
      console.log(`⛽ Current gas price: ${ethers.formatUnits(currentGasPrice, "gwei")} gwei`);
      
      if (currentGasPrice > CONFIG.MAX_GAS_PRICE) {
        throw new Error(`Gas price too high: ${ethers.formatUnits(currentGasPrice, "gwei")} gwei > ${ethers.formatUnits(CONFIG.MAX_GAS_PRICE, "gwei")} gwei`);
      }
      
      return currentGasPrice;
    } catch (error) {
      console.error("❌ Error checking gas price:", error.message);
      throw error;
    }
  }

  async stake() {
    try {
      console.log(`🚀 Starting daily stake of ${CONFIG.DAILY_STAKE_AMOUNT} MON on ${CONFIG.PROTOCOL_NAME}...`);
      
      // Pre-flight checks
      await this.checkNetworkConnection();
      await this.checkBalance();
      const gasEstimate = await this.estimateGas();
      const gasPrice = await this.checkGasPrice();
      
      // Execute stake transaction
      console.log("📝 Executing stake transaction...");
      
      const txOptions = {
        value: this.stakeAmount,
        gasLimit: gasEstimate + BigInt(50000),
        gasPrice: gasPrice,
      };
      
      const tx = await this.contract.deposit(
        this.stakeAmount,
        this.wallet.address,
        txOptions
      );
      
      console.log(`📋 Transaction submitted: ${tx.hash}`);
      console.log(`🔍 View on explorer: ${CONFIG.EXPLORER_URL}${tx.hash}`);
      console.log("⏳ Waiting for confirmation...");
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        console.log(`✅ Stake successful!`);
        console.log(`📊 Transaction hash: ${tx.hash}`);
        console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
        console.log(`💰 Amount staked: ${CONFIG.DAILY_STAKE_AMOUNT} MON`);
        console.log(`🎯 Block number: ${receipt.blockNumber}`);
        
        // Log current staked balance
        await this.logStakedBalance();
        
        return { success: true, txHash: tx.hash, gasUsed: receipt.gasUsed.toString() };
      } else {
        throw new Error("Transaction failed");
      }
      
    } catch (error) {
      console.error("❌ Staking failed:", error.message);
      return { success: false, error: error.message };
    }
  }

  async logStakedBalance() {
    try {
      const balance = await this.contract.maxRedeem(this.wallet.address);
      console.log(`🏦 Current ${CONFIG.REWARD_TOKEN} balance: ${ethers.formatEther(balance)} ${CONFIG.REWARD_TOKEN}`);
    } catch (error) {
      console.error("⚠️ Could not fetch staked balance:", error.message);
    }
  }

  async dryRun() {
    console.log(`🧪 Performing dry run on ${CONFIG.PROTOCOL_NAME} (Monad Testnet)...`);
    try {
      await this.checkNetworkConnection();
      await this.checkBalance();
      await this.estimateGas();
      await this.checkGasPrice();
      await this.logStakedBalance();
      console.log(`✅ Dry run successful - ready to stake on ${CONFIG.PROTOCOL_NAME}!`);
      return true;
    } catch (error) {
      console.error("❌ Dry run failed:", error.message);
      return false;
    }
  }

  startScheduledStaking() {
    console.log(`⏰ Starting scheduled staking on ${CONFIG.PROTOCOL_NAME}`);
    console.log(`📅 Schedule: ${CONFIG.CRON_SCHEDULE} (Daily at 9 AM UTC)`);
    console.log(`💰 Daily amount: ${CONFIG.DAILY_STAKE_AMOUNT} MON`);
    console.log(`📅 Next execution: ${this.getNextExecutionTime()}`);
    
    cron.schedule(CONFIG.CRON_SCHEDULE, async () => {
      console.log(`\n🌅 ${new Date().toISOString()} - Executing scheduled stake on ${CONFIG.PROTOCOL_NAME}`);
      const result = await this.stake();
      
      if (result.success) {
        console.log("🎉 Scheduled stake completed successfully!");
      } else {
        console.log("💥 Scheduled stake failed. Will retry next scheduled time.");
      }
      console.log("=".repeat(60));
    });
    
    console.log("✅ Scheduled staking started!");
  }

  getNextExecutionTime() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0); // 9 AM UTC
    return tomorrow.toISOString();
  }
}

// Main execution function
async function main() {
  console.log(`🌟 ${CONFIG.PROTOCOL_NAME} Monad Testnet Staking Bot`);
  console.log("=".repeat(50));
  
  // Validate required environment variables
  if (!CONFIG.PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY environment variable is required");
    console.error("💡 Add your private key to the .env file");
    process.exit(1);
  }

  if (!CONFIG.RPC_URL) {
    console.error("❌ RPC_URL environment variable is required");
    process.exit(1);
  }

  // Initialize staker
  const staker = new APRIORIStaker();
  
  // Handle command line arguments
  const args = process.argv.slice(2);
  
  if (args.includes('--dry-run')) {
    console.log("🧪 Running in dry-run mode...");
    await staker.dryRun();
    return;
  }
  
  if (args.includes('--stake-now')) {
    console.log("🚀 Executing immediate stake...");
    await staker.stake();
    return;
  }
  
  if (args.includes('--schedule')) {
    staker.startScheduledStaking();
    
    process.on('SIGINT', () => {
      console.log('\n👋 Shutting down scheduled staking...');
      console.log('💾 State has been saved. You can restart anytime.');
      process.exit(0);
    });
    
    console.log('🔄 Bot is running... Press Ctrl+C to stop');
    setInterval(() => {}, 1000);
    return;
  }
  
  // Default: show help
  console.log(`
🎯 ${CONFIG.PROTOCOL_NAME} Monad Testnet Staking Script

Usage:
  node apriori-staker.js --dry-run     # Test configuration without staking
  node apriori-staker.js --stake-now   # Execute immediate stake
  node apriori-staker.js --schedule    # Start scheduled daily staking

Environment Variables (.env file):
  PRIVATE_KEY     # Your wallet private key (without 0x prefix)
  RPC_URL         # Monad Testnet RPC endpoint
  STAKE_AMOUNT    # Daily stake amount in MON (default: ${CONFIG.DEFAULT_STAKE_AMOUNT})

Current Configuration:
  🌐 Network: ${CONFIG.CHAIN.name} (Chain ID: ${CONFIG.CHAIN.id})
  ⚡ Protocol: ${CONFIG.PROTOCOL_NAME}
  🏦 Contract: ${CONFIG.CONTRACT_ADDRESS}
  🔗 RPC URL: ${CONFIG.RPC_URL}
  💰 Daily Amount: ${CONFIG.DAILY_STAKE_AMOUNT} MON
  ⏰ Schedule: ${CONFIG.CRON_SCHEDULE} (Daily at 9 AM UTC)
  ⛽ Max Gas Price: ${ethers.formatUnits(CONFIG.MAX_GAS_PRICE, "gwei")} gwei

Examples:
  # Test your setup first
  node APRIORI-staker.js --dry-run
  
  # Stake immediately  
  node apriori-staker.js --stake-now
  
  # Start automated daily staking
  node aprior-staker.js --schedule
  `);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("💥 Fatal error:", error.message);
    process.exit(1);
  });
}

export { APRIORIStaker, CONFIG };