"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  useCallback,
} from "react";
import {
  getFirebaseAuth,
  isFirebaseConfigured,
  onAuthStateChanged,
  firebaseSignInWithEmail,
  firebaseSignUpWithEmail,
  firebaseSignInWithGoogle,
  firebaseSendPasswordReset,
  firebaseSignOut,
  mapFirebaseError,
  type User,
} from "@/lib/firebase";

interface FirebaseAuthContextValue {
  user: User | null;
  loading: boolean;
  isConfigured: boolean;
  error: string | null;
  clearError: () => void;
  signInWithEmail: (email: string, pass: string) => Promise<User>;
  signUpWithEmail: (email: string, pass: string, displayName?: string) => Promise<User>;
  signInWithGoogle: () => Promise<User>;
  sendPasswordReset: (email: string) => Promise<void>;
  logOut: () => Promise<void>;
}

const FirebaseAuthContext = createContext<FirebaseAuthContextValue | null>(null);

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const configured = isFirebaseConfigured();

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        setUser(currentUser);
        setLoading(false);
      },
      (authError) => {
        setError(mapFirebaseError(authError));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [configured]);

  const signInWithEmail = async (email: string, pass: string): Promise<User> => {
    setError(null);
    try {
      const u = await firebaseSignInWithEmail(email, pass);
      setUser(u);
      return u;
    } catch (err) {
      const msg = mapFirebaseError(err);
      setError(msg);
      throw new Error(msg);
    }
  };

  const signUpWithEmail = async (email: string, pass: string, displayName?: string): Promise<User> => {
    setError(null);
    try {
      const u = await firebaseSignUpWithEmail(email, pass, displayName);
      setUser(u);
      return u;
    } catch (err) {
      const msg = mapFirebaseError(err);
      setError(msg);
      throw new Error(msg);
    }
  };

  const signInWithGoogle = async (): Promise<User> => {
    setError(null);
    try {
      const u = await firebaseSignInWithGoogle();
      setUser(u);
      return u;
    } catch (err) {
      const msg = mapFirebaseError(err);
      setError(msg);
      throw new Error(msg);
    }
  };

  const sendPasswordReset = async (email: string): Promise<void> => {
    setError(null);
    try {
      await firebaseSendPasswordReset(email);
    } catch (err) {
      const msg = mapFirebaseError(err);
      setError(msg);
      throw new Error(msg);
    }
  };

  const logOut = async (): Promise<void> => {
    setError(null);
    try {
      await firebaseSignOut();
      setUser(null);
    } catch (err) {
      const msg = mapFirebaseError(err);
      setError(msg);
      throw new Error(msg);
    }
  };

  return (
    <FirebaseAuthContext.Provider
      value={{
        user,
        loading,
        isConfigured: configured,
        error,
        clearError,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        sendPasswordReset,
        logOut,
      }}
    >
      {children}
    </FirebaseAuthContext.Provider>
  );
}

export function useFirebaseAuth(): FirebaseAuthContextValue {
  const context = useContext(FirebaseAuthContext);
  if (!context) {
    throw new Error("useFirebaseAuth must be used within a FirebaseAuthProvider");
  }
  return context;
}
