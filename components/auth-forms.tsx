"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Leaf,
  LogOut,
  MapPin,
  ShieldCheck,
  TrainFront,
  UserRound,
} from "lucide-react";
import { useRyde } from "./ryde-store";
import { useFirebaseAuth } from "./firebase-auth-provider";
import type { User } from "@/lib/firebase";

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

function GoogleIcon() {
  return (
    <svg className="google-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

function GoogleSignInButton({
  onSuccess,
  disabled,
}: {
  onSuccess: (name?: string) => void;
  disabled?: boolean;
}) {
  const { signInWithGoogle, isConfigured } = useFirebaseAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogle = async () => {
    setLoading(true);
    setError("");
    try {
      const user = await signInWithGoogle();
      onSuccess(user.displayName || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="google-auth-wrapper">
      <button
        type="button"
        className="auth-google-btn"
        onClick={handleGoogle}
        disabled={loading || disabled || !isConfigured}
        title={!isConfigured ? "Add Firebase credentials to .env.local to enable" : "Sign in with Google"}
      >
        <GoogleIcon />
        <span>{loading ? "Connecting to Google..." : "Continue with Google"}</span>
      </button>
      {error && (
        <p role="alert" className="error" style={{ marginTop: "8px" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function FirebaseSetupNotice({ isConfigured }: { isConfigured: boolean }) {
  if (isConfigured) return null;
  return (
    <details className="firebase-setup-banner">
      <summary>
        <Info size={14} />
        <span>Firebase Authentication not configured (.env.local)</span>
      </summary>
      <div className="firebase-setup-content">
        <p>To enable live Firebase Authentication (Google & Email):</p>
        <ol>
          <li>
            Go to <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer">console.firebase.google.com</a> and create/select your project.
          </li>
          <li>In <strong>Build &gt; Authentication &gt; Sign-in method</strong>, enable <em>Email/Password</em> and <em>Google</em>.</li>
          <li>In <strong>Project Settings &gt; General &gt; Your apps</strong>, copy the web app credentials.</li>
          <li>Add them to your <code>.env.local</code> file:</li>
        </ol>
        <pre className="firebase-setup-code">
{`NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-app.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-app.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef`}
        </pre>
      </div>
    </details>
  );
}

function FirebaseActiveUserCard({
  user,
  onSignOut,
  onNavigateHome,
}: {
  user: User;
  onSignOut: () => void;
  onNavigateHome: () => void;
}) {
  return (
    <div className="auth-firebase-user">
      <div className="auth-firebase-user-header">
        {user.photoURL ? (
          <img src={user.photoURL} alt={user.displayName || "User"} className="auth-avatar" />
        ) : (
          <div className="auth-avatar-fallback">
            {(user.displayName || user.email || "U")[0].toUpperCase()}
          </div>
        )}
        <div className="auth-firebase-user-info">
          <strong>{user.displayName || "Authenticated User"}</strong>
          <span className="auth-email">{user.email}</span>
          <span className="auth-badge">
            <CheckCircle2 size={13} /> Firebase authenticated
          </span>
        </div>
      </div>
      <div className="auth-firebase-actions">
        <button type="button" className="primary" onClick={onNavigateHome}>
          Continue to Menu <ArrowRight size={16} />
        </button>
        <button type="button" className="secondary auth-signout-btn" onClick={onSignOut}>
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </div>
  );
}

function PasswordResetBox() {
  const { sendPasswordReset, isConfigured } = useFirebaseAuth();
  const [open, setOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isConfigured) return null;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim() || !EMAIL_PATTERN.test(resetEmail.trim())) {
      setStatus("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      await sendPasswordReset(resetEmail.trim());
      setStatus("Password reset link sent! Check your inbox.");
      setResetEmail("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to send reset link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-reset-container">
      <button
        type="button"
        className="auth-reset-toggle"
        onClick={() => setOpen((prev) => !prev)}
      >
        <KeyRound size={13} />
        {open ? "Cancel password reset" : "Forgot your password?"}
      </button>
      {open && (
        <form onSubmit={handleReset} className="auth-reset-form">
          <FormField
            label="Email for reset link"
            type="email"
            value={resetEmail}
            onChange={setResetEmail}
            placeholder="name@example.com"
            autoComplete="email"
          />
          <button type="submit" className="secondary auth-reset-submit" disabled={busy}>
            {busy ? "Sending..." : "Send Reset Link"}
          </button>
          {status && <p role="status" className="auth-reset-status">{status}</p>}
        </form>
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
            <strong>Firebase Authentication enabled.</strong> Sign in with Google or Email/Password.
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
    setPending(true);
    setFailure("");
    try {
      await onValid(values);
      setValues(initial);
      setSubmitted(false);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Request failed. Try again.");
    } finally {
      setPending(false);
    }
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
  const { user, isConfigured, signInWithEmail, logOut } = useFirebaseAuth();

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
      if (isConfigured) {
        const loggedUser = await signInWithEmail(v.email.trim(), v.password);
        notify(`Welcome back${loggedUser.displayName ? ", " + loggedUser.displayName : ""}!`);
        navigate("home");
      } else {
        const result = await accountRequest("signin", {
          email: v.email.trim(),
          password: v.password,
        });
        notify(result.account.verified ? "Signed in" : "Signed in. Please verify your email.");
        window.dispatchEvent(new Event("ryde-session"));
      }
    },
  );

  return (
    <AuthShell
      eyebrow="WELCOME BACK, TRAVELLER"
      title="Sign in"
      subtitle="Pick up right where your journey left off."
      onGuest={guest}
    >
      {user ? (
        <FirebaseActiveUserCard
          user={user}
          onSignOut={async () => {
            await logOut();
            notify("Signed out from Firebase.");
          }}
          onNavigateHome={() => navigate("home")}
        />
      ) : (
        <>
          <FirebaseSetupNotice isConfigured={isConfigured} />

          <GoogleSignInButton
            onSuccess={(name) => {
              notify(`Welcome back${name ? ", " + name : ""}!`);
              navigate("home");
            }}
          />

          <div className="auth-divider">
            <span>or sign in with email</span>
          </div>

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
            {failure && (
              <p role="alert" className="error">
                {failure}
              </p>
            )}
            <button type="submit" className="primary" disabled={pending}>
              Sign In with Email <ArrowRight size={16} />
            </button>
          </form>

          <PasswordResetBox />

          {!isConfigured && <AccountTools />}

          <p className="auth-switch">
            New to RydeGrub?{" "}
            <button type="button" onClick={() => navigate("signup")}>
              Sign Up
            </button>
          </p>
        </>
      )}
    </AuthShell>
  );
}

export function SignUpPage({ navigate }: { navigate: (p: AuthPage) => void }) {
  const { notify } = useRyde();
  const { user, isConfigured, signUpWithEmail, logOut } = useFirebaseAuth();

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
        password: isConfigured
          ? v.password.length >= 6
            ? ""
            : "Firebase requires at least 6 characters."
          : [...v.password].length >= 15 && [...v.password].length <= 128
            ? ""
            : "Use 15–128 characters.",
        confirm: !v.confirm
          ? "Please confirm your password."
          : v.confirm !== v.password
            ? "Passwords do not match."
            : "",
      }),
    async (v) => {
      if (isConfigured) {
        const newUser = await signUpWithEmail(v.email.trim(), v.password, v.name.trim());
        notify(`Welcome to RydeGrub${newUser.displayName ? ", " + newUser.displayName : ""}!`);
        navigate("home");
      } else {
        const result = await accountRequest("register", {
          name: v.name.trim(),
          email: v.email.trim(),
          password: v.password,
        });
        notify(result.message);
        navigate("signin");
      }
    },
  );

  return (
    <AuthShell
      eyebrow="YOUR NEXT CHAPTER STARTS HERE"
      title="Create your account"
      subtitle="Register to access your saved journeys, orders, and preferences."
      onGuest={guest}
    >
      {user ? (
        <FirebaseActiveUserCard
          user={user}
          onSignOut={async () => {
            await logOut();
            notify("Signed out from Firebase.");
          }}
          onNavigateHome={() => navigate("home")}
        />
      ) : (
        <>
          <FirebaseSetupNotice isConfigured={isConfigured} />

          <GoogleSignInButton
            onSuccess={(name) => {
              notify(`Welcome to RydeGrub${name ? ", " + name : ""}!`);
              navigate("home");
            }}
          />

          <div className="auth-divider">
            <span>or register with email</span>
          </div>

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
              placeholder={isConfigured ? "At least 6 characters" : "15–128 characters"}
              {...register("password")}
            />
            <FormField
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              placeholder="Re-enter your password"
              {...register("confirm")}
            />
            {failure && (
              <p role="alert" className="error">
                {failure}
              </p>
            )}
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
            <ShieldCheck size={13} />
            {isConfigured
              ? "Protected by Firebase Authentication with Google Identity Platform."
              : "Use 15–128 characters. Passwords are screened for known breaches."}
          </p>
        </>
      )}
    </AuthShell>
  );
}

async function accountRequest(action: string, body?: Record<string, string>) {
  const response = await fetch(`/api/v1/auth/${action}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
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
    const refresh = () => {
      void accountRequest("session")
        .then((r) => setAccount(r.account))
        .catch(() => setAccount(null));
    };
    refresh();
    window.addEventListener("ryde-session", refresh);
    return () => window.removeEventListener("ryde-session", refresh);
  }, []);

  async function run(action: string, body: Record<string, string>) {
    setBusy(true);
    setMessage("");
    try {
      const result = await accountRequest(action, body);
      setMessage(result.message || "Signed out.");
      setToken("");
      setPassword("");
      window.dispatchEvent(new Event("ryde-session"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Account verification and recovery" style={{ marginTop: "16px" }}>
      {account && (
        <p style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
          Native session: {account.name}. {account.verified ? "Verified." : "Verification required."}{" "}
          <button type="button" disabled={busy} onClick={() => void run("logout", {})}>
            Sign out
          </button>
        </p>
      )}
      <details>
        <summary style={{ fontSize: "12px", color: "var(--muted-foreground)", cursor: "pointer" }}>
          Legacy account tools
        </summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              mode,
              mode.endsWith("request")
                ? { email }
                : mode === "password/reset"
                  ? { token, password }
                  : { token },
            );
          }}
          style={{ marginTop: "8px" }}
        >
          <label style={{ fontSize: "12px" }}>
            Action{" "}
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="verification/request">Send verification code</option>
              <option value="verification/confirm">Confirm verification code</option>
              <option value="password/request">Request password reset</option>
              <option value="password/reset">Set new password</option>
            </select>
          </label>
          {mode.endsWith("request") ? (
            <FormField
              label="Email"
              name="recovery-email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />
          ) : (
            <FormField
              label="Code from your email"
              name="account-code"
              value={token}
              onChange={setToken}
              autoComplete="one-time-code"
            />
          )}
          {mode === "password/reset" && (
            <FormField
              label="New password (15–128 characters)"
              name="new-password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
          )}
          <button type="submit" className="secondary" disabled={busy} style={{ width: "100%", marginTop: "8px" }}>
            Continue
          </button>
        </form>
      </details>
      {message && <p role="status" style={{ fontSize: "12px", marginTop: "4px" }}>{message}</p>}
    </section>
  );
}
