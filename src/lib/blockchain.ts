import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

export interface MarketInfo {
  id: string;
  question: string;
  creator: string;
  endTime: number;
  resolved: boolean;
  outcome?: number;
  totalVolume?: string;
  yesShares?: string;
  noShares?: string;
  active?: boolean;
  participants?: number;
}

export class BlockchainTools {
  private provider: ethers.JsonRpcProvider;
  private contractAddress: string;
  private contractABI: any[]= [];

  constructor() {
    this.provider = new ethers.JsonRpcProvider(
      process.env.XO_MARKET_RPC_URL || 'https://testnet-rpc-1.xo.market/'
    );
    this.contractAddress = process.env.XO_MARKET_CONTRACT || '0x3cf19D0C88a14477DCaA0A45f4AF149a4C917523';
    
    this.loadContractABI();
  }

  private loadContractABI(): void {
    try {
      const abiPath = path.join(process.cwd(), 'abi.json');
      
      console.log(`🔍 Looking for ABI file at: ${abiPath}`);
      
      if (fs.existsSync(abiPath)) {
        const abiData = fs.readFileSync(abiPath, 'utf-8');
        this.contractABI = JSON.parse(abiData);
        console.log(`✅ Loaded XO Market contract ABI with ${this.contractABI.length} items`);
        
        const functions = this.contractABI
          .filter(item => item.type === 'function')
          .map(func => func.name);
        console.log(`📋 Available contract functions: ${functions.join(', ')}`);
      } else {
        console.warn(`⚠️ abi.json not found at ${abiPath}, using fallback ABI`);
        this.contractABI = this.getFallbackABI();
      }
    } catch (error) {
      console.error('❌ Failed to load ABI:', error);
      this.contractABI = this.getFallbackABI();
    }
  }

  private getFallbackABI(): any[] {
    console.log('📋 Using fallback ABI');
    return [
      {
        "type": "function",
        "name": "totalMarkets",
        "inputs": [],
        "outputs": [{"type": "uint256", "name": ""}],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "markets",
        "inputs": [{"type": "uint256", "name": "marketId"}],
        "outputs": [
          {"type": "string", "name": "question"},
          {"type": "address", "name": "creator"},
          {"type": "uint256", "name": "endTime"},
          {"type": "bool", "name": "resolved"},
          {"type": "bool", "name": "active"}
        ],
        "stateMutability": "view"
      }
    ];
  }

