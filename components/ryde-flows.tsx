"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CreditCard,
  Leaf,
  MapPin,
  Package,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  TrainFront,
  Trash2,
  UserRound,
  UtensilsCrossed,
} from "lucide-react";
import {
  journey,
  money,
  orderStatus,
  prepareReorder,
  statuses,
  totals,
  type Order,
} from "@/lib/rydegrub";
import { useRyde } from "./ryde-store";
import { EmptyState, FoodImage, Stepper } from "./food-components";
import type { PageName } from "./ryde-app";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProfileMedia } from "./profile-media";
import { SecureOrders } from "./secure-tracking";
type Navigate = (page: PageName, id?: string) => void;
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div className="eyebrow orange">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function Summary({
  subtotal,
  delivery,
  total,
  children,
}: {
  subtotal: number;
  delivery: number;
  total: number;
  children?: React.ReactNode;
}) {
  return (
    <aside className="summary panel">
      <h2>Your meal ticket</h2>
      <div className="summary-row">
        <span>Item subtotal</span>
        <span>{money(subtotal)}</span>
      </div>
      <div className="summary-row">
        <span>Seat delivery</span>
        <span className={delivery === 0 ? "cyan" : ""}>
          {delivery ? money(delivery) : "FREE"}
        </span>
      </div>
      <div className="summary-total">
        <span>Total</span>
        <strong>{money(total)}</strong>
      </div>
      {subtotal > 0 && subtotal < 399 && (
        <div className="free-delivery">
          <ShoppingBag size={17} />
          <span>Add {money(399 - subtotal)} more for free delivery.</span>
        </div>
      )}
      {subtotal >= 399 && (
        <div className="free-delivery">
          <CheckCircle2 size={17} />
          You unlocked free delivery.
        </div>
      )}
      {children}
      <p className="summary-note">
        <ShieldCheck size={13} /> No hidden fees. No extra taxes.
      </p>
    </aside>
  );
}
export function CartPage({ navigate }: { navigate: Navigate }) {
  const { state, quantity, products } = useRyde();
  const items = products.filter((p) => state.cart[p.id]);
  const t = totals(state.cart, products);
  return (
    <section className="page-section">
      <PageHeading
        eyebrow="GOOD THINGS, ALL TOGETHER"
        title="Your travel companions."
        description="A delicious journey is just a few bites away."
      />
      {!items.length ? (
        <EmptyState
          title="Your next meal is waiting."
          description="Your cart is empty. Find a little comfort for the journey."
          action="Explore the menu"
          onAction={() => navigate("menu")}
        />
      ) : (
        <div className="two-column">
          <div className="cart-items">
            {items.map((p) => (
              <article className="cart-item panel" key={p.id}>
                <FoodImage product={p} />
                <div className="cart-item-info">
                  <h3>{p.name}</h3>
                  <p>{money(p.price)} each</p>
                  <Stepper
                    value={state.cart[p.id]}
                    onChange={(n) => quantity(p.id, n)}
                    label={p.name}
                  />
                </div>
                <div className="cart-line-total">
                  <strong>{money(p.price * state.cart[p.id])}</strong>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => quantity(p.id, 0)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
            <button className="text-link" onClick={() => navigate("menu")}>
              <ArrowLeft size={15} /> Add something else
            </button>
          </div>
          <Summary {...t}>
            <button
              className="primary full-width"
              disabled={!items.length}
              onClick={() => navigate("checkout")}
            >
              Continue to checkout <ArrowRight size={17} />
            </button>
            <p className="muted small">
              Demo order only. No payment will be collected.
            </p>
          </Summary>
        </div>
      )}
    </section>
  );
}
export function CheckoutPage({ navigate }: { navigate: Navigate }) {
  const { state, setState, ready, products } = useRyde();
  const [form, setForm] = useState({
    name: state.profile.name,
    mobile: state.profile.mobile,
    coach: journey.coach,
    seat: journey.seat,
    station: "Kota Junction",
    payment: "Demo UPI",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);
  const t = totals(state.cart, products);
  useEffect(() => {
    if (ready)
      setForm((f) => ({
        ...f,
        name: state.profile.name,
        mobile: state.profile.mobile,
      }));
  }, [ready, state.profile.name, state.profile.mobile]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitted.current || !ready) return;
    const err: Record<string, string> = {};
    if (form.name.trim().length < 2)
      err.name = "Enter the passenger’s full name.";
    if (!/^[6-9]\d{9}$/.test(form.mobile))
      err.mobile = "Enter a valid 10-digit Indian mobile number.";
    if (!/^[A-Za-z]{1,3}\d{1,2}$/.test(form.coach.trim()))
      err.coach = "Use a coach such as B4 or S2.";
    if (
      !/^\d{1,3}$/.test(form.seat) ||
      Number(form.seat) < 1 ||
      Number(form.seat) > 120
    )
      err.seat = "Enter a seat number from 1 to 120.";
    setErrors(err);
    if (Object.keys(err).length || !state.selected || !t.subtotal) return;
    submitted.current = true;
    setBusy(true);
    const order: Order = {
      id: `RG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      createdAt: Date.now(),
      items: products
        .filter((p) => state.cart[p.id])
        .map((p) => ({
          product: { ...p, tags: [...p.tags] },
          quantity: state.cart[p.id],
        })),
      ...t,
      journey: {
        ...journey,
        coach: form.coach.trim().toUpperCase(),
        seat: form.seat,
        station: form.station,
      },
      passenger: {
        ...form,
        name: form.name.trim(),
        coach: form.coach.trim().toUpperCase(),
      },
    };
    setState((s) => ({ ...s, orders: [order, ...s.orders], cart: {} }));
    navigate("demo-tracking", order.id);
  };
  if (!ready)
    return <section className="page-section">Loading your journey…</section>;
  if (!t.subtotal)
    return (
      <EmptyState
        title="Let’s add a little goodness."
        description="Add a meal before checking out."
        action="Browse the menu"
        onAction={() => navigate("menu")}
      />
    );
  if (!state.selected)
    return (
      <EmptyState
        title="First, find your journey."
        description="Select the sample PNR 1234567890 on Home to activate your fictional journey."
        action="Select demo journey"
        onAction={() => navigate("home")}
      />
    );
  const field = (
    key: "name" | "mobile" | "coach" | "seat",
    label: string,
    placeholder: string,
  ) => (
    <label className="form-field" data-invalid={!!errors[key]}>
      <span>{label}</span>
      <input
        value={form[key]}
        placeholder={placeholder}
        inputMode={key === "mobile" || key === "seat" ? "numeric" : "text"}
        autoComplete={
          key === "name" ? "name" : key === "mobile" ? "tel" : "off"
        }
        maxLength={key === "mobile" ? 10 : key === "seat" ? 3 : 60}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `${key}-error` : undefined}
      />
      {errors[key] && (
        <small className="error" id={`${key}-error`}>
          {errors[key]}
        </small>
      )}
    </label>
  );
  return (
    <section className="page-section">
      <PageHeading
        eyebrow="ONE LAST STOP"
        title="Make yourself comfortable."
        description="We’ll bring the good food right to your seat."
      />
      <form onSubmit={submit} noValidate className="two-column">
        <div className="checkout-fields">
          <section className="panel">
            <h2>
              <UserRound size={20} /> Passenger details
            </h2>
            <div className="form-grid">
              {field("name", "Passenger name", "Full name")}
              {field("mobile", "Mobile number", "10-digit Indian mobile")}
            </div>
          </section>
          <section className="panel">
            <h2>
              <TrainFront size={20} /> Your delivery details
            </h2>
            <label className="form-field">
              <span>Train · fictional demo journey</span>
              <input value={journey.train} readOnly />
            </label>
            <div className="form-grid">
              {field("coach", "Coach", "B4")}
              {field("seat", "Seat", "32")}
            </div>
            <label className="form-field">
              <span>Delivery station</span>
              <select
                value={form.station}
                onChange={(e) =>
                  setForm((f) => ({ ...f, station: e.target.value }))
                }
              >
                {["Kota Junction", "Ratlam Junction", "Vadodara Junction"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </label>
          </section>
          <section className="panel">
            <h2>
              <CreditCard size={20} /> A payment-free test ride
            </h2>
            <div className="payment-options">
              {[
                { name: "Demo UPI", icon: Smartphone },
                { name: "Demo Card", icon: CreditCard },
              ].map((p) => (
                <label
                  key={p.name}
                  className={cn(
                    "payment-option",
                    form.payment === p.name && "selected",
                  )}
                >
                  <input
                    type="radio"
                    name="payment"
                    checked={form.payment === p.name}
                    onChange={() => setForm((f) => ({ ...f, payment: p.name }))}
                  />
                  <p.icon size={20} />
                  {p.name}
                </label>
              ))}
            </div>
            <p className="demo-warning">
              <ShieldCheck size={16} /> Demo only — no payment will be
              collected.
            </p>
          </section>
        </div>
        <Summary {...t}>
          <button type="submit" className="primary full-width" disabled={busy}>
            {busy ? "Creating your order…" : "Place demo order"}
            <ArrowRight size={17} />
          </button>
          <p className="muted small">
            No payment credentials needed. This is a local demo.
          </p>
        </Summary>
      </form>
    </section>
  );
}
function useNow() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
function useReorder(navigate: Navigate) {
  const { setState, notify, products } = useRyde();
  const [pending, setPending] = useState<Order | null>(null);
  const preview = pending ? prepareReorder(pending.items, products) : null;
  const confirm = () => {
    if (!pending) return;
    // Re-read the catalog when confirming, not just when opening the preview.
    const current = prepareReorder(pending.items, products);
    if (!Object.keys(current.cart).length) return;
    setState((s) => ({ ...s, cart: current.cart, selected: true }));
    setPending(null);
    notify("Cart updated with the current menu. Review it before checkout.");
    navigate("cart");
  };
  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>Review this reorder</DialogTitle>
        <DialogDescription>
          Prices and food details can change. Only items on the current demo menu
          will go into your cart. This replaces your existing cart.
        </DialogDescription>
        <ul className="reorder-preview">
          {preview?.lines.map((line, index) => (
            <li key={`${line.previous.id}-${index}`}>
              <strong>{line.quantity} × {line.current?.name ?? line.previous.name}</strong>
              <span>{line.current ? money(line.current.price) + " each" : "Unavailable"}</span>
              {line.changes.length > 0 && (
                <ul>
                  {line.changes.map((change) => <li key={change}>{change}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <p>Current item subtotal: <strong>{money(preview?.subtotal ?? 0)}</strong>. Delivery is calculated in the cart.</p>
        <div className="reorder-actions">
          <button className="secondary" onClick={() => setPending(null)}>Cancel</button>
          <button className="primary" disabled={!preview || !Object.keys(preview.cart).length} onClick={confirm}>
            Replace cart with available items
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
  return { reorder: setPending, dialog };
}
export function DemoTrackingPage({
  id,
  navigate,
}: {
  id: string;
  navigate: Navigate;
}) {
  const { state, ready } = useRyde();
  const now = useNow();
  const order = state.orders.find((o) => o.id === id);
  const { reorder, dialog: reorderDialog } = useReorder(navigate);
  if (!ready) return <p className="page-section">Loading order…</p>;
  if (!order)
    return (
      <EmptyState
        title="No order on this track."
        description="Demo orders disappear when you refresh. Start a new food journey."
        action="View orders"
        onAction={() => navigate("orders")}
      />
    );
  const status = orderStatus(order.createdAt, now);
  return (
    <section className="page-section">
      {reorderDialog}
      <PageHeading
        eyebrow="YOUR FOOD IS ON ITS WAY"
        title={
          status === 4 ? "A delicious arrival." : "Good food. Getting closer."
        }
        description="Simulated delivery progress · completes in 60 seconds"
      />
      <div className="two-column">
        <section className="panel tracking-main">
          <div className="tracking-top">
            <div>
              <span className="eyebrow">ORDER {order.id}</span>
              <h2>{statuses[status]}</h2>
            </div>
            <span className="subtle-pill cyan">
              {status === 4 ? "Enjoy your meal" : "Demo delivery"}
            </span>
          </div>
          <div
            className="coach-illustration"
            aria-label={`Train coach ${order.passenger.coach}, seat ${order.passenger.seat}`}
          >
            <span className="coach-tag">{order.passenger.coach}</span>
            <div className="coach-windows">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={cn(i === 3 && "your-window")}>
                  {i === 3 ? <ShoppingBag size={24} /> : <span />}
                </div>
              ))}
            </div>
            <span className="coach-caption">
              YOUR SEAT · {order.passenger.seat}
            </span>
            <div className="rail-track" />
          </div>
          <ol className="timeline">
            {statuses.map((s, i) => (
              <li
                key={s}
                className={cn(
                  i <= status && "complete",
                  i === status && "current",
                )}
              >
                <span className="timeline-dot">
                  {i <= status ? <Check size={15} /> : i + 1}
                </span>
                <div>
                  <h3>{s}</h3>
                  <p>
                    {
                      [
                        "Your demo order is safely on board.",
                        "A little care, a lot of flavour.",
                        "Sealed fresh for the journey.",
                        "Your meal has reached your coach.",
                        "Delivered! Enjoy every bite.",
                      ][i]
                    }
                  </p>
                </div>
                <span className="timeline-time">{i * 15}s</span>
              </li>
            ))}
          </ol>
          <div className="delivery-destination">
            <MapPin size={20} />
            <div>
              <strong>{order.passenger.station}</strong>
              <p>
                Coach {order.passenger.coach} · Seat {order.passenger.seat} ·{" "}
                {order.passenger.name}
              </p>
            </div>
          </div>
          {status === 4 && (
            <button
              className="primary full-width"
              onClick={() => reorder(order)}
            >
              Order again <ArrowRight size={17} />
            </button>
          )}
        </section>
        <OrderSummary order={order} />
      </div>
    </section>
  );
}
function OrderSummary({ order }: { order: Order }) {
  return (
    <Summary
      subtotal={order.subtotal}
      delivery={order.delivery}
      total={order.total}
    >
      <div className="order-snapshot">
        {order.items.map((i) => (
          <div key={i.product.id}>
            <span>
              {i.quantity} × {i.product.name}
            </span>
            <strong>{money(i.product.price * i.quantity)}</strong>
          </div>
        ))}
      </div>
      <p className="muted small">
        {order.journey.train}
        <br />
        {order.journey.from} → {order.journey.to}
        <br />
        {order.passenger.payment} · No payment collected
      </p>
    </Summary>
  );
}
export function OrdersPage({ navigate }: { navigate: Navigate }) {
  const { state } = useRyde();
  const now = useNow();
  const { reorder, dialog: reorderDialog } = useReorder(navigate);
  return (
    <section className="page-section">
      {reorderDialog}
      <PageHeading
        eyebrow="YOUR DELICIOUS LITTLE HISTORY"
        title="Meals along the way."
        description="Your demo orders for this visit. They disappear when you refresh."
      />
      <SecureOrders navigate={navigate} />
      <h2>Demo orders for this visit</h2>
      {!state.orders.length ? (
        <EmptyState
          title="Your first stop is a tasty one."
          description="Place a demo order and follow its journey here."
          action="Find your next meal"
          onAction={() => navigate("menu")}
        />
      ) : (
        <div className="orders-list">
          {state.orders.map((o) => {
            const status = orderStatus(o.createdAt, now);
            return (
              <article className="panel order-card" key={o.id}>
                <div className="order-card-head">
                  <span>
                    <ShoppingBag size={18} /> {o.id}
                  </span>
                  <span className="subtle-pill cyan">{statuses[status]}</span>
                </div>
                <h3>
                  {o.items
                    .map((i) => `${i.quantity} × ${i.product.name}`)
                    .join(", ")}
                </h3>
                <p>
                  <MapPin size={14} /> {o.passenger.station} · Coach{" "}
                  {o.passenger.coach} · Seat {o.passenger.seat}
                </p>
                <div className="order-card-footer">
                  <div>
                    <strong>{money(o.total)}</strong>
                    <small>
                      {new Date(o.createdAt).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </small>
                  </div>
                  <div>
                    <button
                      className="secondary"
                      onClick={() => navigate("demo-tracking", o.id)}
                    >
                      {status === 4 ? "View details" : "Track order"}
                      <ArrowRight size={15} />
                    </button>
                    <button className="text-link" onClick={() => reorder(o)}>
                      Order again
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
export function ProfilePage() {
  const { state, setState, notify, ready } = useRyde();
  const [name, setName] = useState(state.profile.name);
  const [mobile, setMobile] = useState(state.profile.mobile);
  const [preferences, setPreferences] = useState(state.profile.preferences);
  const [error, setError] = useState("");
  useEffect(() => {
    if (ready) {
      setName(state.profile.name);
      setMobile(state.profile.mobile);
      setPreferences(state.profile.preferences);
    }
  }, [ready, state.profile.name, state.profile.mobile, state.profile.preferences]);
  return (
    <section className="page-section profile-page">
      <PageHeading
        eyebrow="MAKE THE JOURNEY YOURS"
        title="A little about you."
        description="Your name, phone, and orders last only until refresh. Cart and food preferences stay in this browser."
      />
      <ProfileMedia />
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length < 2 || !/^[6-9]\d{9}$/.test(mobile)) {
            setError("Enter a name and a valid 10-digit Indian mobile number.");
            return;
          }
          setError("");
          setState((s) => ({
            ...s,
            profile: { name: name.trim(), mobile, preferences },
          }));
          notify("Preferences saved. Contact details last until refresh.");
        }}
      >
        <div className="profile-avatar">
          <UserRound size={30} />
        </div>
        <h2>Your passenger profile</h2>
        <div className="form-grid">
          <label className="form-field">
            <span>Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Passenger name"
              aria-invalid={!!error}
            />
          </label>
          <label className="form-field">
            <span>Mobile number</span>
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              inputMode="numeric"
              maxLength={10}
              autoComplete="tel"
              placeholder="10-digit mobile number"
              aria-invalid={!!error}
            />
          </label>
        </div>
        <fieldset className="preferences">
          <legend>Your kind of comfort food</legend>
          <p>Pick what you like. We&apos;ll find meals that match.</p>
          {["Vegetarian", "High-protein", "Mild spice"].map((p) => (
            <label key={p}>
              <input
                type="checkbox"
                checked={preferences.includes(p)}
                onChange={(e) =>
                  setPreferences((v) =>
                    e.target.checked ? [...v, p] : v.filter((x) => x !== p),
                  )
                }
              />
              <Leaf size={17} />
              {p}
            </label>
          ))}
        </fieldset>
        <p className="ai-label">
          <Sparkles size={14} /> AI-style picks · demo recommendations based on
          product tags.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={!ready} type="submit">
          Save preferences <Check size={17} />
        </button>
      </form>
    </section>
  );
}
