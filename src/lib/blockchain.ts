import { ethers } from 'ethers';
import { EmbedBuilder } from 'discord.js';

interface MarketStruct {
  id: bigint;
  winningOutcome: bigint;
  resolver: string;
  expiresAt: bigint;
  startsAt: bigint;
  creatorFeeBps: bigint;
  collateralToken: string;
  createdAt: bigint;
  resolvedAt: bigint;
  alpha: bigint;
  outcomeCount: bigint;
  status: bigint;
  outcomeTokenStartIndex: bigint;
  pausedAt: bigint;
  collateralAmount: bigint;
  redeemableAmountPerShare: bigint;
}

interface ExtendedMarketStruct {
  market: MarketStruct;
  collateralAmounts: bigint[];
  outcomePrices: bigint[];
}

enum MarketStatus {
  PENDING = 0,
  ACTIVE = 1,
  PAUSED = 2,
  RESOLVED = 3,
  CANCELLED = 4,
  CLOSED = 5
}

export interface MarketData {
  id: number;
  title: string;
  status: 'active' | 'closed' | 'resolved' | 'paused' | 'cancelled' | 'pending';
  expiresAt: Date;
  startsAt: Date;
  createdAt: Date;
  resolvedAt?: Date;
  winningOutcome?: number;
  outcomeCount: number;
  collateralToken: string;
  collateralAmount: string;
  creatorFeeBps: number;
  alpha: number;
  resolver: string;
  volume: string;
  openInterest: string;
  outcomePrices: string[];
  outcomes?: string[];
  description?: string;
  totalVolume?: string;
  totalVolumeRaw?: string;
  openInterestRaw?: string;
  timeToClose?: number;
  timeToResolve?: number;
  currentPrices?: string[];
  metadata?: {
    title?: string;
    description?: string;
    outcomes?: string[];
  };
}

export interface MarketMetadata {
  title: string;
  description?: string;
  outcomes?: string[];
}

const XO_MARKET_ABI = [
  "function getExtendedMarket(uint256 marketId) view returns (tuple(tuple(uint128 id, uint128 winningOutcome, address resolver, uint40 expiresAt, uint40 startsAt, uint16 creatorFeeBps, address collateralToken, uint40 createdAt, uint40 resolvedAt, uint16 alpha, uint8 outcomeCount, uint8 status, uint128 outcomeTokenStartIndex, uint40 pausedAt, uint256 collateralAmount, uint256 redeemableAmountPerShare) market, uint256[] collateralAmounts, uint256[] outcomePrices))",
  "function getMarket(uint256 marketId) view returns (tuple(uint128 id, uint128 winningOutcome, address resolver, uint40 expiresAt, uint40 startsAt, uint16 creatorFeeBps, address collateralToken, uint40 createdAt, uint40 resolvedAt, uint16 alpha, uint8 outcomeCount, uint8 status, uint128 outcomeTokenStartIndex, uint40 pausedAt, uint256 collateralAmount, uint256 redeemableAmountPerShare))",
  "function getPrices(uint256 marketId) view returns (uint256[])"
];

const NFT_ABI = [
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function name() view returns (string)",
  "function symbol() view returns (string)"
];

class FormatUtils {
  static formatCurrency(amount: string | number, decimals: number = 2): string {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(num)) return '$0.00';
    
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(num);
  }

  static formatPrice(price: string | number): string {
    const num = typeof price === 'string' ? parseFloat(price) : price;
    if (isNaN(num)) return '$0.0000';
    
    return `$${num.toFixed(4)}`;
  }

  static formatTimeUntilExpiry(expiryDate: Date): string {
    const now = new Date();
    const timeDiff = expiryDate.getTime() - now.getTime();
    
    if (timeDiff <= 0) {
      const pastTime = Math.abs(timeDiff);
      const days = Math.floor(pastTime / (1000 * 60 * 60 * 24));
      const hours = Math.floor((pastTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      
      if (days > 0) {
        return `${days}d ${hours}h ago`;
      } else {
        return `${Math.floor(pastTime / (1000 * 60 * 60))}h ago`;
      }
    }

    const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
      return `in ${days}d ${hours}h`;
    } else if (hours > 0) {
      return `in ${hours}h ${minutes}m`;
    } else {
      return `in ${minutes}m`;
    }
  }
}

export class BlockchainTools {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private nftContract: ethers.Contract;
  private contractAddress: string;
  private nftAddress: string;
  private isConnected = false;

  constructor() {
    const rpcUrl = process.env.XO_MARKET_RPC_URL || 'https://testnet-rpc-1.xo.market/';
    const contractAddress = process.env.XO_MARKET_CONTRACT || '0x3cf19D0C88a14477DCaA0A45f4AF149a4C917523';
    const nftAddress = process.env.XO_MARKET_NFT_CONTRACT || '0x550318A123d222e841776a281F51B09e8909E144';

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.contractAddress = contractAddress;
    this.nftAddress = nftAddress;
    this.contract = new ethers.Contract(contractAddress, XO_MARKET_ABI, this.provider);
    this.nftContract = new ethers.Contract(nftAddress, NFT_ABI, this.provider);
  }

