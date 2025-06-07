import { ethers } from 'ethers';
import cron from 'node-cron';
import { KINTSU_CONFIG, KINTSU_ABI } from './protocols/kintsu-config.js';
import { MAGMA_CONFIG, MAGMA_ABI, ERC20_ABI } from './protocols/magma-config.js';
import { APRIORI_CONFIG, APRIORI_ABI } from './protocols/apriori-config.js';
import { monadTestnet } from 'viem/chains';
import 'dotenv/config';

const UNIFIED_CONFIG = {
  RPC_URL: process.env.RPC_URL || "https://testnet-rpc.monad.xyz",
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  CHAIN: monadTestnet,
  CRON_SCHEDULE: process.env.CRON_SCHEDULE || "0 9 * * *",
  STAKING_FREQUENCY: parseInt(process.env.STAKING_FREQUENCY) || 1,
  ENABLED_PROTOCOLS: (process.env.ENABLED_PROTOCOLS || "kintsu,magma,apriori").split(',').map(p => p.trim().toLowerCase()),
  STAKE_AMOUNT: process.env.STAKE_AMOUNT || "0.01",
};

const PROTOCOLS = {
  kintsu: {
    config: KINTSU_CONFIG,
    abi: KINTSU_ABI,
    stake: async function(contract, amount, wallet) {
      return await contract.deposit(amount, wallet.address, { value: amount });
    },
    getBalance: async function(contract, wallet) {
      return await contract.balanceOf(wallet.address);
    }
  },
  magma: {
    config: MAGMA_CONFIG,
    abi: MAGMA_ABI,
    stake: async function(contract, amount, wallet) {
      const referralId = parseInt("8645b0", 16) || 8799664;
      console.log(`   🔗 Staking with referral ID: ${referralId}`);
      return await contract.depositMon(referralId, { value: amount });
    },
    getBalance: async function(contract, wallet) {
      try {
        const gMonTokenAddress = await contract.gMON();
        const gMonContract = new ethers.Contract(gMonTokenAddress, ERC20_ABI, wallet.provider);
        return await gMonContract.balanceOf(wallet.address);
      } catch (error) {
        console.error(`⚠️ Could not fetch Magma balance: ${error.message}`);
        return BigInt(0);
      }
    },
    checkStatus: async function(contract) {
      const isPaused = await contract.paused();
      if (isPaused) {
        throw new Error("Magma staking contract is currently paused");
      }
      return true;
    }
  },
  apriori: {
    config: APRIORI_CONFIG,
    abi: APRIORI_ABI,
    stake: async function(contract, amount, wallet) {
      return await contract.deposit(amount, wallet.address, { value: amount });
    },
    getBalance: async function(contract, wallet) {
      try {
        return await contract.maxRedeem(wallet.address);
      } catch (error) {
        console.error(`⚠️ Could not fetch Apriori balance: ${error.message}`);
        return BigInt(0);
      }
    }
  }
};

class UnifiedMultiProtocolStaker {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(UNIFIED_CONFIG.RPC_URL, {
      chainId: UNIFIED_CONFIG.CHAIN.id,
      name: UNIFIED_CONFIG.CHAIN.name,
    });
    
    this.wallet = new ethers.Wallet(UNIFIED_CONFIG.PRIVATE_KEY, this.provider);
    this.stakeAmount = ethers.parseEther(UNIFIED_CONFIG.STAKE_AMOUNT);
    this.contracts = {};
    
    this.initializeContracts();
    
