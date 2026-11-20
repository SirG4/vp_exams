import { NextResponse } from 'next/server';
import { authorizeAdminApi } from '@/lib/admin-api';
import { parseAndValidateBatch } from '@/lib/batch';
import { closeDatabase, migrateDatabase, openDatabase } from '@/lib/database';
import { requireSameOrigin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  const db = openDatabase();
  try {
    migrateDatabase(db);
    const authorization = authorizeAdminApi(request, db);
    if (authorization.response) return authorization.response;
    let formData;
    try { formData = await request.formData(); } catch { return NextResponse.json({ error: 'Invalid multipart batch upload.' }, { status: 400 }); }
    const result = await parseAndValidateBatch(formData);
    if (result.errors.length) return NextResponse.json({ error: 'Batch validation failed.', errors: result.errors }, { status: 400 });
    return NextResponse.json({ valid: true, preview: result.preview });
  } catch (error) {
    console.error('Batch validation failed:', error?.code || error?.name || 'UnknownError');
    return NextResponse.json({ error: 'Batch validation is temporarily unavailable.' }, { status: 503 });
  } finally {
    closeDatabase(db);
  }
}
