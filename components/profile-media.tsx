"use client";
import { useEffect, useState } from 'react';
type Photo = { id: string; thumbnail: string; display: string };
export function ProfileMedia() {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [message, setMessage] = useState('Loading profile photo…');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/media', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) { setMessage(body.error); return; }
      setPhoto(body.media); setEnabled(true); setMessage('');
    }).catch(() => { if (!controller.signal.aborted) setMessage('Profile photos are temporarily unavailable.'); });
    return () => controller.abort();
  }, []);
  async function change(file?: File) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(file ? '/api/media' : `/api/media/${photo?.id}`, file
        ? { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } }
        : { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).error);
      setPhoto(file ? (await response.json()).media : null);
      setMessage(file ? 'Profile photo saved.' : 'Profile photo removed.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Changes failed. Try again.'); }
    finally { setBusy(false); }
  }
  return <section className="panel" aria-label="Profile photo">
    <h2>Profile photo</h2>
    {photo && <img src={photo.thumbnail} width={96} height={96} alt="Your uploaded portrait" />}
    <p className="muted small">Private photo · JPEG, PNG or WebP · up to 5 MiB · still images, 64–4096 pixels per side. Photos expire after 30 days.</p>
    <label className="form-field">
      <span>{busy ? 'Saving changes…' : photo ? 'Replace photo' : 'Choose photo'}</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!enabled || busy}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void change(file); }} />
    </label>
    {photo && <button type="button" className="secondary" disabled={busy} onClick={() => void change()}>Remove photo</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}

