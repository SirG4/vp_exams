import { NextResponse } from 'next/server';
import { hashPassword, isValidEmail, normalizeEmail, requireSameOrigin } from '@/lib/auth';
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
  if (!isValidEmail(email) || password.length < 12 || password.length > 128) {
    return NextResponse.json({ error: 'Enter a valid email and a password of 12 to 128 characters.' }, { status: 400 });
  }

  const db = openDatabase();
  try {
    migrateDatabase(db);
    const passwordHash = await hashPassword(password);
    db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, passwordHash);
    db.prepare('INSERT INTO audit_events (event_type, actor, details) VALUES (?, ?, ?)')
      .run('signup_pending', email, 'Admin signup awaiting super-admin approval.');
    return NextResponse.json({ status: 'pending', message: 'Signup received. A super admin must approve your account.' }, { status: 201 });
  } catch (error) {
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
    }
    console.error('Admin signup failed:', error?.code || error?.name || 'UnknownError');
    return NextResponse.json({ error: 'Signup is temporarily unavailable.' }, { status: 503 });
  } finally {
    closeDatabase(db);
  }
}