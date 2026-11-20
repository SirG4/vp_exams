import { NextResponse } from 'next/server';
import { getSessionUser, safeUser, SESSION_COOKIE } from '@/lib/auth';
import { closeDatabase, migrateDatabase, openDatabase } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const db = openDatabase();
  try {
    migrateDatabase(db);
    const user = getSessionUser(db, request.cookies.get(SESSION_COOKIE)?.value);
    return NextResponse.json({ user: safeUser(user) });
  } catch (error) {
    console.error('Admin session lookup failed:', error?.code || error?.name || 'UnknownError');
    return NextResponse.json({ error: 'Session lookup is temporarily unavailable.' }, { status: 503 });
  } finally {
    closeDatabase(db);
  }
}