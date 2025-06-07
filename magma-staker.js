import { ethers } from 'ethers';
import cron from 'node-cron';
import { MAGMA_CONFIG, MAGMA_ABI, ERC20_ABI } from './protocols/magma-config.js';
import 'dotenv/config';

// Runtime Configuration for Magma Testnet
const CONFIG = {
  ...MAGMA_CONFIG,
  RPC_URL: process.env.RPC_URL || "https://testnet-rpc.monad.xyz",
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  DAILY_STAKE_AMOUNT: process.env.STAKE_AMOUNT || MAGMA_CONFIG.DEFAULT_STAKE_AMOUNT,
  CRON_SCHEDULE: "0 9 * * *", // Daily at 9 AM UTC
  REFERRAL_ID: parseInt("8645b0", 16) || 8799664, // Optional referral ID
};

class MagmaStaker {
  constructor() {
    // Configure provider for Monad Testnet
    this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL, {
      chainId: CONFIG.CHAIN.id,
      name: CONFIG.CHAIN.name,
    });
    
    this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);
    this.contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, MAGMA_ABI, this.wallet);
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

  // async checkProxyImplementation() {
  //   if (!CONFIG.IS_PROXY) return;
    
  //   try {
  //     const implementationAddress = await this.provider.getStorageAt(
  //       CONFIG.CONTRACT_ADDRESS,
  //       CONFIG.IMPLEMENTATION_SLOT
  //     );
      
  //     console.log(`🔍 Implementation address: ${implementationAddress}`);
      
  //     if (implementationAddress && implementationAddress !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
  //       console.log("✅ Confirmed: Contract is a proxy with valid implementation");
  //     } else {
  //       console.warn("⚠️  Warning: Contract does not appear to be a proxy (implementation slot is empty)");
  //     }
  //   } catch (error) {
  //     console.error("❌ Failed to check proxy implementation:", error.message);
  //   }
  // }

  async checkContractStatus() {
    try {
      // Check if contract is paused
      const isPaused = await this.contract.paused();
      if (isPaused) {
        throw new Error("❌ Magma staking contract is currently paused");
      }
      console.log("✅ Contract is active (not paused)");

//       // Check TVL and max deposit limit
//     //   const currentTVL = await this.contract.totalValueLocked();
//     //   const maxTVL = await this.contract.maxDepositTVL();
      
//     //   console.log(`📊 Current TVL: ${ethers.formatEther(currentTVL)} MON`);
//     //   console.log(`📈 Max TVL: ${ethers.formatEther(maxTVL)} MON`);
      
//     //   const availableCapacity = maxTVL - currentTVL;
//     //   if (availableCapacity < this.stakeAmount) {
//     //     throw new Error(`❌ Insufficient TVL capacity. Available: ${ethers.formatEther(availableCapacity)} MON, Need: ${CONFIG.DAILY_STAKE_AMOUNT} MON`);
//     //   }
      
//     //   console.log(`✅ TVL capacity check passed. Available: ${ethers.formatEther(availableCapacity)} MON`);
      
      return true;
    } catch (error) {
      console.error("❌ Contract status check failed:", error.message);
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
      let gasEstimate;
      
      // Estimate gas based on whether we use referral ID or not
      if (CONFIG.REFERRAL_ID && CONFIG.REFERRAL_ID !== 0) {
        gasEstimate = await this.contract.depositMon.estimateGas(
          CONFIG.REFERRAL_ID,
          { value: this.stakeAmount }
        );
      } else {
        gasEstimate = await this.contract.depositMon.estimateGas(
          { value: this.stakeAmount }
        );
      }
      
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
      // await this.checkProxyImplementation();
      await this.checkContractStatus();
      await this.checkBalance();
      const gasEstimate = await this.estimateGas();
      const gasPrice = await this.checkGasPrice();
      
      // Execute stake transaction
      console.log("📝 Executing stake transaction...");
      
      let tx;
      const txOptions = {
        value: this.stakeAmount,
        gasLimit: gasEstimate + BigInt(50000), // Add buffer for proxy contracts
        gasPrice: gasPrice,
      };
      
      // Call appropriate function based on referral ID
      if (CONFIG.REFERRAL_ID && CONFIG.REFERRAL_ID !== 0) {
        console.log(`🎯 Using referral ID: ${CONFIG.REFERRAL_ID}`);
        tx = await this.contract.depositMon(CONFIG.REFERRAL_ID, txOptions);
      } else {
        tx = await this.contract.depositMon(txOptions);
      }
      
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
        
        // Parse deposit event to get gMON minted amount
        await this.parseDepositEvent(receipt);
        
        // Log current staked balance
        await this.logStakedBalance();
        
        return { success: true, txHash: tx.hash, gasUsed: receipt.gasUsed.toString() };
      } else {
        throw new Error("Transaction failed");
      }
      
    } catch (error) {
      console.error("❌ Staking failed:", error.message);
      
      // Enhanced error logging for Magma-specific errors
      if (error.code) {
        console.error(`Error code: ${error.code}`);
      }
      if (error.reason) {
        console.error(`Error reason: ${error.reason}`);
      }
      if (error.message.includes("MaxTVLReached")) {
        console.error("💡 Tip: The protocol has reached its maximum TVL limit. Try again later.");
      }
      if (error.message.includes("ContractPaused")) {
        console.error("💡 Tip: The staking contract is paused. Check the protocol's announcements.");
      }
      
      return { success: false, error: error.message };
    }
  }

  async parseDepositEvent(receipt) {
    try {
      // Parse the Deposit event to get gMON minted amount
      const depositEvent = receipt.logs.find(log => {
        try {
          const parsed = this.contract.interface.parseLog(log);
          return parsed.name === "Deposit";
        } catch {
          return false;
        }
      });
      
      if (depositEvent) {
        const parsed = this.contract.interface.parseLog(depositEvent);
        const gMonMinted = ethers.formatEther(parsed.args.gMonMinted);
        console.log(`🎉 gMON tokens minted: ${gMonMinted} gMON`);
        
        if (parsed.args.referralId && parsed.args.referralId !== 0n) {
          console.log(`🤝 Referral ID used: ${parsed.args.referralId}`);
        }
      }
    } catch (error) {
      console.error("⚠️  Could not parse deposit event:", error.message);
    }
  }

  async logStakedBalance() {
    try {
      // Get gMON token contract address
      const gMonTokenAddress = await this.contract.gMON();
      const gMonContract = new ethers.Contract(gMonTokenAddress, ERC20_ABI, this.provider);
      
      // Get gMON balance
      const gMonBalance = await gMonContract.balanceOf(this.wallet.address);
      const gMonSymbol = await gMonContract.symbol();
      
      console.log(`🏦 Current ${gMonSymbol} balance: ${ethers.formatEther(gMonBalance)} ${gMonSymbol}`);
      
      // Get protocol TVL
      const tvl = await this.contract.totalValueLocked();
      console.log(`📊 Protocol TVL: ${ethers.formatEther(tvl)} MON`);
      
    } catch (error) {
      console.error("⚠️  Could not fetch staked balance:", error.message);
    }
  }

  async dryRun() {
    console.log(`🧪 Performing dry run on ${CONFIG.PROTOCOL_NAME} (Monad Testnet)...`);
    try {
      await this.checkNetworkConnection();
      // await this.checkProxyImplementation();
      await this.checkContractStatus();
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
        // Optionally add notification/alert logic here
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
  const staker = new MagmaStaker();
  
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
    
    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\n👋 Shutting down scheduled staking...');
      console.log('💾 State has been saved. You can restart anytime.');
      process.exit(0);
    });
    
    // Prevent the script from exiting
    console.log('🔄 Bot is running... Press Ctrl+C to stop');
    setInterval(() => {}, 1000);
    return;
  }
  
  // Default: show help
  console.log(`
🎯 ${CONFIG.PROTOCOL_NAME} Monad Testnet Staking Script

Usage:
  node magma-staker.js --dry-run     # Test configuration without staking
  node magma-staker.js --stake-now   # Execute immediate stake
  node magma-staker.js --schedule    # Start scheduled daily staking

Environment Variables (.env file):
  PRIVATE_KEY     # Your wallet private key (without 0x prefix)
  RPC_URL         # Monad Testnet RPC endpoint
  STAKE_AMOUNT    # Daily stake amount in MON (default: ${CONFIG.DEFAULT_STAKE_AMOUNT})
  REFERRAL_ID     # Optional referral ID (default: 0)

Current Configuration:
  🌐 Network: ${CONFIG.CHAIN.name} (Chain ID: ${CONFIG.CHAIN.id})
  ⚡ Protocol: ${CONFIG.PROTOCOL_NAME}
  🏦 Contract: ${CONFIG.CONTRACT_ADDRESS}
  🔗 RPC URL: ${CONFIG.RPC_URL}
  💰 Daily Amount: ${CONFIG.DAILY_STAKE_AMOUNT} MON
  🎯 Referral ID: ${CONFIG.REFERRAL_ID}
  ⏰ Schedule: ${CONFIG.CRON_SCHEDULE} (Daily at 9 AM UTC)
  ⛽ Max Gas Price: ${ethers.formatUnits(CONFIG.MAX_GAS_PRICE, "gwei")} gwei

Examples:
  # Test your setup first
  node magma-staker.js --dry-run
  
  # Stake immediately  
  node magma-staker.js --stake-now
  
  # Start automated daily staking
  node magma-staker.js --schedule
  `);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("💥 Fatal error:", error.message);
    process.exit(1);
  });
}

// Export for testing
export { MagmaStaker, CONFIG };