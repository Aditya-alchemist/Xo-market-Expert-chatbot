import { NextRequest, NextResponse } from 'next/server';
import { ingestDocuments } from '@/scripts/ingest';

export async function POST(request: NextRequest) {
  try {
    console.log('Starting document ingestion via API...');
    
    await ingestDocuments();
    
    return NextResponse.json({
      success: true,
      message: 'Documents ingested successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Ingestion API error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Ingestion failed', 
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'Ingestion API is ready. Use POST to trigger ingestion.',
    endpoint: '/api/ingest',
    method: 'POST',
  });
}
