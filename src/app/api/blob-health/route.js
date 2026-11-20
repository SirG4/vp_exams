import { NextResponse } from 'next/server';
import { ensurePrivateContainer } from '@/lib/azure-storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensurePrivateContainer();
    return NextResponse.json({ configured: true, status: 'ready' });
  } catch (error) {
    console.error('Azure Blob health check failed:', error?.code || error?.name || 'ConfigurationError');
    return NextResponse.json(
      { configured: false, status: 'unavailable' },
      { status: 503 },
    );
  }
}
