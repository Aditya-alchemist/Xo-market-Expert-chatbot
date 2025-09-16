import 'dotenv/config';
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone } from '@pinecone-database/pinecone';
import { generateGeminiResponse } from '@/lib/gemini';
import { BlockchainTools } from '@/lib/blockchain';

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
  queryType: 'single-market' | 'browse' | 'general';
  marketId?: string;
  browseType?: 'active' | 'closing-soon' | 'high-volume' | 'newly-created' | 'resolved' | 'paused' | 'closed';
  timeframe?: number;
}

function analyzeQuery(query: string): QueryAnalysis {
  const q = query.toLowerCase();

  const idMatch = q.match(/\b(?:market|id)\s*(\d+)\b/);
  const marketId = idMatch ? idMatch[1] : undefined;

  if (marketId) {
    return { needsLiveData: true, queryType: 'single-market', marketId };
  }

  if (q.includes('closing soon') || q.includes('ending soon')) {
    return { needsLiveData: true, queryType: 'browse', browseType: 'closing-soon', timeframe: 24 };
  }
  if (q.includes('high volume') || q.includes('top volume') || q.includes('popular')) {
    return { needsLiveData: true, queryType: 'browse', browseType: 'high-volume' };
  }
  if (q.includes('new') || q.includes('recent') || q.includes('latest')) {
    return { needsLiveData: true, queryType: 'browse', browseType: 'newly-created', timeframe: 7 };
  }
  if (q.includes('resolved') || q.includes('completed') || q.includes('finished')) {
    return { needsLiveData: true, queryType: 'browse', browseType: 'resolved' };
  }
  if (q.includes('paused')) {
    return { needsLiveData: true, queryType: 'browse', browseType: 'paused' };
  }
  if (q.includes('closed')) {
    return { needsLiveData: true, queryType: 'browse', browseType: 'closed' };
  }

  const needsLiveData = /\b(current|live|active|real-time|now|today|markets|status|price|fetch|all)\b/.test(q);
  return { needsLiveData, queryType: needsLiveData ? 'browse' : 'general', browseType: needsLiveData ? 'active' as const : undefined };
}

