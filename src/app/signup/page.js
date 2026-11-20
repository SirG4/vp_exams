'use client';

import { useState } from 'react';

export default function SignupPage() {
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Signup failed.');
      setSubmitted(true);
      setMessage(result.message);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="auth-kicker">EXAM SEATING PORTAL</p>
        <h1>Request admin access</h1>
        {submitted ? (
          <div className="auth-confirmation" role="status">{message}<a href="/login">Return to sign in</a></div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
            <label>Password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
            <p className="auth-hint">Use at least 12 characters. Access begins after super-admin approval.</p>
            {message && <p className="auth-message" role="alert">{message}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Request access'}</button>
          </form>
        )}
        {!submitted && <p className="auth-footer"><a href="/login">Back to sign in</a></p>}
      </section>
    </main>
  );
}