import OpenAI from 'openai';

let openaiInstance: OpenAI | null = null;

const RATE_LIMIT = {
  requestsPerMinute: 50, // Conservative limit
  tokensPerMinute: 40000,
  currentRequests: 0,
  currentTokens: 0,
  lastReset: Date.now(),
};

export function getOpenAIClient(): OpenAI {
  if (!openaiInstance) {
    openaiInstance = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    });
  }
  return openaiInstance;
}

async function checkRateLimit(estimatedTokens: number = 1000): Promise<void> {
  const now = Date.now();
  const timeSinceReset = now - RATE_LIMIT.lastReset;
  
  if (timeSinceReset >= 60000) {
    RATE_LIMIT.currentRequests = 0;
    RATE_LIMIT.currentTokens = 0;
    RATE_LIMIT.lastReset = now;
  }
  
  if (RATE_LIMIT.currentRequests >= RATE_LIMIT.requestsPerMinute - 5) {
    const waitTime = 60000 - timeSinceReset + 1000; // Wait until next reset + buffer
    console.log(`⏳ Rate limit approaching, waiting ${waitTime}ms...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
}

export async function generateEmbedding(
  text: string, 
  dimensions: number = 512 // Reduced from 1536 to save costs[7]
): Promise<number[]> {
  await checkRateLimit(100); // Embeddings use fewer tokens
  
  const openai = getOpenAIClient();
  
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002", // Cheaper embedding model
      input: text.replace(/\n/g, ' '), // Clean input
      dimensions: dimensions, // Reduce dimensions for cost savings
    });
    
    RATE_LIMIT.currentRequests++;
    RATE_LIMIT.currentTokens += 100; // Estimate
    
    return response.data[0].embedding;
  } catch (error: any) {
    if (error.status === 429) {
      console.log('🔄 Rate limit hit, retrying in 30 seconds...');
      await new Promise(resolve => setTimeout(resolve, 30000));
      return generateEmbedding(text, dimensions); // Retry
    }
    throw error;
  }
}

export async function generateChatCompletion(
  messages: Array<{role: string; content: string}>,
  options?: {
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  const estimatedTokens = messages.reduce((sum, msg) => sum + msg.content.length / 4, 0);
  await checkRateLimit(estimatedTokens);
  
  const openai = getOpenAIClient();
  
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', 
      messages: messages.map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content
      })),
      temperature: options?.temperature || 0.1,
      max_tokens: options?.maxTokens || 800, // Reduced for cost control
    });
    
    RATE_LIMIT.currentRequests++;
    RATE_LIMIT.currentTokens += estimatedTokens;
    
    return completion.choices[0]?.message?.content || '';
  } catch (error: any) {
    if (error.status === 429) {
      console.log('🔄 Rate limit hit, retrying with exponential backoff...');
      await new Promise(resolve => setTimeout(resolve, 60000));
      return generateChatCompletion(messages, options); // Retry
    }
    throw error;
  }
}

