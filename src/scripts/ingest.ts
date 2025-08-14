import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { PineconeStore } from '@langchain/pinecone';
import { getPineconeClient, getOrCreateIndex } from '../lib/pinecone';

interface DocumentChunk {
  content: string;
  source: string;
  metadata: {
    filename: string;
    chunkIndex: number;
    totalChunks: number;
    fileType: string;
    directory: string;
  };
}

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GOOGLE_GEMINI_API_KEY!,
  model: "text-embedding-004",
});

async function ingestDocuments() {
  console.log('🚀 Starting document ingestion...');

  const indexName = process.env.PINECONE_INDEX || 'xo-market-docs';
  const index = await getOrCreateIndex(indexName);

  

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
    separators: ['\n\n', '\n', '. ', ' ', ''],
  });

  const documents: DocumentChunk[] = [];

  const dataDir = path.join(process.cwd(), 'data');
  
  async function processDirectory(dir: string, prefix: string = '') {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        console.log(`📁 Processing directory: ${prefix}${item}/`);
        await processDirectory(fullPath, `${prefix}${item}/`);
      } else if (item.endsWith('.md') || item.endsWith('.txt')) {
        console.log(`📄 Processing file: ${prefix}${item}`);
        
        const content = fs.readFileSync(fullPath, 'utf-8');
        const chunks = await splitter.splitText(content);
        
        chunks.forEach((chunk, index) => {
          documents.push({
            content: chunk,
            source: `${prefix}${item}`,
            metadata: {
              filename: item,
              chunkIndex: index,
              totalChunks: chunks.length,
              fileType: path.extname(item),
              directory: prefix,
            },
          });
        });

        console.log(`  ✅ Created ${chunks.length} chunks`);
      }
    }
  }

  await processDirectory(dataDir);

  console.log(`📊 Total chunks to ingest: ${documents.length}`);

  const vectorStore = await PineconeStore.fromTexts(
    documents.map(doc => doc.content),
    documents.map(doc => ({
      source: doc.source,
      ...doc.metadata,
    })),
    embeddings,
    {
      pineconeIndex: index,
      textKey: 'content',
    }
  );

  console.log(`✅ Successfully ingested ${documents.length} document chunks into Pinecone`);
  
  const fileTypes = [...new Set(documents.map(d => d.metadata.fileType))];
  const directories = [...new Set(documents.map(d => d.metadata.directory))];
  
  console.log('\n📈 Ingestion Summary:');
  console.log(`  - Total chunks: ${documents.length}`);
  console.log(`  - File types: ${fileTypes.join(', ')}`);
  console.log(`  - Directories: ${directories.join(', ')}`);
}

if (require.main === module) {
  ingestDocuments().catch(console.error);
}

export { ingestDocuments };
