import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createSession,
  getSessionUser,
  hashPassword,
  normalizeEmail,
  requireSameOrigin,
  revokeSession,
  SESSION_COOKIE,
  verifyPassword,
} from '../src/lib/auth.js';
import { authorizeAdminApi } from '../src/lib/admin-api.js';
import { closeDatabase, migrateDatabase, openDatabase } from '../src/lib/database.js';

function createTestDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-exams-auth-'));
  const db = openDatabase(path.join(directory, 'auth.db'));
  migrateDatabase(db);
  return db;
}

test('password hashes are salted and verify without storing plaintext', async () => {
  const firstHash = await hashPassword('a-long-example-password');
  const secondHash = await hashPassword('a-long-example-password');
  assert.notEqual(firstHash, secondHash);
  assert.equal(await verifyPassword('a-long-example-password', firstHash), true);
  assert.equal(await verifyPassword('incorrect-password', firstHash), false);
});

test('sessions are opaque, require an approved user, and can be revoked', async () => {
  const db = createTestDatabase();
  try {
    const passwordHash = await hashPassword('another-long-example-password');
    const inserted = db.prepare("INSERT INTO users (email, password_hash, status) VALUES (?, ?, 'approved')")
      .run('admin@example.test', passwordHash);
    const session = createSession(db, inserted.lastInsertRowid);
    const storedHash = db.prepare('SELECT token_hash FROM user_sessions').get().token_hash;
    assert.notEqual(session.token, storedHash);
    assert.equal(getSessionUser(db, session.token).email, 'admin@example.test');

    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(inserted.lastInsertRowid);
    assert.equal(getSessionUser(db, session.token), null);
    db.prepare("UPDATE users SET status = 'approved' WHERE id = ?").run(inserted.lastInsertRowid);
    db.prepare("UPDATE user_sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    assert.equal(getSessionUser(db, session.token), null);

    const freshSession = createSession(db, inserted.lastInsertRowid);
    revokeSession(db, freshSession.token);
    assert.equal(getSessionUser(db, freshSession.token), null);
  } finally {
    closeDatabase(db);
  }
});

test('email addresses are normalized before account lookup', () => {
  assert.equal(normalizeEmail('  Admin@Example.Test '), 'admin@example.test');
});

test('admin API authorization rejects missing sessions and restricts super-admin APIs', () => {
  const db = createTestDatabase();
  try {
    const regularAdminId = db.prepare(`
      INSERT INTO users (email, password_hash, role, status)
      VALUES (?, 'unused-test-hash', 'admin', 'approved')
    `).run('admin@example.test').lastInsertRowid;
    const superAdminId = db.prepare(`
      INSERT INTO users (email, password_hash, role, status)
      VALUES (?, 'unused-test-hash', 'super_admin', 'approved')
    `).run('super@example.test').lastInsertRowid;
    const regularAdminSession = createSession(db, regularAdminId);
    const superAdminSession = createSession(db, superAdminId);
    const requestFor = (token) => ({
      cookies: { get: (name) => name === SESSION_COOKIE && token ? { value: token } : undefined },
    });

    assert.equal(authorizeAdminApi(requestFor(null), db).response.status, 401);
    assert.equal(authorizeAdminApi(requestFor(regularAdminSession.token), db).user.email, 'admin@example.test');
    assert.equal(authorizeAdminApi(requestFor(regularAdminSession.token), db, { superAdminOnly: true }).response.status, 403);
    assert.equal(authorizeAdminApi(requestFor(superAdminSession.token), db, { superAdminOnly: true }).user.email, 'super@example.test');

    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(superAdminId);
    assert.equal(authorizeAdminApi(requestFor(superAdminSession.token), db).response.status, 401);
  } finally {
    closeDatabase(db);
  }
});

test('state-changing requests require an exact same origin', () => {
  const request = (url, origin, host, forwardedHost, forwardedProto) => new Request(url, {
    headers: {
      ...(origin ? { origin } : {}),
      ...(host ? { host } : {}),
      ...(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}),
      ...(forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {}),
    },
  });

  assert.equal(requireSameOrigin(request('https://portal.example/api/admin/users', 'https://portal.example', 'portal.example')), true);
  assert.equal(requireSameOrigin(request('https://portal.example/api/admin/users', 'https://attacker.example', 'portal.example')), false);
  assert.equal(requireSameOrigin(request('https://portal.example/api/admin/users')), false);
  assert.equal(requireSameOrigin(request('http://localhost:3030/api/auth/login', 'http://localhost:3030', 'localhost:3030')), true);
  assert.equal(requireSameOrigin(request('https://internal.example/api/admin/users', 'https://public.example', 'internal.example', 'public.example', 'https')), true);
});