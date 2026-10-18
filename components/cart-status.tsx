"use client";
import { useRyde } from './ryde-store';
import { money } from '@/lib/rydegrub';
export function CartStatus() {
  const { serverCart, mergeGuest, reloadCart } = useRyde();
  if (serverCart.mode === 'demo') return <p role="status">Sample cart for this visit. No payment or delivery.</p>;
  return <aside className="panel" aria-label="Cart status" aria-busy={serverCart.busy}>
    <p role="status">{serverCart.busy ? 'Loading or saving your cart…' : serverCart.mode === 'account' ? 'Your cart is saved to your account.' : serverCart.mode === 'guest' ? 'Guest cart saved for up to 24 hours. Sign in to keep it with your account.' : 'Cart is unavailable.'}</p>
    {serverCart.error && <p role="alert">{serverCart.error}</p>}
    <button type="button" className="text-link" disabled={serverCart.busy} onClick={reloadCart}>Reload cart</button>
    {serverCart.mode === 'account' && !!serverCart.guest?.items.length && <div>
      <h3>Review your guest cart</h3>
      <p>Choose whether to combine these items with your account cart or replace it. Prices and availability are checked again.</p>
      <ul>{serverCart.guest.items.map(line => <li key={line.sku}>{line.quantity} × {line.name} — {money(line.unitPaise / 100)} each</li>)}</ul>
      <button type="button" className="secondary" disabled={serverCart.busy} onClick={() => mergeGuest('combine')}>Combine carts</button>{' '}
      <button type="button" className="secondary" disabled={serverCart.busy} onClick={() => mergeGuest('replace')}>Replace account cart</button>
    </div>}
  </aside>;
}
