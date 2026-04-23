'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import examData from '@/data/exams.json';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseTimeToday(timeStr, baseMs) {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(baseMs);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function formatDuration(secs) {
  if (secs <= 0) return '00:00:00';
  const h = Math.floor(secs / 3600);
  const mm = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, mm, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function formatDisplay(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_S = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const INSTRUCTIONS = [
  'Keep your hall ticket on the desk at all times.',
  'Electronic devices are strictly prohibited inside the exam hall.',
  'No communication between students is permitted during the exam.',
  'Answer all questions in the provided answer booklet only.',
  'Use only blue or black ballpoint pen. No pencil except for diagrams.',
  'Late entry will not be allowed after 15 minutes from start.',
  'Do not leave the hall without submitting your answer script.',
  'Rough work must be done only in the answer booklet and crossed out.',
  'Ensure your roll number is written on every answer sheet.',
  'The invigilator\'s decision is final in all matters.',
];

// ─── Server-Time Hook ────────────────────────────────────────────────────────
// Fetches one timestamp from the server, calculates the offset vs local clock,
// and returns a function that gives the current server time — no internet needed,
// just the machine running `npm run dev`.

function useServerTime() {
  const offsetRef = useRef(0);       // serverTime = Date.now() + offset
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t0 = Date.now();
    fetch('/api/server-time')
      .then((r) => r.json())
      .then(({ now }) => {
        const t1 = Date.now();
        const roundTrip = t1 - t0;
        // Estimate server time at the midpoint of the request
        offsetRef.current = now + roundTrip / 2 - t1;
        setReady(true);
      })
      .catch(() => {
        // Fallback: use local clock (offset stays 0)
        setReady(true);
      });
  }, []);

  const getServerNow = useCallback(() => Date.now() + offsetRef.current, []);
  return { ready, getServerNow };
}

// ─── Timer (slim bar) ────────────────────────────────────────────────────────

