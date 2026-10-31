"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  getSupabaseClient, isSupabaseConfigured, requireSupabaseClient, toAppAuthUser,
  type AppAuthUser,
} from "@/lib/supabase";

type SignupResult = { user: AppAuthUser | null; confirmationRequired: boolean };
interface SupabaseAuthContextValue {
  user: AppAuthUser | null;
  loading: boolean;
  isConfigured: boolean;
  error: string | null;
  recoveryMode: boolean;
  clearError: () => void;
  signInWithEmail: (email: string, password: string) => Promise<AppAuthUser>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<SignupResult>;
  signInWithGoogle: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<SupabaseAuthContextValue | null>(null);

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppAuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const isConfigured = isSupabaseConfigured();

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) { setLoading(false); return; }
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ? toAppAuthUser(session.user) : null);
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      if (event === "SIGNED_OUT") setRecoveryMode(false);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const fail = (cause: unknown): never => {
    const message = cause instanceof Error ? cause.message : "Authentication failed.";
    setError(message);
    throw new Error(message);
  };

  async function signInWithEmail(email: string, password: string): Promise<AppAuthUser> {
    setError(null);
    try {
      const { data, error: authError } = await requireSupabaseClient().auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      if (!data.user || !data.session) throw new Error("No active session was created.");
      const appUser = toAppAuthUser(data.user);
      setUser(appUser);
      return appUser;
    } catch (cause) { return fail(cause); }
  }

  async function signUpWithEmail(email: string, password: string, displayName?: string): Promise<SignupResult> {
    setError(null);
    try {
      const { data, error: authError } = await requireSupabaseClient().auth.signUp({
        email, password,
        options: {
          data: { full_name: displayName?.trim() || "" },
          emailRedirectTo: window.location.origin,
        },
      });
      if (authError) throw authError;
      if (!data.user) throw new Error("Unable to create account.");
      if (!data.session) return { user: null, confirmationRequired: true };
      const appUser = toAppAuthUser(data.user);
      setUser(appUser);
      return { user: appUser, confirmationRequired: false };
    } catch (cause) { return fail(cause); }
  }

  async function signInWithGoogle(): Promise<void> {
    setError(null);
    try {
      const { error: authError } = await requireSupabaseClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (authError) throw authError;
      // Supabase redirects the browser; onAuthStateChange restores the session after callback.
    } catch (cause) { return fail(cause); }
  }

  async function sendPasswordReset(email: string): Promise<void> {
    setError(null);
    try {
      const { error: authError } = await requireSupabaseClient().auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (authError) throw authError;
    } catch (cause) { return fail(cause); }
  }

  async function updatePassword(password: string): Promise<void> {
    setError(null);
    try {
      const { error: authError } = await requireSupabaseClient().auth.updateUser({ password });
      if (authError) throw authError;
      setRecoveryMode(false);
    } catch (cause) { return fail(cause); }
  }

  async function logOut(): Promise<void> {
    setError(null);
    try {
      const { error: authError } = await requireSupabaseClient().auth.signOut();
      if (authError) throw authError;
      setUser(null);
      setRecoveryMode(false);
    } catch (cause) { return fail(cause); }
  }

  return <AuthContext.Provider value={{
    user, loading, isConfigured, error, recoveryMode, clearError: () => setError(null),
    signInWithEmail, signUpWithEmail, signInWithGoogle, sendPasswordReset, updatePassword, logOut,
  }}>{children}</AuthContext.Provider>;
}

export function useSupabaseAuth(): SupabaseAuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useSupabaseAuth must be inside SupabaseAuthProvider.");
  return context;
}