function formatMarketDataCards(markets: any[], queryType: string): string {
  if (!markets || markets.length === 0) return 'No markets found matching your criteria.';

  const formatTime = (seconds: number): string => {
    if (seconds <= 0) return 'Expired';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatBigVolume = (volumeStr: string): string => {
    try {
      let cleanStr = volumeStr.replace(/[$,]/g, '');
      
      if (cleanStr.includes('e')) {
        const num = parseFloat(cleanStr);
        const scaledNum = num * 1000000;
        
        if (scaledNum >= 1000000000) return `$${(scaledNum / 1000000000).toFixed(1)}B`;
        if (scaledNum >= 1000000) return `$${(scaledNum / 1000000).toFixed(1)}M`;
        if (scaledNum >= 1000) return `$${(scaledNum / 1000).toFixed(1)}k`;
        if (scaledNum >= 1) return `$${scaledNum.toFixed(0)}`;
        
        return `$${num.toFixed(6)}`;
      }
      
      const num = parseFloat(cleanStr);
      if (isNaN(num)) return volumeStr;
      
      if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
      if (num >= 1000) return `$${(num / 1000).toFixed(1)}k`;
      if (num >= 1) return `$${num.toFixed(0)}`;
      
      const scaled = num * 1000000;
      if (scaled >= 1000000) return `$${(scaled / 1000000).toFixed(1)}M`;
      if (scaled >= 1000) return `$${(scaled / 1000).toFixed(1)}k`;
      if (scaled >= 1) return `$${scaled.toFixed(0)}`;
      
      return `$${num.toFixed(6)}`;
    } catch {
      return volumeStr;
    }
  };

  let out = `🎯 **${markets.length} ${queryType.toUpperCase()} PREDICTION MARKETS**\n\n`;
  
  markets.forEach((m, i) => {
    const title = (m.metadata?.title || m.title || `Market ${m.id}`).slice(0, 65);
    
    out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    out += `**${i + 1}. ${title}**\n`;
    out += `🆔 Market ID: ${m.id} • Status: ${m.status}\n\n`;
    
    out += `💎 **TRADING VOLUME:** ${formatBigVolume(m.totalVolume || m.volume || '0')}\n`;
    out += `🏦 **OPEN INTEREST:** ${formatBigVolume(m.openInterest || '0')}\n`;
    out += `⏰ **TIME REMAINING:** ${formatTime(m.timeToClose || 0)}\n`;
    out += `💵 **CREATOR FEE:** ${(m.creatorFeeBps / 100).toFixed(2)}%\n\n`;
    
    if (Array.isArray(m.currentPrices) && m.currentPrices.length > 0) {
      out += `📊 **CURRENT ODDS:**\n`;
      m.currentPrices.forEach((p: string, idx: number) => {
        const outcome = m.metadata?.outcomes?.[idx] || m.outcomes?.[idx] || `Outcome ${idx + 1}`;
        out += `   • ${outcome}: **${p}%**\n`;
      });
      out += '\n';
    }
    
    if (m.metadata?.description && m.metadata.description.trim() !== '') {
      const desc = String(m.metadata.description).slice(0, 100);
      out += `📝 **Description:** ${desc}${desc.length === 100 ? '...' : ''}\n\n`;
    }
    
    out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  });
  
  return out;
}

export async function POST(request: NextRequest) {
  const start = Date.now();
  try {
    const { query } = await request.json();
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Valid query string is required' }, { status: 400 });
    }

    const analysis = analyzeQuery(query);

    const requiredVars = ['PINECONE_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'XO_MARKET_RPC_URL'];
    for (const varName of requiredVars) {
      if (!process.env[varName]) {
        throw new Error(`${varName} environment variable is not set`);
      }
    }

    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const indexName = process.env.PINECONE_INDEX || 'xo-market-docs';
    const index = pinecone.Index(indexName);

    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GOOGLE_GEMINI_API_KEY!,
      model: 'text-embedding-004',
    });

    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex: index,
      textKey: 'content',
    });

    const retrieval = await vectorStore.similaritySearchWithScore(query, 5);
    const documents = retrieval.map(([doc, score], i) => ({
      content: doc.pageContent,
      source: doc.metadata?.source || 'unknown',
      score,
      index: i + 1,
    }));

    let liveData: any = null;
    let dataFreshness = '';
    let liveDataError = '';

    if (analysis.needsLiveData) {
      try {
        console.log('🔍 Attempting to fetch live blockchain data...');
        const bt = new BlockchainTools();
        await bt.init();

        if (analysis.queryType === 'single-market' && analysis.marketId) {
          liveData = await bt.getMarketById(analysis.marketId);
          dataFreshness = `Live Data • ${new Date().toISOString()}`;
        } else if (analysis.queryType === 'browse') {
          switch (analysis.browseType) {
            case 'closing-soon':
              liveData = await bt.getClosingSoonMarkets(analysis.timeframe || 24);
              break;
            case 'high-volume':
              liveData = await bt.getHighVolumeMarkets(10);
              break;
            case 'newly-created':
              liveData = await bt.getNewlyCreatedMarkets(analysis.timeframe || 7);
              break;
            case 'resolved':
              liveData = await bt.getResolvedMarkets(10);
              break;
            case 'paused':
              liveData = await bt.getMarketsByStatus('Paused');
              break;
            case 'closed':
              liveData = await bt.getMarketsByStatus('Closed');
              break;
            default:
              liveData = await bt.getActiveMarkets();
          }
          dataFreshness = `Live Data (${Array.isArray(liveData) ? liveData.length : liveData ? 1 : 0} markets) • ${new Date().toISOString()}`;
        } else {
          liveData = await bt.getCurrentMarkets();
          dataFreshness = `Live Data (${Array.isArray(liveData) ? liveData.length : 0} markets) • ${new Date().toISOString()}`;
        }
        
        console.log('✅ Live blockchain data fetched successfully');
      } catch (error: any) {
        console.error('❌ Live data fetch failed:', error);
        liveDataError = error.message || 'Unknown error';
        dataFreshness = 'Live data unavailable - using documentation only';
        liveData = null;
      }
    }

    const context = documents
      .map((d) => `[${d.index}] Source: ${d.source}\n${d.content}`)
      .join('\n\n');

    const liveContext = liveData
      ? `\n\n[Live Data at ${new Date().toISOString()}]\n${formatMarketDataCards(Array.isArray(liveData) ? liveData : [liveData], analysis.browseType || analysis.queryType)}`
      : liveDataError
      ? `\n\n[Live Data Error: ${liveDataError}]`
      : '';

    const systemPrompt = `You are XO Market Expert, a friendly, helpful assistant for the XO Market prediction platform.

Tone & style:
- Write in clear, natural language like a knowledgeable analyst speaking to a teammate.
- Use short paragraphs and concise sentences; avoid sounding like a specification.
- Prefer simple bullet points over dense blocks. Do not emit JSON or bracketed lists unless explicitly requested.
- Add a one-line takeaway at the end when helpful.

Data use:
- Use the provided docs for background (you may cite inline as [1], [2] only if the user asks for sources).
- When live blockchain data is provided, lead with a plain-English summary (what changed, what matters), then show key numbers (prices, volume, OI, fees, time to close).
- If live data failed, say so briefly and proceed with docs-based guidance.
- When showing multiple markets, write a 1–2 sentence overview first, then present a tidy bulleted list (title, id, status, volume, time remaining). Keep numbers human-friendly: $13.3M, $2.4k, 2h 10m.

Formatting rules:
- Never output raw JSON blocks or internal field names.
- Avoid long repetitive dividers. Keep the message scannable.
- Use at most 5 bullets per section.

Output shape (adapt as needed):
1) One-sentence answer in plain English
2) Brief details (1–3 short paragraphs)
3) Bulleted facts (only essentials)
4) If live data present: “Live data as of <ISO time>”
5) Short closing tip

Current status: ${liveDataError ? `Live blockchain data unavailable (${liveDataError}). Using documentation.` : 'Live blockchain data available.'}
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
**Volume:** ${m.volume} USDC  
**Open Interest:** ${m.openInterest} USDC
**Creator Fee:** ${(m.creatorFeeBps / 100).toFixed(2)}%
**Alpha:** ${m.alpha}
**Outcomes:** ${m.outcomeCount}

*Live blockchain data fetched successfully. AI service temporarily unavailable.*`;
        } else {
          answer = `**${Array.isArray(liveData) ? liveData.length : 0} Markets Found**

${formatMarketDataCards(Array.isArray(liveData) ? liveData : [liveData], analysis.browseType || 'browse')}

*Live blockchain data fetched successfully. AI service temporarily unavailable.*`;
        }
      } else {
        answer = `I apologize, but both the AI service and live blockchain data are currently unavailable due to rate limits or technical issues. 

Please try again in a few minutes, or visit the XO Market documentation directly for information about the platform.

**Error Details:** ${error.message || 'API rate limit exceeded'}`;
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
      const bt = new BlockchainTools();
      await bt.init();
      const status = bt.getConnectionStatus();
      blockchainStatus = status.connected ? 'connected' : 'disconnected';
    } catch (error) {
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
      {
        status: 'unhealthy',
        error: error?.message || 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
