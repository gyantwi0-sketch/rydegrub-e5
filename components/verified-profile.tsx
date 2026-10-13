"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { useRyde } from "./ryde-store";

type ConsentPurpose = "marketing" | "personalization";
type ConsentRecord = { granted: boolean; updatedAt: number | null };
type ServerProfile = {
  name: string;
  phone: string;
  preferences: string[];
  consents: Record<ConsentPurpose, ConsentRecord>;
};
type HistoryEvent = { purpose: ConsentPurpose; granted: boolean; updatedAt: number };
const preferenceOptions = ["Vegetarian", "High-protein", "Mild spice"];
const consentLabels: Record<ConsentPurpose, string> = {
  marketing: "Send me optional promotional messages",
  personalization: "Use my preferences for personalised suggestions",
};

async function callApi(path: string, method = "GET", body?: object) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" && payload.error.length < 160
        ? payload.error
        : "Secure profile request failed. Please try again.",
    );
  }
  return payload;
}

function isProfile(value: unknown): value is ServerProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<ServerProfile>;
  return typeof p.name === "string" && typeof p.phone === "string" &&
    Array.isArray(p.preferences) &&
    !!p.consents &&
    ["marketing", "personalization"].every((purpose) => {
      const c = p.consents?.[purpose as ConsentPurpose];
      return c && typeof c.granted === "boolean";
    });
}

