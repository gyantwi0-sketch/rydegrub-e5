"use client";
import { useId, useRef, useState, type ReactNode } from "react";
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
            <strong>UI demo only.</strong> No account is created and passwords
            are never saved or sent.
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
  onValid: () => void,
) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const set = (key: keyof T) => (value: string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    if (submitted) setErrors(validate(next));
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const found = validate(values);
    setErrors(found);
    const first = Object.keys(initial).find((k) => found[k]);
    if (first) {
      refs.current[first]?.focus();
      return;
    }
    setValues(initial);
    setSubmitted(false);
    onValid();
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
  return { register, submit };
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
  const { register, submit } = useAuthForm(
    { email: "", password: "" },
    (v) =>
      clean({
        email: emailError(v.email),
        password: v.password ? "" : "Password is required.",
      }),
    () => {
      notify("Demo sign-in complete. No account was used.");
      navigate("home");
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
        <button type="submit" className="primary">
          Sign In <ArrowRight size={16} />
        </button>
      </form>
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
  const { register, submit } = useAuthForm(
    { name: "", email: "", password: "", confirm: "" },
    (v) =>
      clean({
        name: v.name.trim() ? "" : "Full name is required.",
        email: emailError(v.email),
        password: v.password ? "" : "Password is required.",
        confirm: !v.confirm
          ? "Please confirm your password."
          : v.confirm !== v.password
            ? "Passwords do not match."
            : "",
      }),
    () => {
      notify("Demo sign-up complete. No account was created.");
      navigate("home");
    },
  );
  return (
    <AuthShell
      eyebrow="YOUR NEXT CHAPTER STARTS HERE"
      title="Create your account"
      subtitle="A preview of how sign-up will work."
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
        <button type="submit" className="primary">
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
        <ShieldCheck size={13} /> Demo form. Nothing you enter is stored.
      </p>
    </AuthShell>
  );
}
