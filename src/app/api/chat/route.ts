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
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { query } = await request.json();
    
    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Valid query string is required' },
        { status: 400 }
      );
    }

    console.log('Environment check:');
    console.log('- PINECONE_API_KEY:', process.env.PINECONE_API_KEY ? 'Loaded ✅' : 'Missing ❌');
    console.log('- GOOGLE_GEMINI_API_KEY:', process.env.GOOGLE_GEMINI_API_KEY ? 'Loaded ✅' : 'Missing ❌');
    console.log('- PINECONE_INDEX:', process.env.PINECONE_INDEX || 'Not set');

    if (!process.env.PINECONE_API_KEY) {
      throw new Error('PINECONE_API_KEY is not set in environment variables');
    }

    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      throw new Error('GOOGLE_GEMINI_API_KEY is not set in environment variables');
    }

    let pinecone: Pinecone;
    try {
      pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
      });
    } catch (error) {
      console.error('Failed to initialize Pinecone:', error);
      throw new Error('Failed to initialize Pinecone client');
    }

    const indexName = process.env.PINECONE_INDEX || 'xo-market-docs';
    const index = pinecone.Index(indexName);

    try {
      await index.describeIndexStats();
      console.log('✅ Pinecone connection successful');
    } catch (error) {
      console.error('❌ Pinecone connection failed:', error);
      throw new Error('Failed to connect to Pinecone index');
    }
    
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GOOGLE_GEMINI_API_KEY,
      model: "text-embedding-004",
    });

    let vectorStore: PineconeStore;
    try {
      vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
        pineconeIndex: index,
        textKey: 'content',
      });
    } catch (error) {
      console.error('Failed to create vector store:', error);
      throw new Error('Failed to initialize vector store');
    }

    let retrievalResults;
    try {
      retrievalResults = await vectorStore.similaritySearchWithScore(query, 5);
      console.log(`📊 Retrieved ${retrievalResults.length} relevant documents`);
    } catch (error) {
      console.error('Failed to retrieve documents:', error);
      throw new Error('Failed to search documents');
    }
    
    const documents = retrievalResults.map(([doc, score], index) => ({
      content: doc.pageContent,
      source: doc.metadata.source || 'unknown',
      score,
      index: index + 1,
    }));

    const needsLiveData = /current|live|active|real-time|now|today/.test(query.toLowerCase()) ||
                         /market.*status|market.*count|latest.*market/.test(query.toLowerCase());

    let liveData = null;
    if (needsLiveData) {
      try {
        console.log('🔴 Fetching live blockchain data...');
        const blockchainTools = new BlockchainTools();
        liveData = await blockchainTools.getCurrentMarkets();
        console.log('✅ Live data retrieved successfully');
      } catch (error) {
        console.error('Failed to fetch live data:', error);
      }
    }

    const context = documents.map((doc) => 
      `[${doc.index}] Source: ${doc.source}\n${doc.content}`
    ).join('\n\n');

    const liveDataContext = liveData ? 
      `\n\nLive Market Data: ${JSON.stringify(liveData, null, 2)}` : '';

    const systemPrompt = `You are the XO Market Expert, a specialized assistant for the XO Market prediction platform.

Your responsibilities:
1. Answer questions about XO Market using ONLY the provided context documents
2. Always include citations using [1], [2], etc. format referring to the source documents
3. If live blockchain data is provided, incorporate it naturally into your response
4. Be concise, accurate, and helpful
5. If you don't know something from the provided context, say so clearly

Rules:
- Always cite your sources using [1], [2] format
- Never make up information not in the provided context
- For technical questions about smart contracts or markets, be precise
- When live data is available, mention that it's current/real-time data

Context documents will be provided with each query.`;

    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: `Context:\n${context}${liveDataContext}\n\nQuestion: ${query}`
      }
    ];

    let answer: string;
    try {
      console.log('🤖 Generating response with Gemini...');
      answer = await generateGeminiResponse(messages, {
        temperature: 0.1,
        maxTokens: 1000,
      });
      console.log('✅ Response generated successfully');
    } catch (error) {
      console.error('Failed to generate response:', error);
      
      if (error instanceof Error && error.message.includes('429')) {
        return NextResponse.json({
          error: 'Rate limit exceeded',
          details: 'The AI service is temporarily unavailable due to rate limits. Please try again in a few minutes.',
          responseTime: Date.now() - startTime,
          sources: documents.map(doc => doc.source),
          citations: documents.reduce((acc, doc) => {
            acc[doc.index] = doc.source;
            return acc;
          }, {} as { [key: number]: string })
        }, { status: 429 });
      }
      
      throw new Error('Failed to generate AI response');
    }

    const citations: { [key: number]: string } = {};
    const sources: string[] = [];
    
    documents.forEach((doc) => {
      citations[doc.index] = doc.source;
      if (!sources.includes(doc.source)) {
        sources.push(doc.source);
      }
    });

    const response: ChatResponse = {
      answer,
      sources,
      citations,
      liveData,
      responseTime: Date.now() - startTime,
    };

    console.log(`✅ Request completed in ${response.responseTime}ms`);
    return NextResponse.json(response);

  } catch (error) {
    console.error('Chat API error:', error);
    
    let errorMessage = 'Internal server error';
    let statusCode = 500;
    
    if (error instanceof Error) {
      if (error.message.includes('PINECONE_API_KEY')) {
        errorMessage = 'Pinecone configuration error';
        statusCode = 500;
      } else if (error.message.includes('GOOGLE_GEMINI_API_KEY')) {
        errorMessage = 'Google Gemini configuration error';
        statusCode = 500;
      } else if (error.message.includes('connect') || error.message.includes('authorization')) {
        errorMessage = 'Database connection error';
        statusCode = 503;
      }
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        details: error instanceof Error ? error.message : 'Unknown error',
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
      { status: statusCode }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({
      status: 'healthy',
      service: 'XO Market Expert Chat API',
      timestamp: new Date().toISOString(),
      environment: {
        pineconeConfigured: !!process.env.PINECONE_API_KEY,
        geminiConfigured: !!process.env.GOOGLE_GEMINI_API_KEY,
        indexName: process.env.PINECONE_INDEX || 'xo-market-docs'
      }
    });
  } catch (error) {
    return NextResponse.json(
      { 
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
