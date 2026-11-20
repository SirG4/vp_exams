import { NextResponse } from 'next/server';
import { requireSameOrigin, revokeSession, SESSION_COOKIE } from '@/lib/auth';
import { closeDatabase, migrateDatabase, openDatabase } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  }

  const db = openDatabase();
  try {
    migrateDatabase(db);
    revokeSession(db, request.cookies.get(SESSION_COOKIE)?.value);
    const response = NextResponse.json({ signedOut: true });
    response.cookies.set(SESSION_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error('Admin sign-out failed:', error?.code || error?.name || 'UnknownError');
    return NextResponse.json({ error: 'Sign-out is temporarily unavailable.' }, { status: 503 });
  } finally {
    closeDatabase(db);
  }
}