  private async testConnection(): Promise<boolean> {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      console.log(`🔗 Connected to XO Market testnet (Chain ID: ${network.chainId}), Block: ${blockNumber}`);
      return true;
    } catch (error) {
      console.error('❌ XO Market testnet connection failed:', error);
      return false;
    }
  }

  private async contractExists(): Promise<boolean> {
    try {
      const code = await this.provider.getCode(this.contractAddress);
      const exists = code !== '0x';
      console.log(`📋 Contract ${this.contractAddress}: ${exists ? 'Found' : 'Not found'}`);
      return exists;
    } catch (error) {
      console.error('❌ Contract check failed:', error);
      return false;
    }
  }

  async getCurrentMarkets(): Promise<MarketInfo[]> {
    try {
      console.log('🔍 Connecting to XO Market testnet with loaded ABI...');
      
      const connected = await this.testConnection();
      if (!connected) {
        throw new Error('Cannot connect to XO Market testnet');
      }

      const exists = await this.contractExists();
      if (!exists) {
        console.log('⚠️ XO Market contract not found, using mock data');
        return this.getXOMockMarkets();
      }

      const contract = new ethers.Contract(
        this.contractAddress,
        this.contractABI,
        this.provider
      );

      console.log('📋 Contract instance created with loaded ABI');

      const markets: MarketInfo[] = [];
      
      try {
        const totalMarkets = await this.callWithTimeout(contract.totalMarkets(), 10000);
        console.log(`📊 Total markets on XO testnet: ${totalMarkets}`);

        const limit = Math.min(Number(totalMarkets), 10); // Limit to 10 for performance

        for (let i = 0; i < limit; i++) {
          try {
            const marketData = await this.callWithTimeout(contract.markets(i), 5000);
            
            let additionalInfo = null;
            try {
              if (contract.getMarketInfo) {
                additionalInfo = await this.callWithTimeout(contract.getMarketInfo(i), 3000);
              }
            } catch {
            }

            const market: MarketInfo = {
              id: i.toString(),
              question: marketData.question || marketData[0] || `Market ${i}`,
              creator: marketData.creator || marketData[1] || '0x0000000000000000000000000000000000000000',
              endTime: Number(marketData.endTime || marketData[2] || Date.now() + 86400000),
              resolved: marketData.resolved || marketData[3] || false,
              active: marketData.active !== undefined ? marketData.active : (marketData[4] !== undefined ? marketData[4] : true),
            };

            if (additionalInfo) {
              market.totalVolume = ethers.formatEther(additionalInfo.totalVolume || 0);
            }

            markets.push(market);
            console.log(`✅ Loaded market ${i}: ${market.question.substring(0, 50)}...`);

          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
console.warn(`⚠️ Could not fetch market ${i}:`, errorMessage);
          }
        }

      } catch (error) {
        console.error('❌ Failed to get markets from contract:', error);
        
        try {
          if (contract.getActiveMarketCount) {
            const activeCount = await this.callWithTimeout(contract.getActiveMarketCount(), 5000);
            console.log(`📊 Active markets: ${activeCount}`);
            
            if (Number(activeCount) > 0) {
              return this.getXOMockMarkets(Number(activeCount));
            }
          }
        } catch {
          console.log('📊 Using fallback data due to contract call failures');
        }
      }

      console.log(`✅ Successfully retrieved ${markets.length} markets from XO testnet using ABI`);
      return markets.length > 0 ? markets : this.getXOMockMarkets();

    } catch (error) {
      console.error('🚫 XO Market blockchain fetch failed:', error);
      return this.getXOMockMarkets();
    }
  }

  private async callWithTimeout<T>(promise: Promise<T>, timeoutMs: number = 5000): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(`Contract call timeout after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  private getXOMockMarkets(count: number = 5): MarketInfo[] {
    console.log(`📋 Providing ${count} XO Market demo markets`);
    
    const mockMarkets: MarketInfo[] = [
      {
        id: "0",
        question: "Will Bitcoin reach $100,000 by end of 2024?",
        creator: "0x1234567890abcdef1234567890abcdef12345678",
        endTime: new Date('2024-12-31').getTime(),
        resolved: false,
        active: true,
        totalVolume: "2.5",
        participants: 87,
      },
      {
        id: "1",
        question: "Will XO Market have 1000+ active users by Q1 2025?",
        creator: "0xabcdef1234567890abcdef1234567890abcdef12",
        endTime: new Date('2025-03-31').getTime(),
        resolved: false,
        active: true,
        totalVolume: "1.8",
        participants: 52,
      },
      {
        id: "2",
        question: "Will AI achieve breakthrough in prediction markets by 2025?",
        creator: "0x9876543210fedcba9876543210fedcba98765432",
        endTime: new Date('2025-12-31').getTime(),
        resolved: false,
        active: true,
        totalVolume: "3.2",
        participants: 134,
      },
      {
        id: "3",
        question: "Will Ethereum price exceed $5000 in 2025?",
        creator: "0xfedcba9876543210fedcba9876543210fedcba98",
        endTime: new Date('2025-12-31').getTime(),
        resolved: false,
        active: true,
        totalVolume: "0.9",
        participants: 23,
      },
      {
        id: "4",
        question: "Will decentralized prediction markets gain mainstream adoption?",
        creator: "0x1111222233334444555566667777888899990000",
        endTime: new Date('2026-01-31').getTime(),
        resolved: false,
        active: true,
        totalVolume: "4.1",
        participants: 98,
      }
    ];

    return mockMarkets.slice(0, count);
  }

  async getNetworkInfo() {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      
      return {
        chainId: Number(network.chainId),
        name: "XO Market Testnet",
        blockNumber,
        rpcUrl: process.env.XO_MARKET_RPC_URL,
        contractAddress: this.contractAddress,
        abiLoaded: this.contractABI.length > 0,
        availableMethods: this.getAvailableMethods(),
      };
    } catch (error) {
      console.error('Error fetching XO Market network info:', error);
      return {
        chainId: 0,
        name: "XO Market Testnet (offline)",
        blockNumber: 0,
        rpcUrl: process.env.XO_MARKET_RPC_URL,
        contractAddress: this.contractAddress,
        abiLoaded: false,
      };
    }
  }

  private getAvailableMethods(): string[] {
    if (!this.contractABI) return [];
    
    return this.contractABI
      .filter(item => item.type === 'function')
      .map(func => func.name)
      .filter(Boolean);
  }
}
