import 'dotenv/config';
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone } from '@pinecone-database/pinecone';
import { generateGeminiResponse } from '@/lib/gemini';
import { BlockchainTools } from '@/lib/blockchain';

// Increase timeout to 3 minutes
export const maxDuration = 180; // 3 minutes in seconds

let BT_SINGLETON: BlockchainTools | null = null;
async function getBT(): Promise<BlockchainTools> {
  if (!BT_SINGLETON) {
    BT_SINGLETON = new BlockchainTools();
    await BT_SINGLETON.init();
  }
  return BT_SINGLETON;
}

interface ChatResponse {
  answer: string;
  sources: string[];
  citations: { [key: number]: string };
  liveData?: any;
  responseTime: number;
  dataFreshness?: string;
  queryType?: string;
  error?: string;
}

interface QueryAnalysis {
  needsLiveData: boolean;
  queryType: 'single-market' | 'browse' | 'general' | 'search' | 'tag';
  marketId?: string;
  searchTerm?: string;
  tag?: string;
  browseType?: 'active' | 'closed' | 'resolved' | 'closing-soon' | 'high-volume' | 'newly-created';
  timeframe?: number;
}

const CATEGORY_KEYWORDS = {
  sports: ['ufc', 'nfl', 'nba', 'soccer', 'football', 'basketball', 'cricket', 'tennis', 'f1', 'conor', 'mcgregor', 'khabib', 'boxing', 'mma', 'fight', 'match', 'vs'],
  crypto: ['bitcoin', 'btc', 'ethereum', 'eth', 'token', 'web3', 'defi', 'airdrop', 'coin', 'crypto', 'nfts', 'nft', 'blockchain'],
  politics: ['election', 'vote', 'trump', 'biden', 'modi', 'parliament', 'president', 'senate', 'policy', 'polls', 'government'],
  finance: ['stock', 'stocks', 'tesla', 'apple', 'google', 'inflation', 'rate', 'fed', 'market', 'earnings', 'price', 'investment'],
  tech: ['ai', 'openai', 'google', 'apple', 'microsoft', 'chip', 'semiconductor', 'software', 'hardware', 'technology'],
  culture: ['music', 'movie', 'film', 'tv', 'celebrity', 'award', 'oscars', 'grammys', 'culture', 'entertainment'],
  social: ['trend', 'viral', 'tiktok', 'instagram', 'social', 'meme', 'twitter'],
  web3: ['web3', 'nft', 'crypto', 'ethereum', 'polygon', 'solana', 'defi'],
  other: []
};

