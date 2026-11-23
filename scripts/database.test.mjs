import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { closeDatabase, migrateDatabase, openDatabase } from '../src/lib/database.js';

const root = path.resolve(process.cwd());

test('empty database migrates once and stays idempotent', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-exams-db-'));
  const dbPath = path.join(tempDir, 'empty.db');
  const db = openDatabase(dbPath);
  assert.deepEqual(migrateDatabase(db).applied, [1, 2, 3]);
  assert.deepEqual(migrateDatabase(db).applied, []);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
  assert.ok(tables.includes('institutions'));
  assert.ok(tables.includes('exam_sessions'));
  assert.ok(tables.includes('rooms'));
  assert.ok(tables.includes('images'));
  assert.ok(tables.includes('audit_events'));
  assert.ok(tables.includes('users'));
  assert.ok(tables.includes('user_sessions'));
  closeDatabase(db);
});

test('existing JSON datasets migrate without duplication and preserve representative records', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-exams-db-'));
  const dbPath = path.join(tempDir, 'migration.db');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(process.execPath, ['scripts/migrate-exams.mjs', dbPath], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }

  const db = openDatabase(dbPath);
  migrateDatabase(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM institutions').get().count, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM exam_sessions').get().count, 2);

  const vpSession = db.prepare(`
    SELECT es.*, i.code FROM exam_sessions es
    JOIN institutions i ON i.id = es.institution_id
    WHERE i.code = 'VP' AND es.exam_date = '2026-11-17'
  `).get();
  assert.ok(vpSession);
  assert.equal(vpSession.session, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rooms WHERE session_id = ?').get(vpSession.id).count, 20);

  const vitImage = db.prepare(`
    SELECT r.room_number, i.original_filename
    FROM rooms r LEFT JOIN images i ON i.id = r.image_id
    JOIN exam_sessions es ON es.id = r.session_id JOIN institutions ins ON ins.id = es.institution_id
    WHERE ins.code = 'VIT' AND r.room_number = 'E201'
  `).get();
  assert.equal(vitImage.room_number, 'E201');

  const vpV002 = db.prepare(`
    SELECT r.room_number, i.original_filename
    FROM rooms r LEFT JOIN images i ON i.id = r.image_id
    JOIN exam_sessions es ON es.id = r.session_id JOIN institutions ins ON ins.id = es.institution_id
    WHERE ins.code = 'VP' AND r.room_number = 'V002'
  `).get();
  assert.equal(vpV002.room_number, 'V002');
  if (vpV002.original_filename) assert.equal(vpV002.original_filename, 'V002.JPG');

  const before = db.prepare('SELECT COUNT(*) AS count FROM rooms').get().count;
  closeDatabase(db);

  const rerun = spawnSync(process.execPath, ['scripts/migrate-exams.mjs', dbPath], { cwd: root, encoding: 'utf8' });
  assert.equal(rerun.status, 0, rerun.stderr);
  const reopened = openDatabase(dbPath);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM rooms').get().count, before);
  closeDatabase(reopened);
});

test('interrupted migration transaction can be replaced by a disposable database', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-exams-db-'));
  const dbPath = path.join(tempDir, 'rollback.db');
  const db = openDatabase(dbPath);
  migrateDatabase(db);
  db.exec('BEGIN IMMEDIATE');
  db.prepare("INSERT INTO institutions (code, name) VALUES ('TEST', 'Test')").run();
  db.exec('ROLLBACK');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM institutions WHERE code = 'TEST'").get().count, 0);
  closeDatabase(db);
});
