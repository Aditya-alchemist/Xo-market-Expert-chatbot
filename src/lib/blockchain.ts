import { ethers } from 'ethers';
import { EmbedBuilder } from 'discord.js';

// ===== On-chain structs =====
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

// ===== Public types =====
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
  volume: string;                  // formatted units(6)
  outcomePrices: string[];         // unit strings (e.g. "0.532100")
  outcomes?: string[];             // names from metadata
  description?: string;
  totalVolume?: string;            // alias of volume
  timeToClose?: number;            // seconds
  currentPrices?: string[];        // as percentages "53.21"
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

// ===== Contract ABIs =====
const XO_MARKET_ABI = [
  "function getExtendedMarket(uint256 marketId) view returns (tuple(tuple(uint128 id, uint128 winningOutcome, address resolver, uint40 expiresAt, uint40 startsAt, uint16 creatorFeeBps, address collateralToken, uint40 createdAt, uint40 resolvedAt, uint16 alpha, uint8 outcomeCount, uint8 status, uint128 outcomeTokenStartIndex, uint40 pausedAt, uint256 collateralAmount, uint256 redeemableAmountPerShare) market, uint256[] collateralAmounts, uint256[] outcomePrices))",
  "function getMarket(uint256 marketId) view returns (tuple(uint128 id, uint128 winningOutcome, address resolver, uint40 expiresAt, uint40 startsAt, uint16 creatorFeeBps, address collateralToken, uint40 createdAt, uint40 resolvedAt, uint16 alpha, uint8 outcomeCount, uint8 status, uint128 outcomeTokenStartIndex, uint40 pausedAt, uint256 collateralAmount, uint256 redeemableAmountPerShare))",
  "function getPrices(uint256 marketId) view returns (uint256[])",
  "function marketCount() view returns (uint256)"
];

const NFT_ABI = [
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function name() view returns (string)",
  "function symbol() view returns (string)"
];

// ===== In-process cache for discovery =====
let GLOBAL_MARKET_CACHE: { total: number; lastScanAt: number } = { total: 0, lastScanAt: 0 };
const SCAN_TTL_MS = Number(process.env.XO_MARKET_SCAN_TTL_MS || 5 * 60 * 1000); // 5 minutes
const HARD_MAX_ID = Number(process.env.XO_MARKET_MAX_ID || 5000);

// ===== Main class =====
export class BlockchainTools {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private nftContract: ethers.Contract;
  private contractAddress: string;
  private nftAddress: string;
  private isConnected = false;
  private totalMarkets = 0;

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
    const block = await this.provider.getBlockNumber();
    console.log(`📡 Connected to block: ${block}`);
    this.isConnected = true;

