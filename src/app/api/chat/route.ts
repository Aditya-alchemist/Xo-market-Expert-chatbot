import 'dotenv/config';
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone } from '@pinecone-database/pinecone';
import { generateGeminiResponse } from '@/lib/gemini';
import { BlockchainTools } from '@/lib/blockchain';

// Simple lazy singleton to avoid rescanning every request
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
  queryType: 'single-market' | 'browse' | 'general' | 'search';
  marketId?: string;
  searchTerm?: string;
  browseType?: 'active' | 'closing-soon' | 'high-volume' | 'newly-created' | 'resolved' | 'paused' | 'closed' | 'pending';
  timeframe?: number;
}

function analyzeQuery(query: string): QueryAnalysis {
  const q = query.toLowerCase();

  const idMatch = q.match(/\b(?:market|id)\s*(\d+)\b/);
  if (idMatch) return { needsLiveData: true, queryType: 'single-market', marketId: idMatch[1] };

  const searchHints = ['ufc','bitcoin','election','trump','biden','nfl','nba','football','basketball','crypto','ethereum','stock','tesla','apple','google','weather','temperature','rain','snow','sports','politics'];
  const hint = searchHints.find(t => q.includes(t));
  if (hint || q.includes('about ') || q.includes('find ') || q.includes('search')) {
    const term = hint || q.replace(/\b(tell me about|about|find|search|market)\b/g, '').trim();
    if (term && term.length > 2) return { needsLiveData: true, queryType: 'search', searchTerm: term };
  }

  if (q.includes('closing soon') || q.includes('ending soon')) return { needsLiveData: true, queryType: 'browse', browseType: 'closing-soon', timeframe: 24 };
  if (q.includes('high volume') || q.includes('top volume') || q.includes('popular')) return { needsLiveData: true, queryType: 'browse', browseType: 'high-volume' };
  if (q.includes('new') || q.includes('recent') || q.includes('latest')) return { needsLiveData: true, queryType: 'browse', browseType: 'newly-created', timeframe: 7 };
  if (q.includes('resolved') || q.includes('completed') || q.includes('finished')) return { needsLiveData: true, queryType: 'browse', browseType: 'resolved' };
  if (q.includes('paused')) return { needsLiveData: true, queryType: 'browse', browseType: 'paused' };
  if (q.includes('closed')) return { needsLiveData: true, queryType: 'browse', browseType: 'closed' };
  if (q.includes('pending')) return { needsLiveData: true, queryType: 'browse', browseType: 'pending' };

  const needsLiveData = /\b(current|live|active|real-time|now|today|markets|status|price|fetch|all)\b/.test(q);
  return { needsLiveData, queryType: needsLiveData ? 'browse' : 'general', browseType: needsLiveData ? 'active' : undefined };
}

