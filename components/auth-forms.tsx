"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Info,
  Leaf,
  MapPin,
  ShieldCheck,
  TrainFront,
} from "lucide-react";
import { useRyde } from "./ryde-store";

type AuthPage = "home" | "signin" | "signup";
type Errors = Record<string, string>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function FormField({
  label,
  name,
  value,
  onChange,
  error,
  type = "text",
  autoComplete,
  placeholder,
  inputRef,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  placeholder?: string;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  return (
    <div className="form-field auth-field">
      <label htmlFor={id}>{label}</label>
      <div className={isPassword ? "password-wrap" : undefined}>
        <input
          id={id}
          name={name}
          ref={inputRef}
          type={isPassword && visible ? "text" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {isPassword && (
          <button
            type="button"
            className="password-toggle"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-pressed={visible}
          >
            {visible ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      </div>
      {error && (
        <p className="error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  onGuest,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  onGuest: () => void;
}) {
  return (
    <section className="auth-page">
      <div className="auth-copy">
        <div className="eyebrow orange">{eyebrow}</div>
        <h1>
          Good food.
          <br />
          <span>On track.</span>
        </h1>
        <p>Save your journey details and reorder your favourites faster.</p>
        <ul>
          <li>
            <Leaf size={16} /> Freshly prepared meals
          </li>
          <li>
            <MapPin size={16} /> Delivered right to your seat
          </li>
          <li>
            <TrainFront size={16} /> Built for every kind of journey
          </li>
        </ul>
      </div>
      <div className="auth-card">
        <div className="auth-demo-note" role="note">
          <Info size={15} />
          <span>
            <strong>Secure account access.</strong> Verify your email before using account features.
          </span>
        </div>
        <h2>{title}</h2>
        <p className="auth-subtitle">{subtitle}</p>
        {children}
        <div className="auth-divider">
          <span>or</span>
        </div>
        <button type="button" className="secondary auth-guest" onClick={onGuest}>
          Continue as guest <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

function useAuthForm<T extends Record<string, string>>(
  initial: T,
  validate: (values: T) => Errors,
  onValid: (values: T) => Promise<void>,
) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const set = (key: keyof T) => (value: string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    if (submitted) setErrors(validate(next));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setSubmitted(true);
    const found = validate(values);
    setErrors(found);
    const first = Object.keys(initial).find((k) => found[k]);
    if (first) {
      refs.current[first]?.focus();
      return;
    }
    setPending(true); setFailure("");
    try { await onValid(values); setValues(initial); setSubmitted(false); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Request failed. Try again."); }
    finally { setPending(false); }
  };
  const register = (key: keyof T & string) => ({
    name: key,
    value: values[key],
    onChange: set(key),
    error: errors[key],
    inputRef: (el: HTMLInputElement | null) => {
      refs.current[key] = el;
    },
  });
  return { register, submit, pending, failure };
}

const emailError = (email: string) =>
  !email.trim()
    ? "Email is required."
    : !EMAIL_PATTERN.test(email.trim())
      ? "Enter a valid email address, like name@example.com."
      : "";

const clean = (errors: Errors) =>
  Object.fromEntries(Object.entries(errors).filter(([, v]) => v));

export function SignInPage({ navigate }: { navigate: (p: AuthPage) => void }) {
  const { notify } = useRyde();
  const guest = () => {
    notify("Continuing as guest");
    navigate("home");
  };
  const { register, submit, pending, failure } = useAuthForm(
    { email: "", password: "" },
    (v) =>
      clean({
        email: emailError(v.email),
        password: v.password ? "" : "Password is required.",
      }),
    async (v) => {
      const result = await accountRequest("signin", { email: v.email.trim(), password: v.password });
      notify(result.account.verified ? "Signed in" : "Signed in. Please verify your email.");
      window.dispatchEvent(new Event("ryde-session"));
    },
  );
  return (
    <AuthShell
      eyebrow="WELCOME BACK, TRAVELLER"
      title="Sign in"
      subtitle="Pick up right where your journey left off."
      onGuest={guest}
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          {...register("email")}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          {...register("password")}
        />
        {failure && <p role="alert" className="error">{failure}</p>}
        <button type="submit" className="primary" disabled={pending}>
          Sign In <ArrowRight size={16} />
        </button>
      </form>
      <AccountTools />
      <p className="auth-switch">
        New to RydeGrub?{" "}
        <button type="button" onClick={() => navigate("signup")}>
          Sign Up
        </button>
      </p>
    </AuthShell>
  );
}

export function SignUpPage({ navigate }: { navigate: (p: AuthPage) => void }) {
  const { notify } = useRyde();
  const guest = () => {
    notify("Continuing as guest");
    navigate("home");
  };
  const { register, submit, pending, failure } = useAuthForm(
    { name: "", email: "", password: "", confirm: "" },
    (v) =>
      clean({
        name: v.name.trim() ? "" : "Full name is required.",
        email: emailError(v.email),
        password: [...v.password].length >= 15 && [...v.password].length <= 128 ? "" : "Use 15–128 characters.",
        confirm: !v.confirm
          ? "Please confirm your password."
          : v.confirm !== v.password
            ? "Passwords do not match."
            : "",
      }),
    async (v) => {
      const result = await accountRequest("register", { name: v.name.trim(), email: v.email.trim(), password: v.password });
      notify(result.message);
      navigate("signin");
    },
  );
  return (
    <AuthShell
      eyebrow="YOUR NEXT CHAPTER STARTS HERE"
      title="Create your account"
      subtitle="Create an account and verify your email."
      onGuest={guest}
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormField
          label="Full name"
          autoComplete="name"
          placeholder="Your full name"
          {...register("name")}
        />
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          {...register("email")}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="Create a password"
          {...register("password")}
        />
        <FormField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter your password"
          {...register("confirm")}
        />
        {failure && <p role="alert" className="error">{failure}</p>}
        <button type="submit" className="primary" disabled={pending}>
          Create Account <ArrowRight size={16} />
        </button>
      </form>
      <p className="auth-switch">
        Already have an account?{" "}
        <button type="button" onClick={() => navigate("signin")}>
          Sign In
        </button>
      </p>
      <p className="auth-fineprint">
        <ShieldCheck size={13} /> Use 15–128 characters. Passwords are screened for known breaches and stored as hashes.
      </p>
    </AuthShell>
  );
}


async function accountRequest(action: string, body?: Record<string, string>) {
  const response = await fetch(`/api/v1/auth/${action}`, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Account service unavailable.");
  return result;
}
function AccountTools() {
  const [account, setAccount] = useState<{ name: string; verified: boolean } | null>(null);
  const [mode, setMode] = useState("verification/request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => { void accountRequest("session").then(r => setAccount(r.account)).catch(() => setAccount(null)); };
    refresh(); window.addEventListener("ryde-session", refresh);
    return () => window.removeEventListener("ryde-session", refresh);
  }, []);
  async function run(action: string, body: Record<string, string>) {
    setBusy(true); setMessage("");
    try { const result = await accountRequest(action, body); setMessage(result.message || "Signed out."); setToken(""); setPassword(""); window.dispatchEvent(new Event("ryde-session")); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Request failed."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Account verification and recovery">
    {account && <p>Signed in as {account.name}. {account.verified ? "Email verified." : "Email verification required."} <button type="button" disabled={busy} onClick={() => void run("logout", {})}>Sign out</button></p>}
    <details><summary>Verify email or reset password</summary>
      <form onSubmit={e => { e.preventDefault(); void run(mode, mode.endsWith("request") ? { email } : mode === "password/reset" ? { token, password } : { token }); }}>
        <label>Action <select value={mode} onChange={e => setMode(e.target.value)}>
          <option value="verification/request">Send verification code</option>
          <option value="verification/confirm">Confirm verification code</option>
          <option value="password/request">Request password reset</option>
          <option value="password/reset">Set new password</option>
        </select></label>
        {mode.endsWith("request") ? <FormField label="Email" name="recovery-email" type="email" value={email} onChange={setEmail} autoComplete="email" /> : <FormField label="Code from your email" name="account-code" value={token} onChange={setToken} autoComplete="one-time-code" />}
        {mode === "password/reset" && <FormField label="New password (15–128 characters)" name="new-password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />}
        <button type="submit" className="secondary" disabled={busy}>Continue</button>
      </form>
    </details>
    <p role="status">{message}</p>
  </section>;
}
