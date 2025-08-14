import { GoogleGenerativeAI } from '@google/generative-ai';

let geminiInstance: GoogleGenerativeAI | null = null;

export function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiInstance) {
    geminiInstance = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);
  }
  return geminiInstance;
}

export async function generateGeminiResponse(
  messages: Array<{role: string; content: string}>,
  options?: {
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash", // Using flash model as recommended
    generationConfig: {
      temperature: options?.temperature || 0.1,
      maxOutputTokens: options?.maxTokens || 1000,
    }
  });

  const prompt = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n\n');
  
  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error: any) {
      retryCount++;
      
      if (error.status === 503 && retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 2s, 4s, 8s
        console.log(`🔄 Gemini service overloaded, retrying in ${delay/1000}s... (attempt ${retryCount}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw error;
    }
  }
  
  throw new Error('Gemini service unavailable after all retries');
}
