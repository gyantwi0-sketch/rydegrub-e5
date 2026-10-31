import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  onAuthStateChanged,
  type Auth,
  type User,
} from "firebase/auth";

export interface FirebaseConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
}

export const firebaseConfig: FirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

/**
 * Checks whether Firebase configuration has been provided with valid values.
 */
export function isFirebaseConfigured(): boolean {
  const { apiKey, projectId } = firebaseConfig;
  if (!apiKey || !projectId) return false;
  const isPlaceholder = (val: string) =>
    val.includes("REPLACE_WITH") ||
    val.includes("your_api_key") ||
    val.includes("your-project-id") ||
    val.trim() === "";
  return !isPlaceholder(apiKey) && !isPlaceholder(projectId);
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
const googleProvider = new GoogleAuthProvider();

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) return null;
  if (!app) {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }
  return app;
}

export function getFirebaseAuth(): Auth | null {
  if (auth) return auth;
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  auth = getAuth(firebaseApp);
  return auth;
}

/**
 * Maps Firebase error codes to human-friendly feedback messages.
 */
export function mapFirebaseError(error: unknown): string {
  if (!error || typeof error !== "object") return "Authentication request failed.";
  const err = error as { code?: string; message?: string };
  switch (err.code) {
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password. Please verify and try again.";
    case "auth/email-already-in-use":
      return "An account with this email address already exists. Try signing in.";
    case "auth/weak-password":
      return "Password is too weak. Please use at least 6 characters.";
    case "auth/popup-closed-by-user":
      return "Google sign-in popup was closed before completion.";
    case "auth/popup-blocked":
      return "Popup was blocked by your browser. Please allow popups for this site.";
    case "auth/operation-not-allowed":
      return "This sign-in provider is not enabled in your Firebase Console. Please enable it under Firebase Authentication > Sign-in method.";
    case "auth/network-request-failed":
      return "Network connection failed. Please check your internet connection.";
    case "auth/too-many-requests":
      return "Access to this account has been temporarily disabled due to many failed attempts. Try again later.";
    default:
      return err.message || "An authentication error occurred. Please try again.";
  }
}

/**
 * Signs in a user with email and password.
 */
export async function firebaseSignInWithEmail(email: string, pass: string): Promise<User> {
  const authInstance = getFirebaseAuth();
  if (!authInstance) {
    throw new Error("Firebase Authentication is not configured. Set NEXT_PUBLIC_FIREBASE_* environment variables.");
  }
  const userCredential = await signInWithEmailAndPassword(authInstance, email, pass);
  return userCredential.user;
}

/**
 * Registers a new user with email and password, and sets their display name.
 */
export async function firebaseSignUpWithEmail(email: string, pass: string, displayName?: string): Promise<User> {
  const authInstance = getFirebaseAuth();
  if (!authInstance) {
    throw new Error("Firebase Authentication is not configured. Set NEXT_PUBLIC_FIREBASE_* environment variables.");
  }
  const userCredential = await createUserWithEmailAndPassword(authInstance, email, pass);
  if (displayName?.trim()) {
    try {
      await updateProfile(userCredential.user, { displayName: displayName.trim() });
    } catch {
      // Non-fatal if profile display name update fails
    }
  }
  return userCredential.user;
}

/**
 * Initiates Google OAuth popup sign-in via Firebase.
 */
export async function firebaseSignInWithGoogle(): Promise<User> {
  const authInstance = getFirebaseAuth();
  if (!authInstance) {
    throw new Error("Firebase Authentication is not configured. Set NEXT_PUBLIC_FIREBASE_* environment variables.");
  }
  const userCredential = await signInWithPopup(authInstance, googleProvider);
  return userCredential.user;
}

/**
 * Sends a password reset email via Firebase.
 */
export async function firebaseSendPasswordReset(email: string): Promise<void> {
  const authInstance = getFirebaseAuth();
  if (!authInstance) {
    throw new Error("Firebase Authentication is not configured. Set NEXT_PUBLIC_FIREBASE_* environment variables.");
  }
  await sendPasswordResetEmail(authInstance, email);
}

/**
 * Signs out the current Firebase user.
 */
export async function firebaseSignOut(): Promise<void> {
  const authInstance = getFirebaseAuth();
  if (authInstance) {
    await signOut(authInstance);
  }
}

export { onAuthStateChanged };
export type { User };
