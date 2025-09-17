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
  status: 'active' | 'closed' | 'resolved'; // Simplified to 3 states only
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
  outcomePrices: string[];
  outcomes?: string[];
  description?: string;
  totalVolume?: string;
  timeToClose?: number;
  currentPrices?: string[];
  metadata?: {
    title?: string;
    description?: string;
    outcomes?: string[];
    tags?: string[];
  };
}

export interface MarketMetadata {
  title: string;
  description?: string;
  outcomes?: string[];
  tags?: string[];
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

// ===== Cache =====
let GLOBAL_MARKET_CACHE: { total: number; lastScanAt: number } = { total: 0, lastScanAt: 0 };
const SCAN_TTL_MS = Number(process.env.XO_MARKET_SCAN_TTL_MS || 5 * 60 * 1000);
const HARD_MAX_ID = Number(process.env.XO_MARKET_MAX_ID || 5000);

// ===== Helper Functions =====
function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(safeString).join(' ');
  return '';
}

function determineCorrectStatus(market: MarketStruct): MarketData['status'] {
  const nowSeconds = Math.floor(Date.now() / 1000); // Current time in seconds
  const expiresAtSeconds = Number(market.expiresAt);
  const startsAtSeconds = Number(market.startsAt);
  const resolvedAtSeconds = Number(market.resolvedAt);
  const onChainStatus = Number(market.status);
  
  console.log(`Market ${market.id}: now=${nowSeconds}, expires=${expiresAtSeconds}, starts=${startsAtSeconds}, resolved=${resolvedAtSeconds}, status=${onChainStatus}`);
  
  // If explicitly resolved on-chain or has resolved timestamp
  if (resolvedAtSeconds > 0 || onChainStatus === MarketStatus.RESOLVED) {
    return 'resolved';
  }
  
  // If explicitly closed on-chain
  if (onChainStatus === MarketStatus.CLOSED) {
    return 'closed';
  }
  
  // Time-based logic - check if market has expired
  if (nowSeconds > expiresAtSeconds) {
    return 'closed';
  }
  
  // Market hasn't started yet - treat as active (will be open soon)
  if (nowSeconds < startsAtSeconds) {
    return 'active';
  }
  
  // Market is in trading window
  if (nowSeconds >= startsAtSeconds && nowSeconds <= expiresAtSeconds) {
    return 'active';
  }
  
  // Default fallback
  return 'closed';
}

function enhancedFuzzyScore(searchTerm: string, targetText: unknown): number {
  const query = searchTerm.toLowerCase().trim();
  const text = safeString(targetText).toLowerCase().trim();
  
  if (!query || !text) return 0;
  
  // Direct substring match - highest score
  if (text.includes(query)) return 100;
  
  // Split into words for more granular matching
  const queryWords = query.split(/\s+/).filter(w => w.length > 1);
  const textWords = text.split(/[\s,.-]+/).filter(w => w.length > 1);
  
  if (queryWords.length === 0 || textWords.length === 0) return 0;
  
  let totalMatches = 0;
  let maxWordScore = 0;
  
  for (const queryWord of queryWords) {
    let bestWordMatch = 0;
    
    for (const textWord of textWords) {
      let wordScore = 0;
      
      // Exact word match
      if (textWord === queryWord) {
        wordScore = 100;
      }
      // One word contains the other
      else if (textWord.includes(queryWord) || queryWord.includes(textWord)) {
        wordScore = 80;
      }
      // Similar length words - check edit distance
      else if (Math.abs(queryWord.length - textWord.length) <= 2 && queryWord.length > 3) {
        const similarity = calculateSimilarity(queryWord, textWord);
        if (similarity > 0.7) {
          wordScore = Math.floor(similarity * 70);
        }
      }
      
      bestWordMatch = Math.max(bestWordMatch, wordScore);
    }
    
    totalMatches += bestWordMatch;
    maxWordScore = Math.max(maxWordScore, bestWordMatch);
  }
  
  // Final score combines average match quality with best single match
  const avgScore = totalMatches / queryWords.length;
  return Math.min(100, Math.floor((avgScore * 0.7) + (maxWordScore * 0.3)));
}

function calculateSimilarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix = Array(b.length + 1).fill(0).map(() => Array(a.length + 1).fill(0));
  
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  
  return matrix[b.length][a.length];
}

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
    } catch (error) {
      console.warn('Failed to fetch market count:', error);
      const fresh = Date.now() - GLOBAL_MARKET_CACHE.lastScanAt < SCAN_TTL_MS;
      if (fresh && GLOBAL_MARKET_CACHE.total > 0) {
        this.totalMarkets = GLOBAL_MARKET_CACHE.total;
        console.log(`📊 Total markets (cache): ${this.totalMarkets}`);
      } else {
        console.warn('Using fallback market scanning...');
        this.totalMarkets = await this.scanForMarkets();
        GLOBAL_MARKET_CACHE.total = this.totalMarkets;
        GLOBAL_MARKET_CACHE.lastScanAt = Date.now();
      }
    }
  }

  private async scanForMarkets(): Promise<number> {
    const exists = async (id: number) => {
      try { 
        await this.contract.getMarket(id); 
        return true; 
      } catch { 
        return false; 
      }
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
      if (await exists(id)) maxId = id; 
      else break;
    }

    console.log(`🔍 Scanned and found markets up to ID: ${maxId}`);
    return maxId;
  }

  async getMarketMetadata(marketId: number): Promise<MarketMetadata | null> {
    try {
      const tokenURI: string = await this.nftContract.tokenURI(marketId);

      const parseMetadata = (obj: any): MarketMetadata => {
        let outcomes: string[] = [];
        
        // Parse outcomes from multiple possible formats
        if (Array.isArray(obj.outcomes)) {
          outcomes = obj.outcomes.map(safeString).filter(Boolean);
        } else if (typeof obj.outcomes === 'string') {
          outcomes = obj.outcomes.split(',').map((s: string) => s.trim()).filter(Boolean);
        } else if (obj.attributes && Array.isArray(obj.attributes)) {
          const outcomeAttr = obj.attributes.find((a: any) => 
            a?.trait_type === 'outcomes' || a?.trait_type === 'Outcomes'
          );
          if (outcomeAttr?.value) {
            outcomes = String(outcomeAttr.value).split(',').map(s => s.trim()).filter(Boolean);
          }
        }

        // Parse tags similarly
        let tags: string[] = [];
        if (Array.isArray(obj.tags)) {
          tags = obj.tags.map(safeString).filter(Boolean);
        } else if (typeof obj.tags === 'string') {
          tags = obj.tags.split(',').map((s: string) => s.trim()).filter(Boolean);
        } else if (obj.attributes && Array.isArray(obj.attributes)) {
          const tagAttr = obj.attributes.find((a: any) => 
            a?.trait_type === 'tags' || a?.trait_type === 'Tags'
          );
          if (tagAttr?.value) {
            tags = String(tagAttr.value).split(',').map(s => s.trim()).filter(Boolean);
          }
        }

        return {
          title: safeString(obj.title || obj.name || obj.description) || `Market #${marketId}`,
          description: safeString(obj.description) || undefined,
          outcomes: outcomes.length > 0 ? outcomes : undefined,
          tags: tags.length > 0 ? tags : undefined
        };
      };

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

  async getExtendedMarket(marketId: number): Promise<MarketData | null> {
    try {
      const [ext, meta] = await Promise.all([
        this.contract.getExtendedMarket(marketId) as Promise<ExtendedMarketStruct>,
        this.getMarketMetadata(marketId)
      ]);

      const m = ext.market;
      const outcomePrices = ext.outcomePrices.map((p) => ethers.formatUnits(p, 6));
      const status = determineCorrectStatus(m); // Use corrected status logic

      const expiresAt = new Date(Number(m.expiresAt) * 1000);
      const now = new Date();
      const timeToClose = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

      const totalCollateral = ext.collateralAmounts.reduce((a, b) => a + b, 0n);
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
          outcomes: meta?.outcomes,
          tags: meta?.tags
        }
      };

      console.log(`🧾 Fetched Market #${data.id} — ${data.title} [${data.status.toUpperCase()}]`);
      return data;
    } catch (err) {
      console.error(`Failed to fetch market ${marketId}:`, err);
      return null;
    }
  }

  public async searchMarkets(searchTerm: string): Promise<MarketData[]> {
    console.log(`🔍 Starting search for: "${searchTerm}"`);
    const all = await this.getAllMarkets();
    
    const scored = all.map(m => {
      // Enhanced multi-field scoring
      const titleScore = enhancedFuzzyScore(searchTerm, m.title);
      const descScore = enhancedFuzzyScore(searchTerm, m.description || '');
      
      let outcomeScore = 0;
      if (m.outcomes && m.outcomes.length > 0) {
        outcomeScore = Math.max(...m.outcomes.map(outcome => 
          enhancedFuzzyScore(searchTerm, outcome)
        ));
      }
      
      // Weighted final score
      const finalScore = Math.max(
        titleScore * 1.0,           // Title is most important
        descScore * 0.8,            // Description is secondary  
        outcomeScore * 0.9          // Outcomes are very relevant
      );
      
      return { market: m, score: finalScore };
    })
    .filter(item => item.score > 10) // Lower threshold for broader matches
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

    const results = scored.map(item => item.market);
    console.log(`🔎 Search "${searchTerm}" found ${results.length} markets (scores: ${scored.map(s => s.score.toFixed(1)).join(', ')})`);
    return results;
  }

  public async getMarketById(marketId: string): Promise<MarketData | null> {
    const id = parseInt(marketId);
    if (isNaN(id) || id <= 0) return null;
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

  public async getClosedMarkets(): Promise<MarketData[]> {
    return (await this.getAllMarkets()).filter(m => m.status === 'closed');
  }

  public async getResolvedMarkets(): Promise<MarketData[]> {
    return (await this.getAllMarkets()).filter(m => m.status === 'resolved');
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

  public async getMarketsByStatus(status: string): Promise<MarketData[]> {
    const s = status.toLowerCase() as 'active' | 'closed' | 'resolved';
    if (!['active', 'closed', 'resolved'].includes(s)) {
      return [];
    }
    return (await this.getAllMarkets()).filter(m => m.status === s).slice(0, 20);
  }

  public getConnectionStatus() {
    return { connected: this.isConnected, knownMarkets: this.totalMarkets };
  }

  public async getMultipleMarkets(marketIds: number[]): Promise<MarketData[]> {
    const batchSize = 8; // Smaller batches for reliability
    const results: MarketData[] = [];

    for (let i = 0; i < marketIds.length; i += batchSize) {
      const batch = marketIds.slice(i, i + batchSize);
      const settled = await Promise.allSettled(
        batch.map(id => this.getExtendedMarket(id))
      );
      
      for (const result of settled) {
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        }
      }
      
      // Rate limiting between batches
      if (i + batchSize < marketIds.length) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
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

    const statusEmoji = { active: '🟢', closed: '🔴', resolved: '✅' }[m.status] || '❓';
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
        .slice(0, 3) // Limit to first 3 outcomes
        .map((p, i) => `**${m.outcomes?.[i] || `Outcome ${i + 1}`}**: ${FormatUtils.formatPrice(p)}`)
        .join('\n');
      embed.addFields({ name: '💰 Current Prices', value: priceText, inline: false });
    }

    embed.setFooter({ text: '📊 Live data from XO Market Contract' });
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