export function VerifiedProfile({ fallback }: { fallback: ReactNode }) {
  const { setState } = useRyde();
  const [mode, setMode] = useState<"loading" | "verified" | "demo">("loading");
  const [profile, setProfile] = useState<ServerProfile | null>(null);
  const [name, setName] = useState("");
  const [preferences, setPreferences] = useState<string[]>([]);
  const [newPhone, setNewPhone] = useState("");
  const [code, setCode] = useState("");
  const [pendingPhone, setPendingPhone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await callApi("/api/profile");
        if (!live) return;
        if (!isProfile(response.profile)) throw new Error("Invalid server profile response.");
        const p = response.profile;
        setProfile(p);
        setName(p.name);
        setPreferences(p.preferences);
        // The menu may use these preferences to filter food locally, but the
        // signed-in source of truth is always the verified server record.
        setState((s) => ({ ...s, profile: { ...s.profile, preferences: p.preferences } }));
        setMode("verified");
      } catch {
        if (live) setMode("demo");
      }
    })();
    return () => { live = false; };
  }, [setState]);

  async function execute(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void execute(async () => {
      const trimmed = name.trim();
      if (trimmed && trimmed.length < 2) throw new Error("Name must be at least 2 characters.");
      if (trimmed.length > 80) throw new Error("Name is too long.");
      const result = await callApi("/api/profile", "PATCH", { name: trimmed, preferences });
      if (!isProfile(result.profile)) throw new Error("Invalid server response.");
      setProfile(result.profile);
      setState((s) => ({
        ...s, profile: { ...s.profile, preferences: result.profile.preferences },
      }));
      setMessage("Profile preferences securely saved to your account.");
    });
  }

  function updateConsent(purpose: ConsentPurpose, granted: boolean) {
    void execute(async () => {
      const result = await callApi("/api/profile/consent", "PATCH", { purpose, granted });
      const consent = result.consents?.[purpose] as ConsentRecord | undefined;
      if (!consent || consent.granted !== granted) throw new Error("Consent update could not be verified.");
      setProfile((before) => before && ({ ...before, consents: result.consents }));
      setHistory(null);
      setMessage(granted ? "Consent recorded." : "Consent withdrawn.");
    });
  }

  function startPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void execute(async () => {
      if (!/^[6-9][0-9]{9}$/.test(newPhone)) throw new Error("Enter a valid 10-digit Indian number.");
      await callApi("/api/profile/phone/start", "POST", { phone: newPhone });
      setPendingPhone(true);
      setCode("");
      setMessage("Verification code requested. Check your SMS; it expires in 10 minutes.");
    });
  }

  function confirmPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void execute(async () => {
      if (!/^[0-9]{8}$/.test(code)) throw new Error("Enter the 8-digit verification code.");
      const result = await callApi("/api/profile/phone/confirm", "POST", { code });
      if (!isProfile(result.profile)) throw new Error("Invalid server response.");
      setProfile(result.profile);
      setPendingPhone(false);
      setCode("");
      setNewPhone("");
      setMessage("Phone verified and updated.");
    });
  }

  function loadHistory() {
    void execute(async () => {
      const result = await callApi("/api/profile/consent/history");
      if (!Array.isArray(result.events)) throw new Error("History unavailable.");
      setHistory(result.events as HistoryEvent[]);
    });
  }

  if (mode === "loading") return (
    <section className="page-section profile-page" aria-busy="true">
      <h1>Your profile</h1><p>Checking your verified account…</p>
    </section>
  );
  if (mode === "demo") return (
    <>
      <section className="page-section profile-page">
        <div className="panel" role="status">
          <strong>Demo account only.</strong> Secure profile saving, consent history
          and phone verification require a real signed-in account and configured
          server credentials. The form below is only a local preview.
        </div>
      </section>
      {fallback}
    </>
  );

  return (
    <section className="page-section profile-page">
      <div className="page-heading">
        <div className="eyebrow orange">VERIFIED PASSENGER PROFILE</div>
        <h1>Your RydeGrub account</h1>
        <p>Profile details and consent are protected by your verified session.</p>
      </div>
      <div className="panel">
        <div className="profile-avatar"><UserRound size={30} /></div>
        <h2>Your details</h2>
        <form onSubmit={saveProfile}>
          <label className="form-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              autoComplete="name" maxLength={80} />
          </label>
          <fieldset className="preferences">
            <legend>Food preferences</legend>
            {preferenceOptions.map((pref) => (
              <label key={pref}>
                <input type="checkbox" checked={preferences.includes(pref)}
                  disabled={busy}
                  onChange={(e) => setPreferences((items) =>
                    e.target.checked ? [...items, pref] : items.filter((p) => p !== pref))} />
                {pref}
              </label>
            ))}
          </fieldset>
          <button className="primary" type="submit" disabled={busy}>
            Save account preferences <Check size={17} />
          </button>
        </form>
      </div>

      <div className="panel">
        <h2><Smartphone size={20} /> Verified phone</h2>
        <p>{profile?.phone ? "Your phone is verified. You may replace it by verifying a new number." :
          "No phone number has been verified yet."}</p>
        <p>{profile?.phone ? `Verified number ending in ${profile.phone.slice(-4)}` : "None on file"}</p>
        <form onSubmit={startPhone} className="form-grid">
          <label className="form-field">
            <span>New Indian mobile number</span>
            <input inputMode="numeric" autoComplete="tel" pattern="[6-9][0-9]{9}"
              value={newPhone} maxLength={10} onChange={(e) => setNewPhone(e.target.value)} />
          </label>
          <button className="secondary" type="submit" disabled={busy}>Send verification code</button>
        </form>
        {pendingPhone && (
          <form onSubmit={confirmPhone} className="form-grid">
            <label className="form-field">
              <span>8-digit SMS code</span>
              <input type="text" inputMode="numeric" autoComplete="one-time-code"
                value={code} maxLength={8} onChange={(e) => setCode(e.target.value)} />
            </label>
            <button className="primary" type="submit" disabled={busy}>Verify &amp; save phone</button>
          </form>
        )}
      </div>

      <div className="panel">
        <h2><ShieldCheck size={20} /> Privacy &amp; consent</h2>
        <p>Both choices are off by default; your shopping does not automatically opt you in.</p>
        {(["marketing", "personalization"] as ConsentPurpose[]).map((purpose) => (
          <label key={purpose}>
            <input type="checkbox" checked={profile?.consents[purpose]?.granted === true}
              disabled={busy} onChange={(e) => updateConsent(purpose, e.target.checked)} />
            {" "}{consentLabels[purpose]}
            <small>{profile?.consents[purpose]?.updatedAt
              ? ` · Last changed ${new Date(profile.consents[purpose].updatedAt!).toLocaleString()}`
              : " · Never selected"}</small>
          </label>
        ))}
        <p><button className="secondary" type="button" disabled={busy}
          onClick={loadHistory}>Show consent history</button></p>
        {history && <div aria-live="polite">
          {history.length === 0 ? <p>No consent changes recorded.</p> :
            <ul>{history.map((event, index) => (
              <li key={`${event.updatedAt}-${event.purpose}-${index}`}>
                {event.purpose}: {event.granted ? "Granted" : "Withdrawn"} ·
                {" "}{new Date(event.updatedAt).toLocaleString()}
              </li>
            ))}</ul>}
        </div>}
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