    try {
      const cnt = await this.contract.marketCount();
      this.totalMarkets = Number(cnt);
      GLOBAL_MARKET_CACHE.total = this.totalMarkets;
      GLOBAL_MARKET_CACHE.lastScanAt = Date.now();
      console.log(`📊 Total markets (marketCount): ${this.totalMarkets}`);
    } catch {
      const fresh = Date.now() - GLOBAL_MARKET_CACHE.lastScanAt < SCAN_TTL_MS;
      if (fresh && GLOBAL_MARKET_CACHE.total > 0) {
        this.totalMarkets = GLOBAL_MARKET_CACHE.total;
        console.log(`📊 Total markets (cache): ${this.totalMarkets}`);
      } else {
        console.warn('Could not fetch market count, using fallback scanning');
        this.totalMarkets = await this.scanForMarkets();
        GLOBAL_MARKET_CACHE.total = this.totalMarkets;
        GLOBAL_MARKET_CACHE.lastScanAt = Date.now();
      }
    }
  }

  // Fast discovery: exponential probing + binary search; capped by HARD_MAX_ID
  private async scanForMarkets(): Promise<number> {
    const exists = async (id: number) => {
      try { await this.contract.getMarket(id); return true; } catch { return false; }
    };

    if (!(await exists(1))) {
      console.log('🔍 No markets found at ID 1. Returning 0.');
      return 0;
    }

    let low = 1;
    let high = 1;
    while (high < HARD_MAX_ID && (await exists(high))) {
      low = high;
      high = Math.min(HARD_MAX_ID, high * 2);
    }

    let left = low, right = high, best = low;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (await exists(mid)) {
        best = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    let maxId = best;
    for (let id = best + 1; id <= Math.min(best + 20, HARD_MAX_ID); id++) {
      if (await exists(id)) maxId = id; else break;
    }

    console.log(`🔍 Scanned and found markets up to ID: ${maxId}`);
    return maxId;
  }

  async getMarketMetadata(marketId: number): Promise<MarketMetadata | null> {
    try {
      const tokenURI: string = await this.nftContract.tokenURI(marketId);

      const parseMetadata = (obj: any): MarketMetadata => ({
        title: obj.title || obj.name || obj.description || `Market #${marketId}`,
        description: obj.description,
        outcomes:
          obj.attributes?.find((a: any) => a?.trait_type === 'outcomes')?.value?.split(',') ||
          obj.outcomes ||
          undefined
      });

      if (tokenURI.startsWith('data:application/json;base64,')) {
        const base64Data = tokenURI.split(',')[1];
        const jsonString = Buffer.from(base64Data, 'base64').toString('utf-8');
        const metadataObj = JSON.parse(jsonString);
        return parseMetadata(metadataObj);
      } else if (tokenURI.startsWith('http')) {
        const res = await fetch(tokenURI);
        const metadataObj = await res.json();
        return parseMetadata(metadataObj);
      }

      return { title: `Market #${marketId}` };
    } catch (error) {
      console.warn(`Could not fetch metadata for market ${marketId}:`, error);
      return { title: `Market #${marketId}` };
    }
  }

  private determineMarketStatus(market: MarketStruct): MarketData['status'] {
    const now = new Date();
    const expiresAt = new Date(Number(market.expiresAt) * 1000);
    const startsAt = new Date(Number(market.startsAt) * 1000);
    const resolvedAt = market.resolvedAt > 0 ? new Date(Number(market.resolvedAt) * 1000) : null;

    if (resolvedAt) return 'resolved';

    switch (Number(market.status)) {
      case MarketStatus.PENDING:  return now < startsAt ? 'pending' : 'active';
      case MarketStatus.ACTIVE:   return now > expiresAt ? 'closed' : 'active';
      case MarketStatus.PAUSED:   return 'paused';
      case MarketStatus.RESOLVED: return 'resolved';
      case MarketStatus.CANCELLED:return 'cancelled';
      case MarketStatus.CLOSED:   return 'closed';
      default:
        if (now < startsAt) return 'pending';
        if (now > expiresAt) return 'closed';
        return 'active';
    }
  }

  private formatVolumeUnits6(value: bigint): string {
    const num = Number(ethers.formatUnits(value, 6));
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1);
    if (num >= 1_000_000)     return (num / 1_000_000).toFixed(1);
    if (num >= 1_000)         return (num / 1_000).toFixed(1);
    return num.toFixed(0);
  }

  async getExtendedMarket(marketId: number): Promise<MarketData | null> {
    try {
      const [ext, meta] = await Promise.all([
        this.contract.getExtendedMarket(marketId) as Promise<ExtendedMarketStruct>,
        this.getMarketMetadata(marketId)
      ]);

      const m = ext.market;
      const outcomePrices = ext.outcomePrices.map((p) => ethers.formatUnits(p, 6));
      const status = this.determineMarketStatus(m);

      const expiresAt = new Date(Number(m.expiresAt) * 1000);
      const now = new Date();
      const timeToClose = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

      const totalCollateral = ext.collateralAmounts.reduce((a, b) => a + b, );
      const volumeUnits = ethers.formatUnits(totalCollateral, 6);

      const data: MarketData = {
        id: Number(m.id),
        title: meta?.title || `Market #${marketId}`,
        status,
        expiresAt,
        startsAt: new Date(Number(m.startsAt) * 1000),
        createdAt: new Date(Number(m.createdAt) * 1000),
        resolvedAt: m.resolvedAt > 0 ? new Date(Number(m.resolvedAt) * 1000) : undefined,
        winningOutcome: m.winningOutcome > 0 ? Number(m.winningOutcome) : undefined,
        outcomeCount: Number(m.outcomeCount),
        collateralToken: m.collateralToken,
        collateralAmount: ethers.formatUnits(m.collateralAmount, 6),
        creatorFeeBps: Number(m.creatorFeeBps),
        alpha: Number(m.alpha),
        resolver: m.resolver,
        volume: volumeUnits,           
        totalVolume: volumeUnits,
        outcomePrices,
        outcomes: meta?.outcomes,
        description: meta?.description,
        timeToClose,
        currentPrices: outcomePrices.map((p) => (parseFloat(p) * 100).toFixed(2)),
        metadata: {
          title: meta?.title || `Market #${marketId}`,
          description: meta?.description,
          outcomes: meta?.outcomes
        }
      };

      console.log(`🧾 Fetched Market #${data.id} — ${data.title} [${data.status.toUpperCase()}]`);

      return data;
    } catch (err) {
      return null;
    }
  }

  private fuzzyMatch(searchTerm: string, text: string): number {
    const s = searchTerm.toLowerCase().trim();
    const t = (text || '').toLowerCase();
    if (!s || !t) return 0;
    if (t.includes(s)) return 100;

    const sa = s.split(/\s+/);
    const ta = t.split(/\s+/);
    let hits = 0;
    for (const w of sa) {
      if (w.length < 2) continue;
      if (ta.some(x => x.includes(w) || w.includes(x))) hits++;
    }
    return Math.min(80, (hits / Math.max(1, sa.length)) * 80);
  }

  public async searchMarkets(searchTerm: string): Promise<MarketData[]> {
    const all = await this.getAllMarkets();
    const ranked = all.map(m => {
      let score = this.fuzzyMatch(searchTerm, m.title) * 1.0;
      if (m.description) score = Math.max(score, this.fuzzyMatch(searchTerm, m.description) * 0.8);
      if (m.outcomes) for (const o of m.outcomes) score = Math.max(score, this.fuzzyMatch(searchTerm, o) * 0.9);
      return { m, score };
    }).filter(r => r.score > 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(r => r.m);

    console.log(`🔎 Search "${searchTerm}" → ${ranked.length} markets`);
    return ranked;
  }

  public async getMarketById(marketId: string): Promise<MarketData | null> {
    const id = parseInt(marketId);
    return await this.getExtendedMarket(id);
    }

  public async getAllMarkets(): Promise<MarketData[]> {
    if (!this.isConnected) await this.init();

    let total = this.totalMarkets || GLOBAL_MARKET_CACHE.total;
    if (total === 0) {
      total = await this.scanForMarkets();
      this.totalMarkets = total;
      GLOBAL_MARKET_CACHE.total = total;
      GLOBAL_MARKET_CACHE.lastScanAt = Date.now();
    }
    if (total <= 0) return [];

    const ids = Array.from({ length: total }, (_, i) => i + 1);
    const markets = await this.getMultipleMarkets(ids);
    console.log(`📚 Loaded ${markets.length}/${total} markets`);
    return markets;
  }

  public async getActiveMarkets(): Promise<MarketData[]> {
    return (await this.getAllMarkets()).filter(m => m.status === 'active');
  }

  public async getClosingSoonMarkets(hoursAhead = 24): Promise<MarketData[]> {
    const cutoff = new Date(Date.now() + hoursAhead * 3600 * 1000);
    return (await this.getActiveMarkets())
      .filter(m => m.expiresAt <= cutoff)
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
      .slice(0, 15);
  }

  public async getHighVolumeMarkets(limit = 10): Promise<MarketData[]> {
    return (await this.getAllMarkets())
      .sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume))
      .slice(0, limit);
  }

  public async getNewlyCreatedMarkets(daysBack = 7): Promise<MarketData[]> {
    const cutoff = new Date(Date.now() - daysBack * 24 * 3600 * 1000);
    return (await this.getAllMarkets())
      .filter(m => m.createdAt >= cutoff)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 15);
  }

  public async getResolvedMarkets(limit = 10): Promise<MarketData[]> {
    return (await this.getAllMarkets())
      .filter(m => m.status === 'resolved')
      .sort((a, b) => (b.resolvedAt?.getTime() || 0) - (a.resolvedAt?.getTime() || 0))
      .slice(0, limit);
  }

  public async getMarketsByStatus(status: string): Promise<MarketData[]> {
    const s = status.toLowerCase();
    return (await this.getAllMarkets()).filter(m => m.status.toLowerCase() === s).slice(0, 20);
  }

  public getConnectionStatus() {
    return { connected: this.isConnected, knownMarkets: this.totalMarkets };
  }

  public async getMultipleMarkets(marketIds: number[]): Promise<MarketData[]> {
    const batchSize = 10;
    const results: MarketData[] = [];

    for (let i = 0; i < marketIds.length; i += batchSize) {
      const batch = marketIds.slice(i, i + batchSize);
      const settled = await Promise.allSettled(batch.map(id => this.getExtendedMarket(id)));
      for (const r of settled) if (r.status === 'fulfilled' && r.value) results.push(r.value);
      if (i + batchSize < marketIds.length) await new Promise(res => setTimeout(res, 100));
    }
    return results;
  }
}

