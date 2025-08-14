import { Pinecone } from '@pinecone-database/pinecone';

let pineconeInstance: Pinecone | null = null;

export async function getPineconeClient(): Promise<Pinecone> {
  if (!pineconeInstance) {
    pineconeInstance = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
  }
  return pineconeInstance;
}

export async function getOrCreateIndex(indexName: string, dimension: number = 1536) {
  const pinecone = await getPineconeClient();
  
  try {
    const existingIndex = pinecone.index(indexName);
    await existingIndex.describeIndexStats();
    console.log(`✅ Using existing index: ${indexName}`);
    return existingIndex;
  } catch (error) {
    try {
      console.log(`Creating new index: ${indexName}`);
      await pinecone.createIndex({
        name: indexName,
        dimension: dimension,
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1'
          }
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 10000));
      return pinecone.index(indexName);
    } catch (createError: any) {
      if (createError.message?.includes('ALREADY_EXISTS')) {
        console.log(`✅ Index ${indexName} already exists, using existing index`);
        return pinecone.index(indexName);
      }
      throw createError;
    }
  }
}