function analyzeQuery(query: string): QueryAnalysis {
  const q = query.toLowerCase();

  // Check for market ID
  const idMatch = q.match(/\b(?:market|id)\s*(\d+)\b/);
  if (idMatch) return { needsLiveData: true, queryType: 'single-market', marketId: idMatch[1] };

  // Check for category queries
  const categoryMatch = Object.entries(CATEGORY_KEYWORDS).find(([_, keywords]) => 
    keywords.some(keyword => q.includes(keyword))
  );
  if (categoryMatch) {
    return { needsLiveData: true, queryType: 'tag', tag: categoryMatch[0] };
  }

  // Enhanced search term detection
  const searchIndicators = [
    'about', 'find', 'search', 'will', 'defeat', 'beat', 'vs', 'match', 
    'who will', 'when will', 'what will', 'can', 'might', 'could',
    'london', 'rainfall', 'weather', 'temperature', 'conor', 'khabib'
  ];
  
  const hasSearchIndicator = searchIndicators.some(indicator => q.includes(indicator));
  
  if (hasSearchIndicator) {
    // Extract meaningful search terms
    let cleaned = q
      .replace(/\b(tell me about|about|find|search|market for|market|will|defeat|beat|who|what|when|can|might|could)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (cleaned.length > 2) {
      return { needsLiveData: true, queryType: 'search', searchTerm: cleaned };
    }
  }

  // Check for status-based browsing
  if (q.includes('resolved') || q.includes('completed') || q.includes('finished')) {
    return { needsLiveData: true, queryType: 'browse', browseType: 'resolved' };
  }
  if (q.includes('closed') || q.includes('expired') || q.includes('ended')) {
    return { needsLiveData: true, queryType: 'browse', browseType: 'closed' };
  }
  if (q.includes('active') || q.includes('live') || q.includes('ongoing')) {
    return { needsLiveData: true, queryType: 'browse', browseType: 'active' };
  }

  // Check for special browsing
  if (q.includes('closing soon') || q.includes('ending soon')) {
    return { needsLiveData: true, queryType: 'browse', browseType: 'closing-soon', timeframe: 24 };
  }
  if (q.includes('high volume') || q.includes('top volume') || q.includes('popular')) {
    return { needsLiveData: true, queryType: 'browse', browseType: 'high-volume' };
  }
  if (q.includes('new') || q.includes('recent') || q.includes('latest')) {
    return { needsLiveData: true, queryType: 'browse', browseType: 'newly-created', timeframe: 7 };
  }

  // Default logic
  const needsLiveData = /\b(current|live|real-time|now|today|markets|status|price|fetch|all)\b/.test(q);
  return { 
    needsLiveData, 
    queryType: needsLiveData ? 'browse' : 'general', 
    browseType: needsLiveData ? 'active' : undefined 
  };
}

function formatVolume(numStr: string): string {
  const n = Number(numStr);
  if (!isFinite(n)) return '$0';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatTime(s: number) {
  if (s <= 0) return 'Expired';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function createMarketCards(markets: any[], queryType: string): string {
  if (!markets?.length) return 'No markets found matching your criteria.';

  const statusEmoji: Record<string, string> = {
    active: '🟢', closed: '🔴', resolved: '✅'
  };

  let cards = `📊 **${markets.length} ${queryType.toUpperCase()} MARKETS**\n\n`;
  
  // Show up to 8 markets in card format
  markets.slice(0, 8).forEach((m: any, i: number) => {
    const title = (m.metadata?.title || m.title || `Market ${m.id}`);
    const emoji = statusEmoji[m.status] || '❓';
    
    cards += `┌─────────────────────────────────────────────────┐\n`;
    cards += `│ **${i + 1}. ${title.slice(0, 42)}** ${title.length > 42 ? '...' : ''}\n`;
    cards += `│ ${emoji} **Status:** ${m.status.toUpperCase()} • **ID:** ${m.id}\n`;
    cards += `├─────────────────────────────────────────────────┤\n`;
    cards += `│ 💰 **Volume:** ${formatVolume(m.totalVolume || m.volume || '0')}\n`;
    cards += `│ 💵 **Creator Fee:** ${(m.creatorFeeBps / 100).toFixed(2)}%\n`;
    cards += `│ ⏰ **Time:** ${formatTime(m.timeToClose || 0)}\n`;
    cards += `│ 🎯 **Outcomes:** ${m.outcomeCount}\n`;
    
    // Add current odds if available
    if (Array.isArray(m.currentPrices) && m.currentPrices.length) {
      cards += `│ 📊 **Current Odds:**\n`;
      m.currentPrices.slice(0, 3).forEach((p: string, idx: number) => {
        const name = m.metadata?.outcomes?.[idx] || m.outcomes?.[idx] || `Option ${idx + 1}`;
        cards += `│   • ${name.slice(0, 20)}: **${p}%**\n`;
      });
    }
    
    // Add description if available
    if (m.metadata?.description?.trim()) {
      const desc = String(m.metadata.description).slice(0, 80);
      cards += `│ 📝 ${desc}${desc.length === 80 ? '...' : ''}\n`;
    }
    
    cards += `└─────────────────────────────────────────────────┘\n\n`;
  });
  
  if (markets.length > 8) {
    cards += `*Showing top 8 of ${markets.length} markets found.*\n\n`;
  }
  
  return cards;
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  
  try {
    const { query } = await req.json();
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Valid query string is required' }, { status: 400 });
    }

    console.log(`🔍 Processing query: "${query}"`);
    const analysis = analyzeQuery(query);
    console.log(`📝 Query analysis:`, analysis);

    // Environment validation
    for (const envVar of ['PINECONE_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'XO_MARKET_RPC_URL']) {
      if (!process.env[envVar]) {
        throw new Error(`${envVar} environment variable is not set`);
      }
    }

    // Document retrieval
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const index = pinecone.Index(process.env.PINECONE_INDEX || 'xo-market-docs');
    const embeddings = new GoogleGenerativeAIEmbeddings({ 
      apiKey: process.env.GOOGLE_GEMINI_API_KEY!, 
      model: 'text-embedding-004' 
    });
    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, { 
      pineconeIndex: index, 
      textKey: 'content' 
    });
    
    const retrieval = await vectorStore.similaritySearchWithScore(query, 5);
    const documents = retrieval.map(([doc, score], i) => ({ 
      content: doc.pageContent, 
      source: doc.metadata?.source || 'unknown', 
      score, 
      index: i + 1 
    }));

    // Live data fetching
    let liveData: any = null;
    let dataFreshness = '';
    let liveDataError = '';

    if (analysis.needsLiveData) {
      try {
        console.log('🔍 Fetching live blockchain data...');
        const bt = await getBT();

        switch (analysis.queryType) {
          case 'single-market':
            if (analysis.marketId) {
              liveData = await bt.getMarketById(analysis.marketId);
              dataFreshness = `Live Market Data • ${new Date().toISOString()}`;
            }
            break;

          case 'search':
            if (analysis.searchTerm) {
              console.log(`🔎 Searching for: "${analysis.searchTerm}"`);
              liveData = await bt.searchMarkets(analysis.searchTerm);
              dataFreshness = `Search Results (${Array.isArray(liveData) ? liveData.length : 0} found) • ${new Date().toISOString()}`;
            }
            break;

          case 'tag':
            if (analysis.tag) {
              const all = await bt.getAllMarkets();
              const keywords = CATEGORY_KEYWORDS[analysis.tag as keyof typeof CATEGORY_KEYWORDS] || [];
              liveData = all.filter(m => {
                const text = `${m.title} ${m.description || ''} ${(m.outcomes || []).join(' ')}`.toLowerCase();
                return keywords.some(keyword => text.includes(keyword));
              }).slice(0, 20);
              dataFreshness = `Category: ${analysis.tag} (${liveData.length} markets) • ${new Date().toISOString()}`;
            }
            break;

          case 'browse':
            switch (analysis.browseType) {
              case 'active':
                liveData = await bt.getActiveMarkets();
                break;
              case 'closed':
                liveData = await bt.getClosedMarkets();
                break;
              case 'resolved':
                liveData = await bt.getResolvedMarkets();
                break;
              case 'closing-soon':
                liveData = await bt.getClosingSoonMarkets(analysis.timeframe || 24);
                break;
              case 'high-volume':
                liveData = await bt.getHighVolumeMarkets(10);
                break;
              case 'newly-created':
                liveData = await bt.getNewlyCreatedMarkets(analysis.timeframe || 7);
                break;
              default:
                liveData = await bt.getActiveMarkets();
            }
            dataFreshness = `Live Browse Data (${Array.isArray(liveData) ? liveData.length : liveData ? 1 : 0} markets) • ${new Date().toISOString()}`;
            break;

          default:
            liveData = await bt.getActiveMarkets();
            dataFreshness = `Live Market Data (${Array.isArray(liveData) ? liveData.length : 0} markets) • ${new Date().toISOString()}`;
        }

        console.log('✅ Live blockchain data fetched successfully');
      } catch (error: any) {
        console.error('❌ Live data fetch failed:', error);
        liveDataError = error?.message || 'Unknown blockchain error';
        liveData = null;
        dataFreshness = 'Live data unavailable - using documentation only';
      }
    }

    // Prepare context for AI
    const docContext = documents.map(d => `[${d.index}] Source: ${d.source}\n${d.content}`).join('\n\n');
    const liveContext = liveData
      ? `\n\n[Live Blockchain Data at ${new Date().toISOString()}]\n${createMarketCards(Array.isArray(liveData) ? liveData : [liveData], analysis.browseType || analysis.queryType)}`
      : liveDataError ? `\n\n[Live Data Error: ${liveDataError}]` : '';

    // Enhanced system prompt
    const systemPrompt = `You are XO Market Expert, an AI assistant for the XO Market prediction platform. Respond naturally and conversationally.

Guidelines:
- Be conversational and helpful, like ChatGPT
- Start with a direct summary of what you found
- Only mention these 3 statuses: ACTIVE (trading open), CLOSED (expired), RESOLVED (outcome determined)
- Format numbers naturally: $2.5M, $134K, 3 days 2 hours
- When showing markets, the live data already contains formatted cards - describe them conversationally
- For searches, explain why the markets match the query
- If someone asks about past events (like "London rainfall tomorrow August 30, 2025"), note that the market is now closed since that date has passed

Current Status: ${liveDataError ? `Live blockchain data is unavailable (${liveDataError}), using knowledge base.` : 'I have live blockchain data from XO Market.'}
Current Date: September 17, 2025
`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Context:\n${docContext}${liveContext}\n\nQuestion: ${query}` },
    ];

    // Generate AI response
    let answer: string;
    try {
      answer = await generateGeminiResponse(messages, { 
        temperature: 0.2, 
        maxTokens: 1500 
      });
    } catch (error: any) {
      console.error('❌ Gemini API failed:', error);
      
      // Fallback response with live data
      if (liveData) {
        if (analysis.queryType === 'single-market') {
          const m = liveData;
          answer = `I found Market #${m.id}: "${m.title}"

This market is currently **${m.status.toUpperCase()}** with a trading volume of ${formatVolume(m.volume)}. It has ${m.outcomeCount} possible outcomes and a creator fee of ${(m.creatorFeeBps / 100).toFixed(2)}%.

${m.status === 'active' ? `The market expires ${formatTime(m.timeToClose || 0)}.` : 'The market has expired.'}

(Live blockchain data retrieved successfully, but AI response generation is temporarily limited)`;
        } else {
          const count = Array.isArray(liveData) ? liveData.length : 0;
          answer = `I found ${count} markets matching your query:

${createMarketCards(Array.isArray(liveData) ? liveData : [liveData], analysis.browseType || 'browse')}

(Live blockchain data retrieved successfully, but AI response generation is temporarily limited)`;
        }
      } else {
        answer = `I'm having trouble accessing both live market data and generating responses right now. This is likely due to high demand or service maintenance. Please try again in a moment.`;
      }
    }

    // Prepare response
    const citations: { [k: number]: string } = {};
    const sources: string[] = [];
    for (const doc of documents) {
      citations[doc.index] = doc.source;
      if (!sources.includes(doc.source)) {
        sources.push(doc.source);
      }
    }

    const response: ChatResponse = {
      answer,
      sources,
      citations,
      liveData,
      responseTime: Date.now() - start,
      dataFreshness,
      queryType: analysis.queryType,
      ...(liveDataError && { error: liveDataError })
    };

    console.log(`✅ Response generated in ${response.responseTime}ms`);
    return NextResponse.json(response);

  } catch (error: any) {
    console.error('❌ API Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error?.message || 'Unknown error',
        responseTime: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function GET(_: NextRequest) {
  try {
    let blockchainStatus = 'unknown';
    let knownMarkets = 0;
    
    try {
      const bt = await getBT();
      const status = bt.getConnectionStatus();
      blockchainStatus = status.connected ? 'connected' : 'disconnected';
      knownMarkets = status.knownMarkets;
    } catch (error) {
      console.error('Health check error:', error);
      blockchainStatus = 'failed';
    }

    return NextResponse.json({
      status: 'healthy',
      service: 'XO Market Expert Chat API',
      timestamp: new Date().toISOString(),
      timeout: '3 minutes',
      environment: {
        pineconeConfigured: !!process.env.PINECONE_API_KEY,
        geminiConfigured: !!process.env.GOOGLE_GEMINI_API_KEY,
        blockchainConfigured: !!process.env.XO_MARKET_RPC_URL,
        blockchainStatus,
        indexName: process.env.PINECONE_INDEX || 'xo-market-docs',
        knownMarkets
      },
      supportedStatuses: ['active', 'closed', 'resolved'],
      features: [
        'enhanced fuzzy search', 
        'natural language responses', 
        'category filtering', 
        'real-time blockchain data',
        'card-style market display',
        'accurate time-based status classification'
      ]
    });
  } catch (error: any) {
    return NextResponse.json(
      { 
        status: 'unhealthy', 
        error: error?.message || 'Unknown error', 
        timestamp: new Date().toISOString() 
      },
      { status: 500 }
    );
  }
}
