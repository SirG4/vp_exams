import { NextResponse } from 'next/server';
import { closeDatabase, openDatabase } from '@/lib/database';
import { downloadBlob } from '@/lib/azure-storage';

export const dynamic = 'force-dynamic';

export async function GET(_request, context) {
  const { imageId } = await context.params;
  const db = openDatabase();
  try {
    const image = db.prepare(`
      SELECT i.blob_key, i.content_type
      FROM images i
      JOIN rooms r ON r.image_id = i.id
      JOIN exam_sessions es ON es.id = r.session_id
      WHERE i.id = ? AND es.publication_state = 'published'
      LIMIT 1
    `).get(Number(imageId));

    if (!image?.blob_key) {
      return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
    }

    const downloaded = await downloadBlob(image.blob_key);
    if (!downloaded) {
      return NextResponse.json({ error: 'Image is unavailable.' }, { status: 404 });
    }

    return new NextResponse(downloaded.bytes, {
      status: 200,
      headers: {
        'Content-Type': downloaded.contentType || image.content_type || 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        ...(downloaded.etag ? { ETag: downloaded.etag } : {}),
      },
    });
  } catch (error) {
    console.error('Blob image read failed:', error?.code || error?.name || 'UnknownError');
    return NextResponse.json({ error: 'Image storage is temporarily unavailable.' }, { status: 503 });
  } finally {
    closeDatabase(db);
  }
}
