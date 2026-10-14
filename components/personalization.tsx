"use client";
import { useEffect, useState } from 'react';
import { products, money, type Product } from '@/lib/rydegrub';
const preferences = ['Vegetarian', 'High-protein', 'Mild spice'];
type Settings = { granted: boolean; preferences: string[] };
type Picks = { mode: string; explanation: string; items: { id: string; reasons: string[] }[] };
const general: Picks = { mode: 'general', explanation: 'General menu suggestions. Personal preferences were not used.',
  items: products.filter(p => p.category !== 'Toddler Food').slice(0,3).map(p => ({ id: p.id, reasons: ['Selected from the menu'] })) };

export function MealSuggestions({ onOpen }: { onOpen: (p: Product) => void }) {
  const [result, setResult] = useState<Picks>(general);
  useEffect(() => {
    let controller: AbortController;
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      controller?.abort(); clearTimeout(timer);
      setResult(general);
      controller = new AbortController();
      const current = controller;
      timer = setTimeout(() => current.abort(), 5000);
      void fetch('/api/profile/recommendations', { cache: 'no-store', signal: current.signal })
        .then(async response => {
          if (!response.ok) return;
          const body = await response.json();
          if (!current.signal.aborted && ['general','personalized'].includes(body.mode) && Array.isArray(body.items)) setResult(body);
        }).catch(() => { /* General suggestions remain available without an account or service. */ })
        .finally(() => { if (current === controller) clearTimeout(timer); });
    }
    function visibility() { if (document.hidden) { controller?.abort(); setResult(general); } else refresh(); }
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('ryde-personalization-changed', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => { controller?.abort(); clearTimeout(timer); window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh); window.removeEventListener('ryde-personalization-changed', refresh);
      document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return <section className="personalized" aria-label="Meal suggestions">
    <div className="personalized-copy">
      <div className="eyebrow cyan">MEAL SUGGESTIONS</div>
      <h2>Your kind of meal.</h2>
      <p role="status">{result.explanation}</p>
      <p>Manage personalization and reset your preferences in Profile.</p>
      <p className="muted small">Menu and nutrition are sample data. Suggestions do not verify availability or allergy safety.</p>
    </div>
    <div className="personalized-picks">
      {result.items.map(item => {
        const p = products.find(product => product.id === item.id);
        return p ? <button key={p.id} onClick={() => onOpen(p)} className="mini-food">
          <img src={p.image} alt="" /><div><h3>{p.name}</h3><p>{money(p.price)}</p>
            <p>{item.reasons.join(' · ')}</p></div>
        </button> : null;
      })}
      {result.items.length === 0 && <p>No menu items match all your saved preferences. Review your preferences in Profile.</p>}
    </div>
  </section>;
}

export function PersonalizationSettings() {
  const [settings, setSettings] = useState<Settings>({ granted: false, preferences: [] });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Loading personalization settings…');
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    void fetch('/api/profile/personalization', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (!controller.signal.aborted) { setSettings(body.settings); setReady(true); setMessage(''); }
    }).catch(() => { setMessage('Sign in with a verified account to manage personalization.'); }).finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  async function save(reset: boolean) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/profile/personalization', { method: reset ? 'DELETE' : 'PATCH',
        headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
        body: JSON.stringify(reset ? {} : { granted: settings.granted, preferences: settings.granted ? settings.preferences : [] }) });
      if (!response.ok) throw new Error();
      setSettings((await response.json()).settings);
      setMessage(reset || !settings.granted ? 'Personalization is off. Saved food preferences were cleared.' : 'Personalization settings saved.');
      window.dispatchEvent(new Event('ryde-personalization-changed'));
    } catch { setMessage('Could not confirm your settings. Reload Profile to check the saved choice before retrying.'); }
    finally { setBusy(false); }
  }
  return <section className="panel" aria-label="Personalization controls">
    <h2>Meal personalization</h2>
    <p>With your permission, RydeGrub uses only your selected food preferences to suggest meals. It does not use journey, contact or browsing data. No preferences are sent to an AI provider.</p>
    <form onSubmit={event => { event.preventDefault(); void save(false); }}>
      <fieldset disabled={!ready || busy} className="preferences">
        <legend>Your choice</legend>
        <label><input type="checkbox" checked={settings.granted} onChange={event => setSettings(s => ({ ...s, granted: event.target.checked }))} />Allow personalized meal suggestions</label>
        {preferences.map(p => <label key={p}><input type="checkbox" disabled={!settings.granted} checked={settings.preferences.includes(p)}
          onChange={event => setSettings(s => ({ ...s, preferences: event.target.checked ? [...s.preferences,p] : s.preferences.filter(v => v !== p) }))} />{p}</label>)}
      </fieldset>
      <button type="submit" className="primary" disabled={!ready || busy}>Save choice</button>
      <button type="button" className="secondary" disabled={!ready || busy} onClick={() => void save(true)}>Turn off and reset preferences</button>
    </form>
    {message && <p role="status">{message}</p>}
  </section>;
}
