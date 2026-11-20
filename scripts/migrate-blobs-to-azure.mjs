import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

import { closeDatabase, migrateDatabase, openDatabase } from '../src/lib/database.js';
import { downloadBlob, ensurePrivateContainer, uploadBlob } from '../src/lib/azure-storage.js';

const root = path.resolve(process.cwd());
const databasePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.env.EXAM_DB_PATH
    ? path.resolve(process.env.EXAM_DB_PATH)
    : '/var/lib/vp-exams/exams.db';

const db = openDatabase(databasePath);
try {
  migrateDatabase(db);
  await ensurePrivateContainer();

  const images = db.prepare(`
    SELECT id, blob_key, original_filename, local_source_path, content_type
    FROM images
    WHERE local_source_path IS NOT NULL
  `).all();

  let uploaded = 0;
  let unchanged = 0;
  let missing = 0;

  for (const image of images) {
    const sourcePath = path.join(root, 'public', image.local_source_path);
    if (!fs.existsSync(sourcePath)) {
      missing += 1;
      continue;
    }

    const bytes = fs.readFileSync(sourcePath);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const contentType = image.content_type || 'application/octet-stream';
    const remote = await downloadBlob(image.blob_key);
    const remoteSha = remote ? crypto.createHash('sha256').update(remote.bytes).digest('hex') : null;

    if (remoteSha === sha256) {
      unchanged += 1;
    } else {
      await uploadBlob(image.blob_key, bytes, contentType);
      uploaded += 1;
    }

    db.prepare(`
      UPDATE images
      SET sha256 = ?, size_bytes = ?, content_type = ?
      WHERE id = ?
    `).run(sha256, bytes.length, contentType, image.id);
  }

  db.prepare(`
    INSERT INTO audit_events (event_type, actor, details)
    VALUES ('legacy_blob_migration', 'migration', ?)
  `).run(JSON.stringify({ uploaded, unchanged, missing, databasePath }));

  console.log(JSON.stringify({ databasePath, uploaded, unchanged, missing }, null, 2));
} finally {
  closeDatabase(db);
}