  async init(): Promise<void> {
    try {
      const block = await this.provider.getBlockNumber();
      console.log(`📡 Connected to block: ${block}`);
      this.isConnected = true;
    } catch (error) {
      console.error('❌ Blockchain connection failed:', error);
      this.isConnected = false;
      throw error;
    }
  }

  async getMarketMetadata(marketId: number): Promise<MarketMetadata | null> {
    try {
      const tokenURI = await this.nftContract.tokenURI(marketId);
      
      if (tokenURI.startsWith('data:application/json;base64,')) {
        const base64Data = tokenURI.split(',')[1];
        const jsonString = Buffer.from(base64Data, 'base64').toString('utf-8');
        const metadata = JSON.parse(jsonString);
        
        return {
          title: metadata.title || metadata.name || metadata.description || `Market #${marketId}`,
          description: metadata.description,
          outcomes: metadata.attributes?.find((attr: any) => attr.trait_type === 'outcomes')?.value?.split(',') || undefined
        };
      } else if (tokenURI.startsWith('http')) {
        const response = await fetch(tokenURI);
        const metadata = await response.json();
        
        return {
          title: metadata.title || metadata.name || metadata.description || `Market #${marketId}`,
          description: metadata.description,
          outcomes: metadata.attributes?.find((attr: any) => attr.trait_type === 'outcomes')?.value?.split(',') || undefined
        };
      }
      
      return null;
    } catch (error) {
      console.warn(`Could not fetch metadata for market ${marketId}:`, error);
      return null;
    }
  }

  private parseMarketStatus(status: number): MarketData['status'] {
    switch (status) {
      case MarketStatus.PENDING: return 'pending';
      case MarketStatus.ACTIVE: return 'active';
      case MarketStatus.PAUSED: return 'paused';
      case MarketStatus.RESOLVED: return 'resolved';
      case MarketStatus.CANCELLED: return 'cancelled';
      case MarketStatus.CLOSED: return 'closed';
      default: return 'active';
    }
  }

  // ========== Main Market Fetching ==========
  async getExtendedMarket(marketId: number): Promise<MarketData | null> {
    try {
      const [extendedData, metadata] = await Promise.all([
        this.contract.getExtendedMarket(marketId),
        this.getMarketMetadata(marketId)
      ]);
      
      const market = extendedData.market;
      
      const outcomePrices = extendedData.outcomePrices.map((price: bigint) => 
        ethers.formatUnits(price, 6)
      );

      const totalCollateral = extendedData.collateralAmounts.reduce((sum: bigint, amount: bigint) => sum + amount, BigInt(0));
      
      const resolvedAt = market.resolvedAt > 0 ? new Date(Number(market.resolvedAt) * 1000) : undefined;
      const winningOutcome = market.winningOutcome > 0 ? Number(market.winningOutcome) : undefined;
      
      let actualStatus = this.parseMarketStatus(Number(market.status));
      if (resolvedAt && winningOutcome !== undefined) {
        actualStatus = 'resolved';
      } else if (new Date() > new Date(Number(market.expiresAt) * 1000)) {
        actualStatus = 'closed';
      }

      const expiresAt = new Date(Number(market.expiresAt) * 1000);
      const now = new Date();
      const timeToClose = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
      const timeToResolve = resolvedAt ? 0 : Math.max(0, timeToClose + 86400);

      const volumeFormatted = ethers.formatUnits(totalCollateral, 6);
      const oiFormatted = ethers.formatUnits(market.collateralAmount, 6);
      
      return {
        id: Number(market.id),
        title: metadata?.title || `Market #${marketId}`,
        status: actualStatus,
        expiresAt,
        startsAt: new Date(Number(market.startsAt) * 1000),
        createdAt: new Date(Number(market.createdAt) * 1000),
        resolvedAt,
        winningOutcome,
        outcomeCount: Number(market.outcomeCount),
        collateralToken: market.collateralToken,
        collateralAmount: ethers.formatUnits(market.collateralAmount, 6),
        creatorFeeBps: Number(market.creatorFeeBps),
        alpha: Number(market.alpha),
        resolver: market.resolver,
        volume: volumeFormatted,
        openInterest: oiFormatted,
        outcomePrices,
        outcomes: metadata?.outcomes,
        description: metadata?.description,
        totalVolume: volumeFormatted,
        totalVolumeRaw: volumeFormatted,
        openInterestRaw: oiFormatted,
        timeToClose,
        timeToResolve,
        currentPrices: outcomePrices.map((p: string) => (parseFloat(p) * 100).toFixed(2)),
        metadata: {
          title: metadata?.title || `Market #${marketId}`,
          description: metadata?.description,
          outcomes: metadata?.outcomes
        }
      };
    } catch (error) {
      console.error(`Error fetching extended market ${marketId}:`, error);
      return null;
    }
  }

