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


// ─── Digital Clock ──────────────────────────────────────────────────────────

function DigitalClock() {
  const { ready, getServerNow } = useServerTime();
  const [time, setTime] = useState(null);

  useEffect(() => {
    const update = () => {
      if (!ready) return;
      const now = new Date(getServerNow());
      
      // Explicitly format for IST (Asia/Kolkata)
      const options = {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      };
      
      const timeStr = now.toLocaleTimeString('en-IN', options);
      const dateStr = now.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      
      setTime({ time: timeStr, date: dateStr });
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [ready, getServerNow]);

  if (!time) return (
    <div className="flex flex-col items-center justify-center h-full text-gray-300">
      <div className="w-12 h-12 border-4 border-gray-100 border-t-black rounded-full animate-spin mb-4" />
      <p className="text-sm font-medium animate-pulse">Syncing with server...</p>
    </div>
  );

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="relative">
        {/* Glow effect */}
        <div className="absolute inset-0 blur-3xl bg-black/5 rounded-full scale-150" />
        
        <div className="relative">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em] mb-4">Current Time (IST)</p>
          <div className="text-[7rem] font-bold text-black leading-none tracking-tighter tabular-nums mb-2">
            {time.time.split(' ')[0]}
            <span className="text-4xl ml-2 text-gray-400 uppercase">{time.time.split(' ')[1]}</span>
          </div>
          <div className="h-px w-24 bg-gray-100 mx-auto mb-6" />
          <p className="text-xl font-medium text-gray-500">{time.date}</p>
        </div>
      </div>
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
              key={`${exam.date}-${exam.session}`}
              id={`date-${exam.date}-${exam.session}`}
              onClick={() => onSelect(exam)}
              className="group relative p-7 rounded-2xl border border-gray-200 bg-white hover:border-black hover:shadow-lg transition-all duration-200 text-left overflow-hidden"
            >
              <div className="relative z-10">
                <p className="text-gray-400 text-sm font-semibold mb-1">{DAYS_S[d.getDay()]}</p>
                <p className="text-5xl font-bold text-black mb-1 leading-none">{d.getDate()}</p>
                <p className="text-gray-500 text-sm mb-5">{MONTHS[d.getMonth()]} {d.getFullYear()}</p>
                <p className="text-xs text-gray-400 border-t border-gray-100 pt-3 group-hover:border-gray-300 transition-colors">
                  {exam.rooms.length} room{exam.rooms.length !== 1 ? 's' : ''} {exam.session ? `· ${exam.session}` : ''}
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
        <p className="text-gray-500">Choose a room to view its seating layout</p>
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

        {/* LEFT — Seating Plan Image */}
        <section className="w-1/2 flex flex-col border-r border-gray-200 overflow-hidden bg-gray-50/50">
          <div className="px-6 pt-5 pb-3 shrink-0">
            <p className="text-gray-400 text-xs">{room.label} &nbsp;·&nbsp; Room {room.roomNumber}</p>
          </div>
          
          <div className="flex-1 p-6 min-h-0">
            <div className="w-full h-full rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex items-center justify-center relative group">
              {/* Constructing image path: /[day][month]/[roomNumber].jpg */}
              <img 
                src={`/${d.getDate()}${MONTHS[d.getMonth()].toLowerCase()}${exam.session ? '_' + exam.session : ''}/${room.roomNumber}.jpg`}
                alt={`Seating plan for Room ${room.roomNumber}`}
                className="max-w-full max-h-full object-contain p-2 transition-transform duration-500 group-hover:scale-[1.02]"
                onError={(e) => {
                  // Fallback if image is missing
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              
              {/* Fallback UI when image fails to load */}
              <div className="hidden absolute inset-0 flex-col items-center justify-center text-gray-400 bg-gray-50 p-8 text-center">
                <svg className="w-12 h-12 mb-3 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-sm font-medium">Plan image not found</p>
                <p className="text-xs mt-1">Expected path: /{d.getDate()}{MONTHS[d.getMonth()].toLowerCase()}{exam.session ? '_' + exam.session : ''}/{room.roomNumber}.jpg</p>
              </div>

              {/* Subtle overlay border */}
              <div className="absolute inset-0 pointer-events-none border border-black/5 rounded-2xl" />
            </div>
          </div>
        </section>

        {/* RIGHT — Digital Clock */}
        <section className="w-1/2 flex flex-col overflow-hidden bg-white">
          <DigitalClock />
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
