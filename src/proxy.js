import { NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { closeDatabase, migrateDatabase, openDatabase } from '@/lib/database';

function lookupUser(token) {
  const db = openDatabase();
  try {
    migrateDatabase(db);
    return getSessionUser(db, token);
  } finally {
    closeDatabase(db);
  }
}

export function proxy(request) {
  let user;
  try {
    user = lookupUser(request.cookies.get(SESSION_COOKIE)?.value);
  } catch (error) {
    console.error('Admin authorization lookup failed:', error?.code || error?.name || 'UnknownError');
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Authorization is temporarily unavailable.' }, { status: 503 });
    }
    return new NextResponse('Admin access is temporarily unavailable.', { status: 503 });
  }

  if (!user) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Sign-in required.' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};