  async getMarketById(marketId: string): Promise<MarketData | null> {
    const id = parseInt(marketId);
    return await this.getExtendedMarket(id);
  }

  async getCurrentMarkets(): Promise<MarketData[]> {
    const marketIds = Array.from({ length: 30 }, (_, i) => i + 1);
    const markets = await this.getMultipleMarkets(marketIds);
    return markets;
  }

  async getActiveMarkets(): Promise<MarketData[]> {
    const allMarkets = await this.getCurrentMarkets();
    return allMarkets.filter(market => market.status === 'active');
  }

  async getClosingSoonMarkets(hoursAhead: number = 24): Promise<MarketData[]> {
    const activeMarkets = await this.getActiveMarkets();
    const cutoffTime = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
    
    return activeMarkets
      .filter(market => market.expiresAt <= cutoffTime)
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  }

  async getHighVolumeMarkets(limit: number = 10): Promise<MarketData[]> {
    const activeMarkets = await this.getActiveMarkets();
    
    return activeMarkets
      .sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume))
      .slice(0, limit);
  }

  async getNewlyCreatedMarkets(daysBack: number = 7): Promise<MarketData[]> {
    const allMarkets = await this.getCurrentMarkets();
    const cutoffTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    
    return allMarkets
      .filter(market => market.createdAt >= cutoffTime)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getResolvedMarkets(limit: number = 10): Promise<MarketData[]> {
    const allMarkets = await this.getCurrentMarkets();
    
    return allMarkets
      .filter(market => market.status === 'resolved')
      .sort((a, b) => (b.resolvedAt?.getTime() || 0) - (a.resolvedAt?.getTime() || 0))
      .slice(0, limit);
  }

  async getMarketsByStatus(status: string): Promise<MarketData[]> {
    const allMarkets = await this.getCurrentMarkets();
    return allMarkets.filter(market => market.status.toLowerCase() === status.toLowerCase());
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      blockNumber: 0,
      knownMarkets: 30
    };
  }

  async getMultipleMarkets(marketIds: number[]): Promise<MarketData[]> {
    const markets = await Promise.allSettled(
      marketIds.map(id => this.getExtendedMarket(id))
    );

    return markets
      .filter((result): result is PromiseFulfilledResult<MarketData | null> => 
        result.status === 'fulfilled' && result.value !== null
      )
      .map(result => result.value!);
  }
}

export class EmbedUtils {
  static createMarketDataEmbed(market: MarketData): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0x7C3AED) 
      .setTitle(`Market #${market.id} – ${market.title}`)
      .setTimestamp();

    const statusEmoji = {
      active: '🟢',
      closed: '🔴',
      resolved: '✅',
      paused: '⏸️',
      cancelled: '❌',
      pending: '🕒'
    }[market.status] || '❓';

    embed.setDescription(`${statusEmoji} **Status:** ${market.status.toUpperCase()}`);

    embed.addFields(
      {
        name: '📊 Market Info',
        value: `**Expires:** ${FormatUtils.formatTimeUntilExpiry(market.expiresAt)}\n**Volume:** ${FormatUtils.formatCurrency(market.volume)} USDC\n**Open Interest:** ${FormatUtils.formatCurrency(market.openInterest)} USDC`,
        inline: true
      },
      {
        name: '⚙️ Parameters', 
        value: `**Creator Fee:** ${(market.creatorFeeBps / 100).toFixed(2)}%\n**Alpha:** ${market.alpha}\n**Outcomes:** ${market.outcomeCount}`,
        inline: true
      }
    );

    if (market.outcomePrices.length > 0) {
      const priceText = market.outcomePrices
        .map((price, i) => {
          const outcomeName = market.outcomes?.[i] || `Outcome ${i + 1}`;
          return `**${outcomeName}:** ${FormatUtils.formatPrice(price)}`;
        })
        .join('\n');
      
      embed.addFields({
        name: '💰 Current Prices',
        value: priceText,
        inline: false
      });
    }

    embed.setFooter({ 
      text: '📊 Live data from XO Market Contract • Fresh: <1min ago' 
    });

    return embed;
  }

  static createErrorEmbed(error: string, suggestions?: string[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0xEF4444) // Red for errors
      .setTitle('❌ Error')
      .setDescription(error)
      .setTimestamp();

    if (suggestions && suggestions.length > 0) {
      embed.addFields({
        name: '💡 Suggestions',
        value: suggestions.map(s => `• ${s}`).join('\n'),
        inline: false
      });
    }

    embed.setFooter({ 
      text: '🔍 Check your input and try again' 
    });

    return embed;
  }
}

export const xoMarketService = new BlockchainTools(); 

