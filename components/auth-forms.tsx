"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, Info, KeyRound, Leaf, LogOut, MapPin, ShieldCheck, TrainFront } from "lucide-react";
import { useRyde } from "./ryde-store";
import { useSupabaseAuth } from "./supabase-auth-provider";
import type { AppAuthUser } from "@/lib/supabase";

type AuthPage = "home" | "signin" | "signup";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function Field({ label, value, setValue, type = "text", autoComplete, placeholder }: {
  label: string; value: string; setValue: (s: string) => void;
  type?: "text" | "email" | "password"; autoComplete?: string; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return <div className="form-field auth-field">
    <label>{label}
      <div className={type === "password" ? "password-wrap" : undefined}>
        <input required type={type === "password" && show ? "text" : type}
          value={value} onChange={e => setValue(e.target.value)}
          autoComplete={autoComplete} placeholder={placeholder} />
        {type === "password" && <button className="password-toggle" type="button"
          aria-label={show ? "Hide password" : "Show password"}
          onClick={() => setShow(v => !v)}>
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>}
      </div>
    </label>
  </div>;
}

function GoogleIcon() {
  return <svg className="google-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
  </svg>;
}

function AuthShell({ eyebrow, title, subtitle, onGuest, children }: {
  eyebrow: string; title: string; subtitle: string;
  onGuest: () => void; children: ReactNode;
}) {
  return <section className="auth-page">
    <div className="auth-copy">
      <div className="eyebrow orange">{eyebrow}</div>
      <h1>Good food.<br /><span>On track.</span></h1>
      <p>Save your journey details and reorder your favourites faster.</p>
      <ul>
        <li><Leaf size={16} /> Freshly prepared meals</li>
        <li><MapPin size={16} /> Delivered right to your seat</li>
        <li><TrainFront size={16} /> Built for every kind of journey</li>
      </ul>
    </div>
    <div className="auth-card">
      <div className="auth-demo-note" role="note">
        <Info size={15} />
        <span>Secure account access with Google or email.</span>
      </div>
      <h2>{title}</h2>
      <p className="auth-subtitle">{subtitle}</p>
      {children}
      <div className="auth-divider"><span>or</span></div>
      <button type="button" className="secondary auth-guest" onClick={onGuest}>
        Continue as guest <ArrowRight size={16} />
      </button>
    </div>
  </section>;
}

function ActiveUserCard({ user, onSignOut, onHome }: {
  user: AppAuthUser; onSignOut: () => Promise<void>; onHome: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return <div className="auth-firebase-user">
    <div className="auth-firebase-user-header">
      {user.photoURL ? <img className="auth-avatar" src={user.photoURL} alt={user.displayName || "Avatar"} />
        : <div className="auth-avatar-fallback">{(user.displayName || user.email || "U")[0].toUpperCase()}</div>}
      <div className="auth-firebase-user-info">
        <strong>{user.displayName || "Traveller"}</strong>
        <span className="auth-email">{user.email}</span>
        <span className="auth-badge"><CheckCircle2 size={13} /> Signed in</span>
      </div>
    </div>
    <div className="auth-firebase-actions">
      <button type="button" className="primary" onClick={onHome}>Continue to Menu <ArrowRight size={16} /></button>
      <button type="button" className="secondary auth-signout-btn" disabled={busy}
        onClick={async () => { setBusy(true); try { await onSignOut(); } finally { setBusy(false); } }}>
        <LogOut size={15} /> Sign out
      </button>
    </div>
  </div>;
}

function GoogleLogin({ configured }: { configured: boolean }) {
  const { signInWithGoogle } = useSupabaseAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="google-auth-wrapper">
    <button type="button" className="auth-google-btn" disabled={!configured || busy}
      onClick={async () => {
        setBusy(true); setError("");
        try { await signInWithGoogle(); } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Google sign-in failed.");
          setBusy(false);
        }
      }}>
      <GoogleIcon /><span>{busy ? "Connecting to Google..." : "Continue with Google"}</span>
    </button>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

function AccountUnavailable() {
  return <div className="auth-demo-note" role="status">
    <Info size={15} /><span>Account sign-in is being configured. Please try again later or continue as guest.</span>
  </div>;
}

function PasswordRecovery() {
  const { sendPasswordReset, updatePassword, recoveryMode } = useSupabaseAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      if (recoveryMode) {
        if (newPassword.length < 8) throw new Error("Use at least 8 characters.");
        await updatePassword(newPassword);
        setMessage("Password changed successfully.");
        setNewPassword("");
      } else {
        if (!EMAIL_PATTERN.test(email.trim())) throw new Error("Enter a valid email address.");
        await sendPasswordReset(email.trim());
        setMessage("If the email is registered, a password reset link will be sent.");
      }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Request failed."); }
    finally { setBusy(false); }
  };
  return <div className="auth-reset-container">
    {!recoveryMode && <button type="button" className="auth-reset-toggle" onClick={() => setOpen(v => !v)}>
      <KeyRound size={13} /> {open ? "Cancel password reset" : "Forgot your password?"}
    </button>}
    {(open || recoveryMode) && <form className="auth-reset-form" onSubmit={submit}>
      {recoveryMode ? <Field label="New password" value={newPassword}
        setValue={setNewPassword} type="password" autoComplete="new-password" />
        : <Field label="Email for reset link" value={email}
          setValue={setEmail} type="email" autoComplete="email" />}
      <button type="submit" className="secondary auth-reset-submit" disabled={busy}>
        {busy ? "Working..." : recoveryMode ? "Save new password" : "Send Reset Link"}
      </button>
      {message && <p className="auth-reset-status" role="status">{message}</p>}
    </form>}
  </div>;
}

export function SignInPage({ navigate }: { navigate: (p: AuthPage) => void }) {
  const { notify } = useRyde();
  const { user, isConfigured, recoveryMode, signInWithEmail, logOut } = useSupabaseAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guest = () => { notify("Continuing as guest"); navigate("home"); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isConfigured || busy) return;
    setBusy(true); setError("");
    try {
      if (!EMAIL_PATTERN.test(email.trim())) throw new Error("Enter a valid email address.");
      const account = await signInWithEmail(email.trim(), password);
      notify(`Welcome back${account.displayName ? `, ${account.displayName}` : ""}!`);
      navigate("home");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to sign in."); }
    finally { setBusy(false); }
  };

  return <AuthShell eyebrow="WELCOME BACK, TRAVELLER" title="Sign in"
    subtitle="Pick up right where your journey left off." onGuest={guest}>
    {recoveryMode ? <PasswordRecovery /> : user ? <ActiveUserCard
      user={user} onHome={() => navigate("home")}
      onSignOut={async () => { await logOut(); notify("Signed out."); }} /> : <>
      {!isConfigured && <AccountUnavailable />}
      <GoogleLogin configured={isConfigured} />
      <div className="auth-divider"><span>or sign in with email</span></div>
      <form className="auth-form" onSubmit={submit}>
        <Field label="Email" value={email} setValue={setEmail}
          type="email" autoComplete="email" placeholder="name@example.com" />
        <Field label="Password" value={password} setValue={setPassword}
          type="password" autoComplete="current-password" placeholder="Enter your password" />
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" className="primary" disabled={!isConfigured || busy}>
          {busy ? "Signing in..." : "Sign In with Email"} <ArrowRight size={16} />
        </button>
      </form>
      {isConfigured && <PasswordRecovery />}
      <p className="auth-switch">New to RydeGrub?{" "}
        <button type="button" onClick={() => navigate("signup")}>Sign Up</button>
      </p>
    </>}
  </AuthShell>;
}

export function SignUpPage({ navigate }: { navigate: (p: AuthPage) => void }) {
  const { notify } = useRyde();
  const { user, isConfigured, signUpWithEmail, logOut } = useSupabaseAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const guest = () => { notify("Continuing as guest"); navigate("home"); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isConfigured || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (!name.trim()) throw new Error("Full name is required.");
      if (!EMAIL_PATTERN.test(email.trim())) throw new Error("Enter a valid email address.");
      if (password.length < 8) throw new Error("Use at least 8 characters.");
      if (password !== confirm) throw new Error("Passwords do not match.");
      const result = await signUpWithEmail(email.trim(), password, name.trim());
      if (result.confirmationRequired) {
        setSuccess("Check your inbox and confirm your email before signing in.");
      } else {
        notify("Welcome to RydeGrub!");
        navigate("home");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to register."); }
    finally { setBusy(false); }
  };

  return <AuthShell eyebrow="YOUR NEXT CHAPTER STARTS HERE" title="Create your account"
    subtitle="Register to access your saved journeys, orders, and preferences." onGuest={guest}>
    {user ? <ActiveUserCard user={user} onHome={() => navigate("home")}
      onSignOut={async () => { await logOut(); notify("Signed out."); }} /> : <>
      {!isConfigured && <AccountUnavailable />}
      <GoogleLogin configured={isConfigured} />
      <div className="auth-divider"><span>or register with email</span></div>
      <form className="auth-form" onSubmit={submit}>
        <Field label="Full name" value={name} setValue={setName} autoComplete="name" placeholder="Your full name" />
        <Field label="Email" value={email} setValue={setEmail} type="email" autoComplete="email"
          placeholder="name@example.com" />
        <Field label="Password" value={password} setValue={setPassword} type="password"
          autoComplete="new-password" placeholder="At least 8 characters" />
        <Field label="Confirm password" value={confirm} setValue={setConfirm}
          type="password" autoComplete="new-password" placeholder="Re-enter your password" />
        {error && <p role="alert" className="error">{error}</p>}
        {success && <p role="status" className="auth-reset-status">{success}</p>}
        <button type="submit" className="primary" disabled={!isConfigured || busy}>
          {busy ? "Creating account..." : "Create Account"} <ArrowRight size={16} />
        </button>
      </form>
      <p className="auth-switch">Already have an account?{" "}
        <button type="button" onClick={() => navigate("signin")}>Sign In</button>
      </p>
      <p className="auth-fineprint"><ShieldCheck size={13} /> Secure account sign-in with Google or email.</p>
    </>}
  </AuthShell>;
}
