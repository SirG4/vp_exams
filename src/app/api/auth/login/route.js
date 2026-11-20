import { NextResponse } from 'next/server';
import { SESSION_COOKIE, createSession, normalizeEmail, requireSameOrigin, safeUser, verifyPassword } from '@/lib/auth';
import { closeDatabase, migrateDatabase, openDatabase } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  if (password.length > 128) {
    return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 });
  }
  const db = openDatabase();
  try {
    migrateDatabase(db);
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 });
    }
    if (user.status !== 'approved') {
      return NextResponse.json({ error: user.status === 'pending' ? 'Your account is awaiting approval.' : 'This account is unavailable.' }, { status: 403 });
    }

    const session = createSession(db, user.id);
    const response = NextResponse.json({ user: safeUser(user) });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
      expires: new Date(session.expiresAt),
    });
    return response;
  } catch (error) {
    console.error('Admin sign-in failed:', error?.code || error?.name || 'UnknownError');
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 503 });
  } finally {
    closeDatabase(db);
  }
}