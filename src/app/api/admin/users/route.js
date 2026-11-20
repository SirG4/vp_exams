import { NextResponse } from 'next/server';
import { authorizeAdminApi } from '@/lib/admin-api';
import { closeDatabase, migrateDatabase, openDatabase } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const db = openDatabase();
  try {
    migrateDatabase(db);
    const authorization = authorizeAdminApi(request, db, { superAdminOnly: true });
    if (authorization.response) return authorization.response;
    const users = db.prepare(`
      SELECT id, email, role, status, created_at, approved_at
      FROM users ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, email COLLATE NOCASE
    `).all();
    return NextResponse.json({ users });
  } catch (error) {
    console.error('Admin user list failed:', error?.code || error?.name || 'UnknownError');
    return NextResponse.json({ error: 'User list is temporarily unavailable.' }, { status: 503 });
  } finally {
    closeDatabase(db);
  }
}