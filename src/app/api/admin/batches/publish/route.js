import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeAdminApi } from '@/lib/admin-api';
import { parseAndValidateBatch, filenameKey } from '@/lib/batch';
import { closeDatabase, migrateDatabase, openDatabase } from '@/lib/database';
import { requireSameOrigin } from '@/lib/auth';
import { deleteBlob, downloadBlob, uploadBlob } from '@/lib/azure-storage';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  const db = openDatabase();
  const stagedKeys = new Set();
  const finalKeys = new Set();
  try {
    migrateDatabase(db);
    const authorization = authorizeAdminApi(request, db);
    if (authorization.response) return authorization.response;

    let formData;
    try { formData = await request.formData(); } catch { return NextResponse.json({ error: 'Invalid multipart batch upload.' }, { status: 400 }); }
    const replacement = formData.get('replace') === 'true';
    const result = await parseAndValidateBatch(formData);
    if (result.errors.length) return NextResponse.json({ error: 'Batch validation failed.', errors: result.errors }, { status: 400 });

    const existing = db.prepare(`
      SELECT es.id FROM exam_sessions es JOIN institutions i ON i.id = es.institution_id
      WHERE i.code = ? AND es.exam_date = ? AND es.session = ?
    `).get(result.preview.institution, result.preview.date, result.preview.session);
    if (existing && !replacement) {
      return NextResponse.json({ error: 'This published session already exists. Set replace=true after explicit confirmation.' }, { status: 409, headers: { 'X-Replacement-Conflict': 'true' } });
    }

    const batchId = crypto.createHash('sha256').update(JSON.stringify(result.preview)).digest('hex').slice(0, 16);
    for (const row of result.rows) {
      const image = result.imageMap.get(filenameKey(row.imageFilename));
      const finalKey = `published/${result.preview.institution}/${result.preview.date}/${result.preview.session}/${row.roomNumber}-${image.sha256}${image.extension}`;
      const stagedKey = `staging/${batchId}/${row.roomNumber}-${image.sha256}${image.extension}`;
      stagedKeys.add(stagedKey);
      await uploadBlob(stagedKey, image.bytes, image.contentType);
      const stagedDownload = await downloadBlob(stagedKey);
      if (!stagedDownload || !stagedDownload.bytes.equals(image.bytes)) throw new Error('Staged upload verification failed.');
      await uploadBlob(finalKey, image.bytes, image.contentType);
      if (!db.prepare('SELECT id FROM images WHERE blob_key = ?').get(finalKey)) finalKeys.add(finalKey);
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      let institution = db.prepare('SELECT * FROM institutions WHERE code = ?').get(result.preview.institution);
      if (!institution) {
        const inserted = db.prepare('INSERT INTO institutions (code, name) VALUES (?, ?)').run(result.preview.institution, result.preview.institution);
        institution = db.prepare('SELECT * FROM institutions WHERE id = ?').get(inserted.lastInsertRowid);
      }
      let session = db.prepare(`
        SELECT * FROM exam_sessions WHERE institution_id = ? AND exam_date = ? AND session = ?
      `).get(institution.id, result.preview.date, result.preview.session);
      if (!session) {
        const inserted = db.prepare(`
          INSERT INTO exam_sessions (institution_id, exam_date, session, publication_state, published_at)
          VALUES (?, ?, ?, 'published', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        `).run(institution.id, result.preview.date, result.preview.session);
        session = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(inserted.lastInsertRowid);
      } else {
        db.prepare(`UPDATE exam_sessions SET publication_state='published', published_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(session.id);
        db.prepare('DELETE FROM rooms WHERE session_id = ?').run(session.id);
      }

      for (const row of result.rows) {
        const image = result.imageMap.get(filenameKey(row.imageFilename));
        const finalKey = `published/${result.preview.institution}/${result.preview.date}/${result.preview.session}/${row.roomNumber}-${image.sha256}${image.extension}`;
        let imageRow = db.prepare('SELECT * FROM images WHERE blob_key = ?').get(finalKey);
        if (!imageRow) {
          const inserted = db.prepare(`
            INSERT INTO images (blob_key, original_filename, content_type, size_bytes, sha256)
            VALUES (?, ?, ?, ?, ?)
          `).run(finalKey, row.imageFilename, image.contentType, image.sizeBytes, image.sha256);
          imageRow = db.prepare('SELECT * FROM images WHERE id = ?').get(inserted.lastInsertRowid);
        }
        db.prepare(`
          INSERT INTO rooms (session_id, room_number, room_label, image_id)
          VALUES (?, ?, ?, ?)
        `).run(session.id, row.roomNumber, row.roomLabel, imageRow.id);
      }
      db.prepare(`
        INSERT INTO audit_events (event_type, actor, institution_code, exam_date, session, details)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(existing ? 'batch_replaced' : 'batch_published', authorization.user.email, result.preview.institution, result.preview.date, result.preview.session, JSON.stringify({ roomCount: result.rows.length, replace: Boolean(existing) }));
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }

    await Promise.all([...stagedKeys].map((key) => deleteBlob(key).catch(() => null)));
    return NextResponse.json({ published: true, replacement: Boolean(existing), preview: result.preview, roomsPublished: result.rows.length });
  } catch (error) {
    await Promise.all([...stagedKeys, ...finalKeys].map((key) => deleteBlob(key).catch(() => null)));
    console.error('Batch publish failed:', error?.code || error?.name || 'UnknownError');
    return NextResponse.json({ error: 'Batch publish failed. The previous published session was not changed.' }, { status: 503 });
  } finally {
    closeDatabase(db);
  }
}
