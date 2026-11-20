import { NextResponse } from 'next/server';
import { authorizeAdminApi } from '@/lib/admin-api';
import { requireSameOrigin } from '@/lib/auth';
import { closeDatabase, migrateDatabase, openDatabase } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function PATCH(request, context) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  }

  const { userId: rawUserId } = await context.params;
  const userId = Number(rawUserId);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    return NextResponse.json({ error: 'Invalid user id.' }, { status: 400 });
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
  if ((body.status !== undefined && !['approved', 'disabled'].includes(body.status)) ||
      (body.role !== undefined && !['admin', 'super_admin'].includes(body.role)) ||
      (body.status === undefined && body.role === undefined)) {
    return NextResponse.json({ error: 'Choose a valid status or role change.' }, { status: 400 });
  }

  const db = openDatabase();
  try {
    migrateDatabase(db);
    const authorization = authorizeAdminApi(request, db, { superAdminOnly: true });
    if (authorization.response) return authorization.response;

    db.exec('BEGIN IMMEDIATE');
    const target = db.prepare('SELECT id, email, role, status FROM users WHERE id = ?').get(userId);
    if (!target) {
      db.exec('ROLLBACK');
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const role = body.role ?? target.role;
    const status = body.status ?? target.status;
    if (target.role === 'super_admin' && target.status === 'approved' &&
        (role !== 'super_admin' || status !== 'approved')) {
      const activeSuperAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND status = 'approved'").get().count;
      if (activeSuperAdmins <= 1) {
        db.exec('ROLLBACK');
        return NextResponse.json({ error: 'At least one approved super admin must remain.' }, { status: 409 });
      }
    }

    db.prepare(`
      UPDATE users SET role = ?, status = ?,
        approved_by = CASE WHEN ? = 1 THEN ? ELSE approved_by END,
        approved_at = CASE WHEN ? = 1 THEN COALESCE(approved_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE approved_at END
      WHERE id = ?
    `).run(role, status, body.status === 'approved' ? 1 : 0, authorization.user.id, body.status === 'approved' ? 1 : 0, userId);
    db.prepare('INSERT INTO audit_events (event_type, actor, details) VALUES (?, ?, ?)')
      .run('user_access_changed', authorization.user.email, JSON.stringify({ userId, email: target.email, role, status }));
    db.exec('COMMIT');
    return NextResponse.json({ user: { id: userId, email: target.email, role, status } });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('Admin user update failed:', error?.code || error?.name || 'UnknownError');
    return NextResponse.json({ error: 'User update is temporarily unavailable.' }, { status: 503 });
  } finally {
    closeDatabase(db);
  }
}

export async function DELETE(request, context) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  }

  const { userId: rawUserId } = await context.params;
  const userId = Number(rawUserId);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    return NextResponse.json({ error: 'Invalid user id.' }, { status: 400 });
  }

  const db = openDatabase();
  try {
    migrateDatabase(db);
    const authorization = authorizeAdminApi(request, db, { superAdminOnly: true });
    if (authorization.response) return authorization.response;

    db.exec('BEGIN IMMEDIATE');
    const target = db.prepare('SELECT id, email, role, status FROM users WHERE id = ?').get(userId);
    if (!target) {
      db.exec('ROLLBACK');
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    if (target.role === 'super_admin' && target.status === 'approved') {
      const activeSuperAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND status = 'approved'").get().count;
      if (activeSuperAdmins <= 1) {
        db.exec('ROLLBACK');
        return NextResponse.json({ error: 'At least one approved super admin must remain.' }, { status: 409 });
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.prepare('INSERT INTO audit_events (event_type, actor, details) VALUES (?, ?, ?)')
      .run('user_deleted', authorization.user.email, JSON.stringify({ userId, email: target.email }));
    db.exec('COMMIT');
    return NextResponse.json({ deleted: true });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('Admin user deletion failed:', error?.code || error?.name || 'UnknownError');
    return NextResponse.json({ error: 'User deletion is temporarily unavailable.' }, { status: 503 });
  } finally {
    closeDatabase(db);
  }
}