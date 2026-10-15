"use client";
import { useEffect, useState } from 'react';
import type { PageName } from './ryde-app';

type Navigate = (page: PageName, id?: string) => void;
type Snapshot = { id: string; stage: string; station: string; eta: number | null; updatedAt: number; version: number; events?: { version: number; stage: string; station: string; eta: number | null; recordedAt: number; source: 'operations' | 'migration' }[]; hasEarlierEvents?: boolean };
const labels: Record<string, string> = {
  confirmed: 'Confirmed', preparing: 'Preparing', packed: 'Packed',
  arriving: 'Arriving', delivered: 'Delivered', cancelled: 'Cancelled',
};
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);

export function SecureOrders({ navigate }: { navigate: Navigate }) {
  const [orders, setOrders] = useState<Snapshot[]>([]);
  const [message, setMessage] = useState('Loading your orders…');
  const [id, setId] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      void fetch('/api/orders/tracking', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (!controller.signal.aborted) {
          setOrders(body.orders); setMessage(body.orders.length ? '' : 'No active orders on this account.');
          timer = setTimeout(refresh, 30000);
        }
      }).catch(() => {
        if (!controller.signal.aborted) {
          setOrders([]);
          setMessage('Sign in with a verified account to view your orders, or use an order ID and tracking code.');
        }
      });
    }
    refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  return <section className="panel" aria-label="Real order tracking">
    <h2>Track your order</h2>
    {message && <p role="status">{message}</p>}
    {orders.map(order => <p key={order.id}>
      <button type="button" className="text-link" onClick={() => navigate('tracking', order.id)}>
        {labels[order.stage] || order.stage} · {order.station}
      </button>
    </p>)}
    <form onSubmit={event => { event.preventDefault(); if (validId(id.trim())) navigate('tracking', id.trim()); }}>
      <label className="form-field">
        <span>Order ID from your confirmation</span>
        <input value={id} maxLength={36} autoComplete="off" onChange={event => setId(event.target.value)} required />
      </label>
      <button type="submit" className="secondary" disabled={!validId(id.trim())}>Open tracking</button>
    </form>
  </section>;
}

export function TrackingPage({ id, navigate }: { id: string; navigate: Navigate }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isOwner, setOwner] = useState(false);
  const [message, setMessage] = useState('Checking tracking access…');
  const [entry, setEntry] = useState('');
  const [code, setCode] = useState<{ token: string } | null>(null);
  const [issued, setIssued] = useState<{ token: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      if (!validId(id)) { setMessage('Tracking is unavailable.'); return; }
      try {
        const response = await fetch(`/api/orders/${id}/tracking`, {
          cache: 'no-store', signal: controller.signal,
          ...(code ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(code) } : {}),
        });
        if (!response.ok) throw new Error('Tracking is unavailable. Sign in as the owner or ask for a new tracking code.');
        const body = await response.json();
        if (controller.signal.aborted) return;
        setSnapshot(body.tracking); setOwner(body.access === 'owner'); setMessage('');
        timer = setTimeout(() => { void refresh(); }, 30000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSnapshot(null); setOwner(false); setIssued(null);
        setMessage(error instanceof Error ? error.message : 'Tracking is unavailable.');
      }
    }
    // A changed order or credential must not display the previously authorized data.
    setSnapshot(null); setOwner(false); setIssued(null);
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, code]);
  useEffect(() => {
    if (!issued) return;
    const timer = setTimeout(() => setIssued(null), Math.max(0, issued.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [issued]);
  async function manageCode(revoke: boolean) {
    setBusy(true); setIssued(null);
    try {
      const response = await fetch(`/api/orders/${id}/tracking-access`, { method: revoke ? 'DELETE' : 'POST' });
      if (!response.ok) throw new Error('Could not change tracking access. Try again after signing in.');
      if (!revoke) setIssued(await response.json());
      setMessage(revoke ? 'Tracking code revoked.' : 'New code created. Previous code is now invalid.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not change tracking access.'); }
    finally { setBusy(false); }
  }
  return <section className="page-section">
    <h1>Order tracking</h1>
    <p>Live fulfilment updates for your order.</p>
    {message && <p role="status">{message}</p>}
    {snapshot && <section className="panel" aria-label="Fulfilment status">
      <h2>{labels[snapshot.stage] || snapshot.stage}</h2>
      <p>Delivery station: {snapshot.station}</p>
      <p>{['delivered', 'cancelled'].includes(snapshot.stage) ? 'This delivery is complete or cancelled.' : snapshot.eta ? `Estimated arrival: ${new Date(snapshot.eta).toLocaleString()}` : 'Arrival estimate pending'}</p>
      <p className="muted small">Updated {new Date(snapshot.updatedAt).toLocaleString()}</p>
      <h3>Status history</h3>
      {snapshot.hasEarlierEvents && <p>Showing the latest 100 updates.</p>}
      <ol aria-label="Recorded fulfilment events">
        {snapshot.events?.map(event => <li key={event.version}>
          <strong>{labels[event.stage] || event.stage}</strong> · {event.station}
          <p><time dateTime={new Date(event.recordedAt).toISOString()}>{new Date(event.recordedAt).toLocaleString()}</time>
            {event.source === 'migration' && ' · Previously recorded status; earlier history unavailable'}</p>
        </li>)}
      </ol>
      <p className="muted small">Progress changes only when operations records an update. Arrival times are estimates.</p>
    </section>}
    {!isOwner && <form className="panel" onSubmit={event => {
      event.preventDefault(); setCode({ token: entry.trim() }); setEntry('');
    }}>
      <label className="form-field">
        <span>Tracking code shared by the order owner</span>
        <input type="password" value={entry} autoComplete="off" maxLength={43} minLength={43} required
          onChange={event => setEntry(event.target.value)} />
      </label>
      <button type="submit" className="primary">View tracking</button>
      <p className="muted small">Codes expire within 15 minutes. Keep the code private.</p>
    </form>}
    {isOwner && <section className="panel" aria-label="Manage tracking access">
      <h2>Share limited tracking access</h2>
      <p>Share the order ID and a temporary code with someone you trust. The code shows only delivery progress.</p>
      <p>Order ID: {id}</p>
      <button type="button" className="secondary" disabled={busy} onClick={() => void manageCode(false)}>Create 15-minute code</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => void manageCode(true)}>Revoke tracking code</button>
      {issued && <><label className="form-field">
        <span>Code — copy and share privately; expires {new Date(issued.expiresAt).toLocaleTimeString()}</span>
        <input readOnly type="password" autoComplete="off" value={issued.token} onFocus={event => event.target.select()} />
      </label>
      <button type="button" className="secondary" onClick={() => {
        void navigator.clipboard.writeText(issued.token)
          .then(() => setMessage('Code copied. Share it privately.'))
          .catch(() => setMessage('Select the code field and copy it manually.'));
      }}>Copy tracking code</button></>}
    </section>}
    <button type="button" className="text-link" onClick={() => navigate('orders')}>Back to orders</button>
  </section>;
}

