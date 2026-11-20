'use client';

import { useEffect, useState } from 'react';

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [batchErrors, setBatchErrors] = useState([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchFiles, setBatchFiles] = useState(null);

  async function loadUsers() {
    const response = await fetch('/api/admin/users');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load accounts.');
    setUsers(result.users);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch('/api/auth/session');
        const result = await response.json();
        if (!response.ok || !result.user) {
          window.location.assign('/login');
          return;
        }
        if (!active) return;
        setUser(result.user);
        if (result.user.role === 'super_admin') await loadUsers();
      } catch (error) {
        if (active) setMessage(error.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  async function updateUser(account, changes) {
    setMessage('');
    const response = await fetch(`/api/admin/users/${account.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Account update failed.');
    await loadUsers();
  }

  async function removeUser(account) {
    if (!window.confirm(`Delete the account for ${account.email}?`)) return;
    const response = await fetch(`/api/admin/users/${account.id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Account deletion failed.');
    await loadUsers();
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }

  async function runAction(action) {
    try {
      await action();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function validateBatch(event) {
    event.preventDefault();
    setBatchBusy(true); setPreview(null); setBatchErrors([]); setMessage('');
    try {
      const formData = new FormData(event.currentTarget);
      const manifest = formData.get('manifest');
      const images = formData.getAll('images').filter((file) => file instanceof File);
      setBatchFiles({ manifest, images });
      const response = await fetch('/api/admin/batches/validate', { method: 'POST', body: formData });
      const result = await response.json();
      if (!response.ok) { setBatchErrors(result.errors || [{ reason: result.error }]); return; }
      setPreview(result.preview);
    } finally { setBatchBusy(false); }
  }

  async function publishBatch(event) {
    event.preventDefault();
    setBatchBusy(true); setMessage('');
    try {
      if (!batchFiles?.manifest || !batchFiles.images?.length) {
        setBatchErrors([{ reason: 'Validate and select the Excel manifest and room images again.' }]);
        return;
      }
      const formData = new FormData();
      formData.set('manifest', batchFiles.manifest);
      for (const image of batchFiles.images) formData.append('images', image);
      formData.set('replace', 'false');
      let response = await fetch('/api/admin/batches/publish', { method: 'POST', body: formData });
      let result = await response.json();
      if (response.status === 409) {
        if (!window.confirm('A published batch already exists for this institution/date/session. Replace the complete room set?')) return;
        formData.set('replace', 'true');
        response = await fetch('/api/admin/batches/publish', { method: 'POST', body: formData });
        result = await response.json();
      }
      if (!response.ok) { setBatchErrors(result.errors || [{ reason: result.error }]); return; }
      setPreview(null); setBatchErrors([]); setMessage(`Published ${result.roomsPublished} rooms.`);
    } finally { setBatchBusy(false); }
  }

  if (loading) return <main className="admin-page"><p className="admin-loading">Loading account…</p></main>;

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div><p className="auth-kicker">EXAM SEATING PORTAL</p><h1>Administration</h1></div>
        <div className="admin-identity"><span>{user?.email}</span><button className="button-secondary" onClick={signOut}>Sign out</button></div>
      </header>
      {message && <p className="auth-message" role="alert">{message}</p>}
      {user?.role === 'super_admin' ? (
        <>
        <section className="account-section">
          <div className="section-heading"><div><h2>Admin accounts</h2><p>Review access requests and manage administrator roles.</p></div><button className="button-secondary" onClick={() => runAction(loadUsers)}>Refresh</button></div>
          {users.length === 0 ? <p className="empty-state">No accounts yet.</p> : (
            <div className="account-list">
              {users.map((account) => (
                <article className="account-row" key={account.id}>
                  <div className="account-details"><strong>{account.email}</strong><span>{account.status.replace('_', ' ')} · {account.role.replace('_', ' ')}</span></div>
                  <div className="account-actions">
                    {account.status === 'pending' && <button onClick={() => runAction(() => updateUser(account, { status: 'approved' }))}>Approve</button>}
                    {account.status === 'approved' && account.id !== user.id && <button className="button-secondary" onClick={() => runAction(() => updateUser(account, { status: 'disabled' }))}>Disable</button>}
                    {account.status === 'disabled' && <button onClick={() => runAction(() => updateUser(account, { status: 'approved' }))}>Re-enable</button>}
                    {account.status !== 'pending' && <select aria-label={`Role for ${account.email}`} value={account.role} onChange={(event) => runAction(() => updateUser(account, { role: event.target.value }))}>
                      <option value="admin">Admin</option><option value="super_admin">Super admin</option>
                    </select>}
                    {account.id !== user.id && <button className="button-danger" onClick={() => runAction(() => removeUser(account))}>Delete</button>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="batch-section">
          <div className="section-heading"><div><h2>Exam batch</h2><p>Validate one Excel manifest and its JPEG/PNG images.</p></div></div>
          <form className="batch-form" onSubmit={validateBatch}>
            <label>Excel manifest<input name="manifest" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></label>
            <label>Room images<input name="images" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" multiple required /></label>
            <div className="batch-actions"><a className="button-secondary" href="/templates/exam-batch-template.xlsx" download>Download template</a><button type="submit" disabled={batchBusy}>{batchBusy ? 'Validating…' : 'Validate batch'}</button></div>
          </form>
          {batchErrors.length > 0 && <div className="batch-errors" role="alert">{batchErrors.map((error, index) => <p key={index}>{error.reason || 'Unknown validation error.'}</p>)}</div>}
          {preview && <form className="batch-preview" onSubmit={publishBatch}><h3>Validation preview</h3><p><strong>{preview.institution}</strong> · {preview.date} · {preview.session} · {preview.rooms.length} rooms</p><div className="batch-room-list">{preview.rooms.map((room) => <span key={room.roomNumber}>{room.roomNumber} — {room.roomLabel}</span>)}</div><button type="submit" disabled={batchBusy}>{batchBusy ? 'Publishing…' : 'Publish batch'}</button></form>}
        </section>
        </>
      ) : (
        <section className="account-section"><h2>Signed in</h2><p>Your approved admin account is active.</p></section>
      )}
    </main>
  );
}