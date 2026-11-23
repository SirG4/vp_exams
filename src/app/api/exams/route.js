import { NextResponse } from 'next/server';
import { closeDatabase, migrateDatabase, openDatabase } from '@/lib/database';

export const dynamic = 'force-dynamic';

const PUBLIC_INSTITUTIONS = [
  { code: 'VIT', name: 'VIT' },
  { code: 'VP', name: 'VP' },
  { code: 'VSIT', name: 'VSIT' },
];

export async function GET() {
  const db = openDatabase();
  try {
    migrateDatabase(db);

    const institutions = PUBLIC_INSTITUTIONS.map(({ code, name }) => {
      const institution = db.prepare('SELECT id, code, name FROM institutions WHERE code = ?').get(code);
      if (!institution) return { code, name, startTime: null, endTime: null, exams: [] };

      const sessions = db.prepare(`
        SELECT id, exam_date, session, label, start_time, end_time
        FROM exam_sessions
        WHERE institution_id = ? AND publication_state = 'published'
        ORDER BY exam_date ASC, COALESCE(session, '') ASC
      `).all(institution.id);

      const exams = sessions.map((session) => {
        const rooms = db.prepare(`
          SELECT r.room_number, r.room_label, r.roll_numbers, i.id AS image_id
          FROM rooms r
          LEFT JOIN images i ON i.id = r.image_id
          WHERE r.session_id = ?
          ORDER BY r.room_number ASC
        `).all(session.id).map((room) => ({
          roomNumber: room.room_number,
          label: room.room_label,
          rollNumbers: (() => {
            try { return JSON.parse(room.roll_numbers || '[]'); } catch { return []; }
          })(),
          imageId: room.image_id ? Number(room.image_id) : null,
        }));

        return {
          date: session.exam_date,
          session: session.session,
          label: session.label,
          startTime: session.start_time,
          endTime: session.end_time,
          rooms,
        };
      });

      const startTime = sessions.find((session) => session.start_time)?.start_time ?? null;
      const endTime = sessions.find((session) => session.end_time)?.end_time ?? null;
      return { code, name: institution.name, startTime, endTime, exams };
    });

    return NextResponse.json(
      { institutions },
      { headers: { 'Cache-Control': 'private, max-age=30' } },
    );
  } catch (error) {
    console.error('Public exam data read failed:', error?.code || error?.name || 'UnknownError');
    return NextResponse.json({ error: 'Exam data is temporarily unavailable.' }, { status: 503 });
  } finally {
    closeDatabase(db);
  }
}