function Timer({ startTime, endTime }) {
  const { ready, getServerNow } = useServerTime();
  const [status, setStatus]       = useState('loading');
  const [secondsLeft, setSecsLeft] = useState(0);
  const [progress, setProgress]   = useState(0);

  const tick = useCallback(() => {
    if (!ready) return;
    const now   = getServerNow();
    const start = parseTimeToday(startTime, now);
    const end   = parseTimeToday(endTime, now);
    const total = (end - start) / 1000;

    if (now < start) {
      setStatus('upcoming');
      setSecsLeft(Math.floor((start - now) / 1000));
      setProgress(0);
    } else if (now < end) {
      const elapsed = Math.floor((now - start) / 1000);
      setStatus('active');
      setSecsLeft(Math.floor((end - now) / 1000));
      setProgress(Math.min(elapsed / total, 1));
    } else {
      setStatus('ended');
      setSecsLeft(0);
      setProgress(1);
    }
  }, [ready, getServerNow, startTime, endTime]);

  useEffect(() => {
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tick]);

  const statusCfg = {
    upcoming: { label: 'Upcoming',    color: '#6366f1', bg: '#eef2ff' },
    active:   { label: 'In Progress', color: '#000000', bg: '#f0f0f0' },
    ended:    { label: 'Exam Ended',  color: '#ff0000', bg: '#f9fafb' },
    loading:  { label: 'Loading…',   color: '#d1d5db', bg: '#f9fafb' },
  }[status];

  return (
    <div className="w-full">
      {/* Status row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: statusCfg.color }}
          />
          <span className="text-xs font-semibold" style={{ color: statusCfg.color }}>
            {statusCfg.label}
          </span>
        </div>
        <span className="text-xs font-mono text-gray-500">
          {status === 'ended' ? '00:00:00' : formatDuration(secondsLeft)}
        </span>
      </div>

      {/* Thin progress bar */}
      <div className="h-3 rounded-full overflow-hidden" style={{ background: statusCfg.bg }}>
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${progress * 100}%`, background: statusCfg.color }}
        />
      </div>

      {/* Start / End labels */}
      <div className="flex justify-between mt-1.5 text-xs text-gray-400">
        <span>{formatDisplay(startTime)}</span>
        <span className="font-medium text-gray-500">
          {Math.round(progress * 100)}% elapsed
        </span>
        <span>{formatDisplay(endTime)}</span>
      </div>
    </div>
  );
}

// ─── Roll Grid (no scroll – fits within panel) ───────────────────────────────

function RollGrid({ rollNumbers }) {
  const cols = 5;
  const rows = Math.min(12, Math.ceil(rollNumbers.length / cols));

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gap: '0.4rem',
        height: '100%',
      }}
    >
      {rollNumbers.slice(0, cols * rows).map((roll, i) => (
        <div
          key={roll}
          className="flex flex-col items-center justify-center rounded-lg border border-gray-100 bg-white hover:border-black hover:bg-gray-50 transition-all duration-150 cursor-default"
        >
          <span className="text-xs text-gray-400 font-medium leading-none mb-1">#{i + 1}</span>
          <span className="text-lg font-bold text-black font-mono tracking-tight">{roll}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Date Selector ───────────────────────────────────────────────────────────

function DateSelector({ onSelect }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16 bg-white">
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black text-white text-sm font-medium mb-6">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          Exam Portal
        </div>
        <h1 className="text-5xl font-bold text-black mb-3 tracking-tight">Select Exam Date</h1>
        <p className="text-gray-500 text-lg">Choose a date to view the seating arrangement</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-3xl w-full">
        {examData.exams.map((exam) => {
          const d = new Date(exam.date + 'T00:00:00');
          return (
            <button
              key={exam.date}
              id={`date-${exam.date}`}
              onClick={() => onSelect(exam)}
              className="group relative p-7 rounded-2xl border border-gray-200 bg-white hover:border-black hover:shadow-lg transition-all duration-200 text-left overflow-hidden"
            >
              <div className="relative z-10">
                <p className="text-gray-400 text-sm font-semibold mb-1">{DAYS_S[d.getDay()]}</p>
                <p className="text-5xl font-bold text-black mb-1 leading-none">{d.getDate()}</p>
                <p className="text-gray-500 text-sm mb-5">{MONTHS[d.getMonth()]} {d.getFullYear()}</p>
                <p className="text-xs text-gray-400 border-t border-gray-100 pt-3 group-hover:border-gray-300 transition-colors">
                  {exam.rooms.length} room{exam.rooms.length !== 1 ? 's' : ''} assigned
                </p>
              </div>
              <div className="absolute bottom-5 right-5 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
                <svg className="w-5 h-5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Room Selector ───────────────────────────────────────────────────────────

function RoomSelector({ exam, onSelect, onBack }) {
  const d = new Date(exam.date + 'T00:00:00');
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16 bg-white">
      <div className="w-full max-w-3xl mb-8">
        <BackButton onClick={onBack} label="Back to dates" />
      </div>

      <div className="text-center mb-12 w-full max-w-3xl">
        <p className="text-gray-400 text-sm font-semibold mb-2">
          {DAYS[d.getDay()]}, {MONTHS[d.getMonth()]} {d.getDate()}, {d.getFullYear()}
        </p>
        <h2 className="text-4xl font-bold text-black mb-3">Select Room Number</h2>
        <p className="text-gray-500">Choose a room to view its seating layout and timer</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 max-w-3xl w-full">
        {exam.rooms.map((room) => (
          <button
            key={room.roomNumber}
            id={`room-${room.roomNumber}`}
            onClick={() => onSelect(room)}
            className="group p-6 rounded-2xl border border-gray-200 bg-white hover:border-black hover:shadow-lg transition-all duration-200 text-center"
          >
            <p className="text-xs text-gray-400 uppercase tracking-widest mb-2">Room</p>
            <p className="text-4xl font-bold text-black mb-3">{room.roomNumber}</p>
            <p className="text-xs text-gray-400">{room.rollNumbers.length} students</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Back Button ─────────────────────────────────────────────────────────────

function BackButton({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 text-gray-400 hover:text-black transition-colors group text-sm"
    >
      <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      {label}
    </button>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function Dashboard({ exam, room, onBack }) {
  const d = new Date(exam.date + 'T00:00:00');

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white">
      {/* Top bar */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-gray-200 bg-white shrink-0">
        <BackButton onClick={onBack} label="Change room" />
        <div className="text-center">
          <p className="text-black text-sm font-semibold">
            {DAYS[d.getDay()]}, {MONTHS[d.getMonth()]} {d.getDate()}, {d.getFullYear()}
          </p>
        </div>
        <div className="px-3 py-1 rounded-lg bg-black text-white text-sm font-bold">
          Room {room.roomNumber}
        </div>
      </header>

      {/* Split panes — no overflow so nothing scrolls */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT — Roll Numbers: fills entire height, grid scales to fit */}
        <section className="w-1/2 flex flex-col border-r border-gray-200 overflow-hidden">
          <div className="px-6 pt-5 pb-3 shrink-0">
            <p className="text-xs text-gray-400 uppercase tracking-widest mb-0.5">Seating Arrangement</p>
            <h2 className="text-xl font-bold text-black mb-0.5">Roll Numbers</h2>
            <p className="text-gray-400 text-xs">{room.label} &nbsp;·&nbsp; {room.rollNumbers.length} students</p>
          </div>
          {/* Roll grid stretches to fill all remaining space */}
          <div className="flex-1 px-6 pb-5 min-h-0">
            <RollGrid rollNumbers={room.rollNumbers} />
          </div>
        </section>

        {/* RIGHT — Timer bar + Instructions */}
        <section className="w-1/2 flex flex-col overflow-hidden">

          {/* Timer strip at top */}
          <div className="px-8 pt-6 pb-5 border-b border-gray-100 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-widest mb-0.5">Examination</p>
                <h2 className="text-xl font-bold text-black">Timing</h2>
              </div>
              <p className="text-xs text-gray-400">Server time sync</p>
            </div>
            <Timer startTime={examData.startTime} endTime={examData.endTime} />
          </div>

          {/* Instructions — main content area */}
          <div className="flex-1 px-8 pt-5 pb-6 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <h3 className="text-sm font-bold text-black uppercase tracking-widest">Exam Instructions</h3>
            </div>

            <ol className="flex-1 flex flex-col justify-between gap-0">
              {INSTRUCTIONS.map((inst, i) => (
                <li key={i} className="flex items-start gap-3 group">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 group-hover:bg-black text-gray-500 group-hover:text-white text-xs font-bold flex items-center justify-center transition-all duration-150 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-600 leading-snug">{inst}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Page() {
  const [step, setStep]                 = useState('date');
  const [selectedExam, setSelectedExam] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);

  return (
    <main>
      {step === 'date' && (
        <DateSelector
          onSelect={(exam) => { setSelectedExam(exam); setStep('room'); }}
        />
      )}
      {step === 'room' && selectedExam && (
        <RoomSelector
          exam={selectedExam}
          onSelect={(room) => { setSelectedRoom(room); setStep('dashboard'); }}
          onBack={() => setStep('date')}
        />
      )}
      {step === 'dashboard' && selectedExam && selectedRoom && (
        <Dashboard
          exam={selectedExam}
          room={selectedRoom}
          onBack={() => setStep('room')}
        />
      )}
    </main>
  );
}
