import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_metadata_schema',
    sql: `
      PRAGMA foreign_keys = ON;
      CREATE TABLE institutions (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE CHECK(length(code) BETWEEN 2 AND 16),
        name TEXT NOT NULL
      );

      CREATE TABLE exam_sessions (
        id INTEGER PRIMARY KEY,
        institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
        exam_date TEXT NOT NULL,
        session TEXT,
        label TEXT,
        start_time TEXT,
        end_time TEXT,
        publication_state TEXT NOT NULL DEFAULT 'published' CHECK(publication_state IN ('draft','published','unpublished')),
        published_at TEXT,
        UNIQUE(institution_id, exam_date, session)
      );

      CREATE TABLE images (
        id INTEGER PRIMARY KEY,
        blob_key TEXT UNIQUE,
        original_filename TEXT NOT NULL,
        local_source_path TEXT,
        content_type TEXT,
        size_bytes INTEGER,
        sha256 TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE rooms (
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
        room_number TEXT NOT NULL,
        room_label TEXT,
        roll_numbers TEXT NOT NULL DEFAULT '[]',
        image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
        UNIQUE(session_id, room_number)
      );

      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY,
        event_type TEXT NOT NULL,
        actor TEXT,
        institution_code TEXT,
        exam_date TEXT,
        session TEXT,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE INDEX idx_sessions_institution_date ON exam_sessions(institution_id, exam_date);
      CREATE INDEX idx_rooms_session ON rooms(session_id);
      CREATE INDEX idx_audit_created ON audit_events(created_at);
    `,
  },
  {
    version: 2,
    name: 'admin_authentication',
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','super_admin')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','disabled')),
        approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        approved_at TEXT
      );

      CREATE TABLE user_sessions (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
      CREATE INDEX idx_user_sessions_expiry ON user_sessions(expires_at);
    `,
  },
  {
    version: 3,
    name: 'batch_publishing_metadata',
    sql: `
      -- Batch publishing uses the existing metadata, image, room, and audit tables.
    `,
  },
];

export function resolveDatabasePath(explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  if (process.env.EXAM_DB_PATH) return path.resolve(process.env.EXAM_DB_PATH);
  return '/var/lib/vp-exams/exams.db';
}

export function openDatabase(databasePath) {
  let resolved = resolveDatabasePath(databasePath);
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  } catch (error) {
    if (error?.code !== 'EACCES' && error?.code !== 'EPERM') throw error;
    resolved = path.resolve(process.cwd(), '.data/exams.db');
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const db = new DatabaseSync(resolved);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return db;
}

export function migrateDatabase(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return { applied: MIGRATIONS.filter((migration) => !applied.has(migration.version)).map((migration) => migration.version) };
}

export function closeDatabase(db) {
  db.close();
}
