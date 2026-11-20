import { emitKeypressEvents } from 'node:readline';
import nextEnv from '@next/env';
import { hashPassword, isValidEmail, normalizeEmail } from '../src/lib/auth.js';
import { closeDatabase, migrateDatabase, openDatabase } from '../src/lib/database.js';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

function promptLine(label) {
  return new Promise((resolve) => {
    process.stdout.write(label);
    process.stdin.resume();
    process.stdin.once('data', (data) => resolve(data.toString().trim()));
  });
}

function promptHidden(label) {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive server terminal.');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write(label);

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.removeListener('keypress', onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onKeypress = (character, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('Bootstrap cancelled.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') value = value.slice(0, -1);
      else if (!key.ctrl && character) value += character;
    };
    process.stdin.on('keypress', onKeypress);
  });
}

try {
  const email = normalizeEmail(await promptLine('Super-admin email: '));
  if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
  const password = await promptHidden('Password (12-128 characters): ');
  const confirmation = await promptHidden('Confirm password: ');
  if (password.length < 12 || password.length > 128) throw new Error('Password must be 12 to 128 characters.');
  if (password !== confirmation) throw new Error('Passwords do not match.');

  const db = openDatabase();
  try {
    migrateDatabase(db);
    db.exec('BEGIN IMMEDIATE');
    try {
    const passwordHash = await hashPassword(password);
    const existing = db.prepare('SELECT id, role, status FROM users WHERE email = ? COLLATE NOCASE').get(email);
    let result;
    let action;
    if (existing) {
      db.prepare(`
        UPDATE users
        SET password_hash = ?, role = 'super_admin', status = 'approved',
            approved_at = COALESCE(approved_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        WHERE id = ?
      `).run(passwordHash, existing.id);
      result = { lastInsertRowid: existing.id };
      action = 'updated and promoted';
    } else {
      result = db.prepare(`
        INSERT INTO users (email, password_hash, role, status, approved_at)
        VALUES (?, ?, 'super_admin', 'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      `).run(email, passwordHash);
      action = 'created';
    }
    db.prepare('INSERT INTO audit_events (event_type, actor, details) VALUES (?, ?, ?)')
      .run('super_admin_bootstrapped', email, JSON.stringify({ action, userId: Number(result.lastInsertRowid) }));
    db.exec('COMMIT');
    console.log(`Super admin ${action}: ${email} (user ${result.lastInsertRowid}).`);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  } finally {
    closeDatabase(db);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}