class FormatUtils {
  static formatCurrency(amount: string | number, decimals = 2): string {
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
    const diff = expiryDate.getTime() - now.getTime();
    if (diff <= 0) {
      const past = Math.abs(diff);
      const d = Math.floor(past / (1000 * 60 * 60 * 24));
      const h = Math.floor((past % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      return d > 0 ? `${d}d ${h}h ago` : `${Math.floor(past / (1000 * 60 * 60))}h ago`;
    }
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return d > 0 ? `in ${d}d ${h}h` : h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
  }
}

export class EmbedUtils {
  static createMarketDataEmbed(m: MarketData): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0x7C3AED)
      .setTitle(`Market #${m.id} – ${m.title}`)
      .setTimestamp();

    const statusEmoji =
      { active: '🟢', closed: '🔴', resolved: '✅', paused: '⏸️', cancelled: '❌', pending: '🕒' }[m.status] || '❓';

    embed.setDescription(`${statusEmoji} **Status:** ${m.status.toUpperCase()}`);

    embed.addFields(
      {
        name: '📊 Market Info',
        value: `**Expires:** ${FormatUtils.formatTimeUntilExpiry(m.expiresAt)}\n**Volume:** ${FormatUtils.formatCurrency(m.volume)} USDC`,
        inline: true
      },
      {
        name: '⚙️ Parameters',
        value: `**Creator Fee:** ${(m.creatorFeeBps / 100).toFixed(2)}%\n**Alpha:** ${m.alpha}\n**Outcomes:** ${m.outcomeCount}`,
        inline: true
      }
    );

    if (m.outcomePrices.length > 0) {
      const priceText = m.outcomePrices
        .map((p, i) => `**${m.outcomes?.[i] || `Outcome ${i + 1}`}**: ${FormatUtils.formatPrice(p)}`)
        .join('\n');
      embed.addFields({ name: '💰 Current Prices', value: priceText, inline: false });
    }

    embed.setFooter({ text: '📊 Live data from XO Market Contract • Fresh: <1min ago' });
    return embed;
  }

  static createErrorEmbed(error: string, suggestions?: string[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0xEF4444)
      .setTitle('❌ Error')
      .setDescription(error)
      .setTimestamp();
    if (suggestions?.length) {
      embed.addFields({ name: '💡 Suggestions', value: suggestions.map(s => `• ${s}`).join('\n'), inline: false });
    }
    embed.setFooter({ text: '🔍 Check your input and try again' });
    return embed;
  }
}

export const xoMarketService = new BlockchainTools();
