import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { closeDatabase, migrateDatabase, openDatabase } from '../src/lib/database.js';

const root = path.resolve(process.cwd());
const dataFiles = [
  ['VIT', 'src/data/vit-exams.json'],
  ['VP', 'src/data/vp-exams.json'],
  ['VSIT', 'src/data/vsit-exams.json'],
];

const databasePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.env.EXAM_DB_PATH
    ? path.resolve(process.env.EXAM_DB_PATH)
    : '/var/lib/vp-exams/exams.db';

const db = openDatabase(databasePath);

try {
  migrateDatabase(db);

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [code, relativeFile] of dataFiles) {
      const sourcePath = path.join(root, relativeFile);
      if (!fs.existsSync(sourcePath)) throw new Error(`Missing source JSON: ${relativeFile}`);
      const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

      db.prepare('INSERT INTO institutions (code, name) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name')
        .run(code, code);
      const institution = db.prepare('SELECT id FROM institutions WHERE code = ?').get(code);

      for (const exam of source.exams ?? []) {
        const session = typeof exam.session === 'string' ? exam.session : null;
        const existingSession = db.prepare(`
          SELECT id FROM exam_sessions
          WHERE institution_id = ? AND exam_date = ? AND session IS ?
        `).get(institution.id, exam.date, session);

        let sessionId;
        if (existingSession) {
          sessionId = existingSession.id;
          db.prepare(`UPDATE exam_sessions SET label = ?, start_time = ?, end_time = ?, publication_state = 'published', published_at = COALESCE(published_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?`)
            .run(exam.label ?? null, source.startTime ?? null, source.endTime ?? null, sessionId);
        } else {
          const result = db.prepare(`
            INSERT INTO exam_sessions (institution_id, exam_date, session, label, start_time, end_time, publication_state, published_at)
            VALUES (?, ?, ?, ?, ?, ?, 'published', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          `).run(institution.id, exam.date, session, exam.label ?? null, source.startTime ?? null, source.endTime ?? null);
          sessionId = Number(result.lastInsertRowid);
        }

        for (const room of exam.rooms ?? []) {
          const imageFilename = room.imageFile ?? `${room.roomNumber}.jpg`;
          const legacyDirectory = `${exam.date.slice(8, 10)}${new Date(`${exam.date}T12:00:00`).toLocaleString('en-US', { month: 'long' }).toLowerCase()}${session ? `_${session}` : ''}`;
          const localSourcePath = path.posix.join(legacyDirectory, imageFilename);
          const publicSourcePath = path.join(root, 'public', localSourcePath);

          let imageId = null;
          if (fs.existsSync(publicSourcePath)) {
            const bytes = fs.readFileSync(publicSourcePath);
            const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
            const blobKey = `legacy/${code}/${exam.date}/${session || 'default'}/${imageFilename}`;
            const existingImage = db.prepare('SELECT id FROM images WHERE blob_key = ?').get(blobKey);
            if (existingImage) {
              imageId = existingImage.id;
              db.prepare(`UPDATE images SET original_filename = ?, local_source_path = ?, content_type = ?, size_bytes = ?, sha256 = ? WHERE id = ?`)
                .run(imageFilename, localSourcePath, bytes.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg' : 'application/octet-stream', bytes.length, sha256, existingImage.id);
            } else {
              const imageResult = db.prepare(`
                INSERT INTO images (blob_key, original_filename, local_source_path, content_type, size_bytes, sha256)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(blobKey, imageFilename, localSourcePath, bytes.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg' : 'application/octet-stream', bytes.length, sha256);
              imageId = Number(imageResult.lastInsertRowid);
            }
          }

          db.prepare(`
            INSERT INTO rooms (session_id, room_number, room_label, roll_numbers, image_id)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(session_id, room_number) DO UPDATE SET
              room_label = excluded.room_label,
              roll_numbers = excluded.roll_numbers,
              image_id = COALESCE(excluded.image_id, rooms.image_id)
          `).run(sessionId, room.roomNumber, room.label ?? null, JSON.stringify(room.rollNumbers ?? []), imageId);
        }
      }

      db.prepare(`
        INSERT INTO audit_events (event_type, actor, institution_code, details)
        VALUES ('legacy_import', 'migration', ?, ?)
      `).run(code, JSON.stringify({ sourceFile: relativeFile }));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const institutionCount = db.prepare('SELECT COUNT(*) AS count FROM institutions').get().count;
  const sessionCount = db.prepare('SELECT COUNT(*) AS count FROM exam_sessions').get().count;
  const roomCount = db.prepare('SELECT COUNT(*) AS count FROM rooms').get().count;
  const imageCount = db.prepare('SELECT COUNT(*) AS count FROM images').get().count;
  console.log(JSON.stringify({ databasePath, institutionCount, sessionCount, roomCount, imageCount }, null, 2));
} finally {
  closeDatabase(db);
}
