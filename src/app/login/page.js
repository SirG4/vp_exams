'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Sign-in failed.');
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.assign(next?.startsWith('/admin') ? next : '/admin');
    } catch (error) {
      setMessage(error.message);
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="auth-kicker">EXAM SEATING PORTAL</p>
        <h1>Admin sign in</h1>
        <form className="auth-form" onSubmit={submit}>
          <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
          {message && <p className="auth-message" role="alert">{message}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="auth-footer">Need an account? <a href="/signup">Request access</a></p>
      </section>
    </main>
  );
}