function formatVolume(numStr: string): string {
  const n = Number(numStr);
  if (!isFinite(n)) return '$0';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatMarketDataCards(markets: any[], queryType: string): string {
  if (!markets?.length) return 'No markets found matching your criteria.';

  const formatTime = (s: number) => {
    if (s <= 0) return 'Expired';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const statusEmoji: Record<string, string> = {
    active: '🟢', pending: '🟡', closed: '🔴', resolved: '✅', paused: '⏸️', cancelled: '❌'
  };

  let out = `🎯 **${markets.length} ${queryType.toUpperCase()} MARKETS**\n\n`;
  markets.forEach((m: any, i: number) => {
    const title = (m.metadata?.title || m.title || `Market ${m.id}`).slice(0, 80);
    const emoji = statusEmoji[m.status] || '❓';
    out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    out += `**${i + 1}. ${title}**\n`;
    out += `${emoji} **Status:** ${m.status.toUpperCase()} • **ID:** ${m.id}\n\n`;
    out += `💰 **Volume:** ${formatVolume(m.totalVolume || m.volume || '0')}\n`;
    out += `💵 **Creator Fee:** ${(m.creatorFeeBps / 100).toFixed(2)}%\n`;
    out += `⏰ **Time:** ${formatTime(m.timeToClose || 0)}\n`;
    out += `🎯 **Outcomes:** ${m.outcomeCount}\n\n`;
    if (Array.isArray(m.currentPrices) && m.currentPrices.length) {
      out += `📊 **Current Odds:**\n`;
      m.currentPrices.forEach((p: string, idx: number) => {
        const name = m.metadata?.outcomes?.[idx] || m.outcomes?.[idx] || `Option ${idx + 1}`;
        out += `   • ${name}: **${p}%**\n`;
      });
      out += '\n';
    }
    if (m.metadata?.description?.trim()) {
      const desc = String(m.metadata.description).slice(0, 120);
      out += `📝 ${desc}${desc.length === 120 ? '...' : ''}\n\n`;
    }
    out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  });
  return out;
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  try {
    const { query } = await req.json();
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Valid query string is required' }, { status: 400 });
    }

    const analysis = analyzeQuery(query);

    // Env validation
    for (const v of ['PINECONE_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'XO_MARKET_RPC_URL']) {
      if (!process.env[v]) throw new Error(`${v} environment variable is not set`);
    }

    // Docs retrieval
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const index = pinecone.Index(process.env.PINECONE_INDEX || 'xo-market-docs');
    const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey: process.env.GOOGLE_GEMINI_API_KEY!, model: 'text-embedding-004' });
    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, { pineconeIndex: index, textKey: 'content' });
    const retrieval = await vectorStore.similaritySearchWithScore(query, 5);
    const documents = retrieval.map(([doc, score], i) => ({ content: doc.pageContent, source: doc.metadata?.source || 'unknown', score, index: i + 1 }));

    // Live data
    let liveData: any = null;
    let dataFreshness = '';
    let liveDataError = '';

    if (analysis.needsLiveData) {
      try {
        console.log('🔍 Fetching live blockchain data...');
        const bt = await getBT();

        if (analysis.queryType === 'single-market' && analysis.marketId) {
          liveData = await bt.getMarketById(analysis.marketId);
          dataFreshness = `Live Data • ${new Date().toISOString()}`;
        } else if (analysis.queryType === 'search' && analysis.searchTerm) {
          liveData = await bt.searchMarkets(analysis.searchTerm);
          dataFreshness = `Search Results (${Array.isArray(liveData) ? liveData.length : 0} markets) • ${new Date().toISOString()}`;
        } else if (analysis.queryType === 'browse') {
          switch (analysis.browseType) {
            case 'closing-soon':  liveData = await bt.getClosingSoonMarkets(analysis.timeframe || 24); break;
            case 'high-volume':   liveData = await bt.getHighVolumeMarkets(10); break;
            case 'newly-created': liveData = await bt.getNewlyCreatedMarkets(analysis.timeframe || 7); break;
            case 'resolved':      liveData = await bt.getResolvedMarkets(10); break;
            case 'paused':        liveData = await bt.getMarketsByStatus('paused'); break;
            case 'closed':        liveData = await bt.getMarketsByStatus('closed'); break;
            case 'pending':       liveData = await bt.getMarketsByStatus('pending'); break;
            default:              liveData = await bt.getActiveMarkets();
          }
          dataFreshness = `Live Data (${Array.isArray(liveData) ? liveData.length : liveData ? 1 : 0} markets) • ${new Date().toISOString()}`;
        } else {
          liveData = await bt.getAllMarkets();
          dataFreshness = `Live Data (${Array.isArray(liveData) ? liveData.length : 0} markets) • ${new Date().toISOString()}`;
        }

        console.log('✅ Live blockchain data fetched successfully');
      } catch (e: any) {
        console.error('❌ Live data fetch failed:', e);
        liveDataError = e?.message || 'Unknown error';
        liveData = null;
        dataFreshness = 'Live data unavailable - using documentation only';
      }
    }

    const context = documents.map(d => `[${d.index}] Source: ${d.source}\n${d.content}`).join('\n\n');
    const liveContext = liveData
      ? `\n\n[Live Data at ${new Date().toISOString()}]\n${formatMarketDataCards(Array.isArray(liveData) ? liveData : [liveData], analysis.browseType || analysis.queryType)}`
      : liveDataError ? `\n\n[Live Data Error: ${liveDataError}]` : '';

    const systemPrompt = `You are XO Market Expert, a helpful assistant for the XO Market prediction platform.

Guidelines:
- Be clear and concise; use short paragraphs and bullets
- Summarize first, details second
- Format numbers like $13.3M, $2.4K, 2h 10m
- If multiple markets are shown, use tidy bullets and keep to essentials

Status Guide:
- ACTIVE: trading open
- PENDING: created, not started
- CLOSED: expired, no trading
- RESOLVED: outcome determined
- PAUSED: temporarily suspended
- CANCELLED: invalid/cancelled

When live data exists, prioritize it. If it fails, say it briefly and proceed with docs-based info.

Current status: ${liveDataError ? `Live data unavailable (${liveDataError}).` : 'Live data available.'}
`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Context:\n${context}${liveContext}\n\nQuestion: ${query}` },
    ];

    let answer: string;
    try {
      answer = await generateGeminiResponse(messages, { temperature: 0.1, maxTokens: 1200 });
    } catch (error: any) {
      console.error('❌ Gemini API failed:', error);
      if (liveData) {
        if (analysis.queryType === 'single-market') {
          const m = liveData;
          answer = `**Market #${m.id} - ${m.title}**

**Status:** ${m.status.toUpperCase()}
**Volume:** ${formatVolume(m.volume)}  
**Creator Fee:** ${(m.creatorFeeBps / 100).toFixed(2)}%
**Outcomes:** ${m.outcomeCount}

*Live blockchain data fetched successfully. AI service temporarily unavailable.*`;
        } else {
          answer = `**${Array.isArray(liveData) ? liveData.length : 0} Markets Found**

${formatMarketDataCards(Array.isArray(liveData) ? liveData : [liveData], analysis.browseType || 'browse')}

*Live blockchain data fetched successfully. AI service temporarily unavailable.*`;
        }
      } else {
        answer = `Both the AI service and live blockchain data are temporarily unavailable due to rate limits or service load. Please try again shortly.`;
      }
    }

    const citations: { [k: number]: string } = {};
    const sources: string[] = [];
    for (const d of documents) {
      citations[d.index] = d.source;
      if (!sources.includes(d.source)) sources.push(d.source);
    }

    const resp: ChatResponse = {
      answer,
      sources,
      citations,
      liveData,
      responseTime: Date.now() - start,
      dataFreshness,
      queryType: analysis.queryType,
      ...(liveDataError && { error: liveDataError })
    };

    return NextResponse.json(resp);
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
    try {
      const bt = await getBT();
      const status = bt.getConnectionStatus();
      blockchainStatus = status.connected ? 'connected' : 'disconnected';
    } catch {
      blockchainStatus = 'failed';
    }

    return NextResponse.json({
      status: 'healthy',
      service: 'XO Market Expert Chat API',
      timestamp: new Date().toISOString(),
      environment: {
        pineconeConfigured: !!process.env.PINECONE_API_KEY,
        geminiConfigured: !!process.env.GOOGLE_GEMINI_API_KEY,
        blockchainConfigured: !!process.env.XO_MARKET_RPC_URL,
        blockchainStatus,
        indexName: process.env.PINECONE_INDEX || 'xo-market-docs',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { status: 'unhealthy', error: error?.message || 'Unknown error', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