    console.log(`🔗 Connected to: ${UNIFIED_CONFIG.CHAIN.name} (Chain ID: ${UNIFIED_CONFIG.CHAIN.id})`);
    console.log(`🏦 Wallet Address: ${this.wallet.address}`);
    console.log(`⚡ Enabled Protocols: ${UNIFIED_CONFIG.ENABLED_PROTOCOLS.join(', ').toUpperCase()}`);
    console.log(`🔄 Staking Frequency: ${UNIFIED_CONFIG.STAKING_FREQUENCY}x per day`);
  }

  initializeContracts() {
    for (const protocolName of UNIFIED_CONFIG.ENABLED_PROTOCOLS) {
      const protocol = PROTOCOLS[protocolName];
      if (!protocol) {
        console.warn(`⚠️ Unknown protocol: ${protocolName}`);
        continue;
      }
      
      this.contracts[protocolName] = new ethers.Contract(
        protocol.config.CONTRACT_ADDRESS,
        protocol.abi,
        this.wallet
      );
      
      console.log(`✅ ${protocolName.toUpperCase()} contract initialized: ${protocol.config.CONTRACT_ADDRESS}`);
    }
  }

  async checkNetworkConnection() {
    try {
      const network = await this.provider.getNetwork();
      console.log(`🌐 Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
      
      if (network.chainId !== BigInt(UNIFIED_CONFIG.CHAIN.id)) {
        throw new Error(`Wrong network! Expected ${UNIFIED_CONFIG.CHAIN.id}, got ${network.chainId}`);
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
      console.log(`💰 Total MON balance: ${balanceInMon} MON`);
      
      const requiredAmount = this.stakeAmount * BigInt(UNIFIED_CONFIG.ENABLED_PROTOCOLS.length);
      
      if (balance < requiredAmount) {
        throw new Error(`Insufficient MON balance. Need ${ethers.formatEther(requiredAmount)} MON for all protocols, have ${balanceInMon} MON`);
      }
      
      return balance;
    } catch (error) {
      console.error("❌ Error checking balance:", error.message);
      throw error;
    }
  }

  async stakeOnProtocol(protocolName) {
    const protocol = PROTOCOLS[protocolName];
    const contract = this.contracts[protocolName];
    
    if (!protocol || !contract) {
      throw new Error(`Protocol ${protocolName} not found or not initialized`);
    }
    
    try {
      console.log(`\n🎯 Staking on ${protocolName.toUpperCase()}...`);
      
      if (protocol.checkStatus) {
        await protocol.checkStatus(contract);
      }
      
      let gasEstimate;
      let maxRetries = 3;
      let retryCount = 0;
      let gasBuffer = 1.2; // 20% buffer for gas limit
      
      while (retryCount < maxRetries) {
        try {
          if (protocolName === 'magma') {
            const referralId = parseInt("8645b0", 16) || 8799664;
            gasEstimate = await contract.depositMon.estimateGas(referralId, { value: this.stakeAmount });
          } else if (protocolName === 'kintsu' || protocolName === 'apriori') {
            gasEstimate = await contract.deposit.estimateGas(this.stakeAmount, this.wallet.address, { value: this.stakeAmount });
          }
          
          gasEstimate = BigInt(Math.ceil(Number(gasEstimate) * gasBuffer));
          console.log(`   ⛽ Estimated gas (with ${((gasBuffer - 1) * 100).toFixed(0)}% buffer): ${gasEstimate.toString()}`);
          break;
        } catch (gasError) {
          retryCount++;
          gasBuffer += 0.1; // Increase buffer by 10% each retry
          console.warn(`   ⚠️ Gas estimation attempt ${retryCount}/${maxRetries} failed: ${gasError.message}`);
          if (retryCount === maxRetries) {
            console.error(`   ❌ Max retries reached for gas estimation`);
            throw gasError;
          }
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
        }
      }
      
      const feeData = await this.provider.getFeeData();
      const maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits("30", "gwei");
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits("2", "gwei");
      
      console.log(`   ⛽ Max Fee Per Gas: ${ethers.formatUnits(maxFeePerGas, "gwei")} gwei`);
      console.log(`   ⛽ Max Priority Fee Per Gas: ${ethers.formatUnits(maxPriorityFeePerGas, "gwei")} gwei`);
      
      const txOptions = {
        value: this.stakeAmount,
        gasLimit: gasEstimate,
        maxFeePerGas,
        maxPriorityFeePerGas
      };
      
      const tx = await protocol.stake(contract, this.stakeAmount, this.wallet, txOptions);
      
      console.log(`   📋 Transaction submitted: ${tx.hash}`);
      console.log(`   🔍 Explorer: ${protocol.config.EXPLORER_URL}${tx.hash}`);
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        console.log(`   ✅ ${protocolName.toUpperCase()} stake successful!`);
        console.log(`   ⛽ Gas used: ${receipt.gasUsed.toString()}`);
        console.log(`   💰 Amount: ${UNIFIED_CONFIG.STAKE_AMOUNT} MON`);
        
        return { 
          success: true, 
          protocol: protocolName,
          txHash: tx.hash, 
          gasUsed: receipt.gasUsed.toString() 
        };
      } else {
        throw new Error(`${protocolName} transaction failed`);
      }
      
    } catch (error) {
      console.error(`   ❌ ${protocolName.toUpperCase()} staking failed: ${error.message}`);
      return { 
        success: false, 
        protocol: protocolName,
        error: error.message 
      };
    }
  }

  async stakeOnAllProtocols() {
    console.log(`🚀 Starting multi-protocol staking session...`);
    console.log(`📊 Protocols: ${UNIFIED_CONFIG.ENABLED_PROTOCOLS.join(', ').toUpperCase()}`);
    console.log(`💰 Amount per protocol: ${UNIFIED_CONFIG.STAKE_AMOUNT} MON`);
    
    const results = [];
    let successCount = 0;
    let totalGasUsed = BigInt(0);
    
    await this.checkNetworkConnection();
    await this.checkBalance();
    
    for (const protocolName of UNIFIED_CONFIG.ENABLED_PROTOCOLS) {
      const result = await this.stakeOnProtocol(protocolName);
      results.push(result);
      
      if (result.success) {
        successCount++;
        if (result.gasUsed) {
          totalGasUsed += BigInt(result.gasUsed);
        }
      }
      
      if (UNIFIED_CONFIG.ENABLED_PROTOCOLS.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log(`\n📊 Multi-Protocol Staking Summary:`);
    console.log(`   ✅ Successful: ${successCount}/${UNIFIED_CONFIG.ENABLED_PROTOCOLS.length}`);
    console.log(`   ⛽ Total gas used: ${totalGasUsed.toString()}`);
    console.log(`   💰 Total staked: ${ethers.formatEther(this.stakeAmount * BigInt(successCount))} MON`);
    
    await this.logAllBalances();
    
    return {
      totalProtocols: UNIFIED_CONFIG.ENABLED_PROTOCOLS.length,
      successCount,
      results,
      totalGasUsed: totalGasUsed.toString()
    };
  }

  async logAllBalances() {
    console.log(`\n🏦 Current Staked Balances:`);
    
    for (const protocolName of UNIFIED_CONFIG.ENABLED_PROTOCOLS) {
      try {
        const protocol = PROTOCOLS[protocolName];
        const contract = this.contracts[protocolName];
        
        if (protocol && contract) {
          const balance = await protocol.getBalance(contract, this.wallet);
          const tokenName = protocol.config.REWARD_TOKEN;
          console.log(`   ${protocolName.toUpperCase()}: ${ethers.formatEther(balance)} ${tokenName}`);
        }
      } catch (error) {
        console.log(`   ${protocolName.toUpperCase()}: Error fetching balance`);
      }
    }
  }

  async dryRun() {
    console.log("🍒 Let’s warm up with a multi-protocol dry run...");
    
    try {
      await this.checkNetworkConnection();
      await this.checkBalance();
      
      const feeData = await this.provider.getFeeData();
      const maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits("30", "gwei");
      console.log(`  ⛽ Max Fee Per Gas: ${ethers.formatUnits(maxFeePerGas, "gwei")} gwei`);
      
      for (const protocolName of UNIFIED_CONFIG.ENABLED_PROTOCOLS) {
        console.log(`\n🔍 Checking ${protocolName.toUpperCase()}...`);
        
        const protocol = PROTOCOLS[protocolName];
        const contract = this.contracts[protocolName];
        
        if (protocol.checkStatus) {
          await protocol.checkStatus(contract);
          console.log(`   ✅ ${protocolName.toUpperCase()} status check passed - Ready to rock!`);
        }
        
        let gasEstimate;
        let maxRetries = 3;
        let retryCount = 0;
        let gasBuffer = 1.2; // 20% buffer
        
        while (retryCount < maxRetries) {
          try {
            if (protocolName === 'magma') {
              const referralId = parseInt("8645b0", 16) || 8799664;
              gasEstimate = await contract.depositMon.estimateGas(referralId, { value: this.stakeAmount });
              console.log(`   🔗 Using referral ID ${referralId} for Magma gas estimation`);
            } else if (protocolName === 'kintsu' || protocolName === 'apriori') {
              gasEstimate = await contract.deposit.estimateGas(this.stakeAmount, this.wallet.address, { value: this.stakeAmount });
            }
            gasEstimate = BigInt(Math.ceil(Number(gasEstimate) * gasBuffer));
            console.log(`   ✅ ${protocolName.toUpperCase()} gas estimation successful (with ${((gasBuffer - 1) * 100).toFixed(0)}% buffer): ${gasEstimate} - We're cooking! 🔥`);
            break;
          } catch (gasError) {
            retryCount++;
            gasBuffer += 0.1;
            console.log(`   ⚠️ ${protocolName.toUpperCase()} gas estimation attempt ${retryCount}/${maxRetries} failed: ${gasError.message}`);
            if (retryCount === maxRetries) {
              console.log(`   ❌ Max retries reached for ${protocolName.toUpperCase()} gas estimation`);
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      await this.logAllBalances();
      console.log("\n✅ Multi-protocol dry run completed successfully - High five! ✋");
      return true;
      
    } catch (error) {
      console.error(`❌ Dry run crashed: ${error.message} - Time to debug!`);
      return false;
    }
  }

  startScheduledStaking() {
    console.log(`⏰ Starting scheduled multi-protocol staking`);
    console.log(`🔄 Frequency: ${UNIFIED_CONFIG.STAKING_FREQUENCY}x per day`);
    console.log(`⚡ Protocols: ${UNIFIED_CONFIG.ENABLED_PROTOCOLS.join(', ').toUpperCase()}`);

    const now = new Date();
    const startHour = now.getHours();
    const startMinute = now.getMinutes();
    const frequency = UNIFIED_CONFIG.STAKING_FREQUENCY;
    const intervalHours = 24 / frequency;

    if (24 % frequency !== 0) {
      console.warn(`⚠️ Frequency ${frequency} does not divide 24 evenly. Staking may not align with daily boundaries.`);
    }

    let cronSchedules = [];
    for (let i = 0; i < frequency; i++) {
      const hour = (startHour + i * intervalHours) % 24;
      const schedule = `${startMinute} ${hour} * * *`;
      cronSchedules.push(schedule);
    }

    cronSchedules.forEach((schedule, index) => {
      cron.schedule(schedule, async () => {
        console.log(`\n🌅 ${new Date().toISOString()} - Grab your coffee, it’s staking time! (${index + 1}/${frequency})`);
        const result = await this.stakeOnAllProtocols();
        
        if (result.successCount > 0) {
          console.log(`🎉 Scheduled staking completed! ${result.successCount}/${result.totalProtocols} protocols successful`);
        } else {
          console.log("💥 All scheduled stakes failed. We'll retry next time!");
        }
        console.log("=".repeat(80));
      });
      
      console.log(`📅 Scheduled job ${index + 1}: ${schedule}`);
    });

    console.log(`\n🌟 Staking immediately at ${now.toISOString()}`);
    this.stakeOnAllProtocols().then(result => {
      if (result.successCount > 0) {
        console.log(`🎉 Immediate staking completed! ${result.successCount}/${result.totalProtocols} protocols successful`);
      } else {
        console.log("💥 Immediate stake failed. We'll try again at the next scheduled time!");
      }
      console.log("=".repeat(80));
    });

    console.log("✅ Scheduled staking started - Let’s keep the stakes high!");
    
    this.displayCountdown();
  }

  getNextExecutionTimes() {
    const now = new Date();
    const startHour = now.getHours();
    const startMinute = now.getMinutes();
    const frequency = UNIFIED_CONFIG.STAKING_FREQUENCY;
    const intervalHours = 24 / frequency;

    const nextExecutions = [];
    for (let i = 0; i < frequency; i++) {
      const hour = (startHour + i * intervalHours) % 24;
      let next = new Date(now);
      next.setHours(hour);
      next.setMinutes(startMinute);
      next.setSeconds(0);
      next.setMilliseconds(0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      nextExecutions.push(next);
    }

    nextExecutions.sort((a, b) => a - b);
    return nextExecutions.map(date => date.toISOString());
  }

  displayCountdown() {
    setInterval(() => {
      const nextTimes = this.getNextExecutionTimes();
      if (nextTimes.length > 0) {
        const nextTime = new Date(nextTimes[0]);
        const now = new Date();
        const timeDiff = nextTime - now;
        
        if (timeDiff > 0) {
          const hours = Math.floor(timeDiff / (1000 * 60 * 60));
          const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);
          console.log(`⏳ Next staking in: ${hours}h ${minutes}m ${seconds}s`);
        } else {
          console.log(`⏳ Next staking is now!`);
        }
      } else {
        console.log(`⏳ No upcoming staking times.`);
      }
    }, 600000);
  }
}

async function main() {
  console.log("🌟 Unified Multi-Protocol Monad Testnet Staking Bot");
  console.log("=".repeat(60));
  
  if (!UNIFIED_CONFIG.PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY environment variable is required");
    process.exit(1);
  }
  
  if (UNIFIED_CONFIG.ENABLED_PROTOCOLS.length === 0) {
    console.error("❌ No protocols enabled. Set ENABLED_PROTOCOLS in .env");
    process.exit(1);
  }
  
  const invalidProtocols = UNIFIED_CONFIG.ENABLED_PROTOCOLS.filter(p => !PROTOCOLS[p]);
  if (invalidProtocols.length > 0) {
    console.error(`❌ Invalid protocols: ${invalidProtocols.join(', ')}`);
    console.error(`   Available protocols: ${Object.keys(PROTOCOLS).join(', ')}`);
    process.exit(1);
  }
  
  const staker = new UnifiedMultiProtocolStaker();
  const args = process.argv.slice(2);
  
  if (args.includes('--dry-run')) {
    console.log("🧪 Running in dry-run mode...");
    await staker.dryRun();
    return;
  }
  
  if (args.includes('--stake-now')) {
    console.log("🚀 Executing immediate multi-protocol stake...");
    await staker.stakeOnAllProtocols();
    return;
  }
  
  if (args.includes('--schedule')) {
    staker.startScheduledStaking();
    
    process.on('SIGINT', () => {
      console.log('\n👋 Shutting down multi-protocol staking bot...');
      process.exit(0);
    });
    
    console.log('🔄 Multi-protocol bot is running... Press Ctrl+C to stop');
    setInterval(() => {}, 1000);
    return;
  }
  
  console.log(`
🎯 Unified Multi-Protocol Staking Script

Usage:
  node unified-staker2.js --dry-run     # Test all protocols without staking
  node unified-staker2.js --stake-now   # Execute immediate stake on all protocols
  node unified-staker2.js --schedule    # Start scheduled staking

Environment Variables (.env file):
  PRIVATE_KEY           # Your wallet private key
  RPC_URL              # Monad Testnet RPC endpoint
  STAKE_AMOUNT         # Amount per protocol (default: 0.01)
  ENABLED_PROTOCOLS    # Comma-separated: kintsu,magma,apriori
  STAKING_FREQUENCY    # Times per day: 1-4 (default: 1)
  CRON_SCHEDULE        # Custom cron if frequency=1

Current Configuration:
  🌐 Network: ${UNIFIED_CONFIG.CHAIN.name}
  ⚡ Enabled Protocols: ${UNIFIED_CONFIG.ENABLED_PROTOCOLS.join(', ').toUpperCase()}
  💰 Amount per Protocol: ${UNIFIED_CONFIG.STAKE_AMOUNT} MON
  🔄 Frequency: ${UNIFIED_CONFIG.STAKING_FREQUENCY}x per day
  📅 Schedule: ${UNIFIED_CONFIG.CRON_SCHEDULE}

Available Protocols:
  🔷 KINTSU - ${PROTOCOLS.kintsu.config.CONTRACT_ADDRESS}
  🔶 MAGMA  - ${PROTOCOLS.magma.config.CONTRACT_ADDRESS}
  🔵 APRIORI - ${PROTOCOLS.apriori.config.CONTRACT_ADDRESS}

Examples:
  # Test all enabled protocols
  node unified-staker2.js --dry-run
  
  # Stake on all protocols immediately
  node unified-staker2.js --stake-now
  
  # Start automated staking
  node unified-staker2.js --schedule
  `);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("💥 Fatal error:", error.message);
    process.exit(1);
  });
}

export { UnifiedMultiProtocolStaker, UNIFIED_CONFIG, PROTOCOLS };