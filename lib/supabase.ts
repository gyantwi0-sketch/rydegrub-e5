import { createClient, type SupabaseClient, type User as SupabaseUser } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Browser-only public client. Never put a service-role or secret key in NEXT_PUBLIC_*. */
export function isSupabaseConfigured(): boolean {
  if (!supabaseUrl || !supabasePublishableKey) return false;
  try {
    const parsed = new URL(supabaseUrl);
    return (
      parsed.protocol === "https:" &&
      parsed.origin === supabaseUrl.replace(/\/$/, "") &&
      !supabasePublishableKey.includes("REPLACE_WITH") &&
      !supabasePublishableKey.includes("your-")
    );
  } catch {
    return false;
  }
}

let browserClient: SupabaseClient | null = null;
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!browserClient) {
    browserClient = createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    });
  }
  return browserClient;
}

export type AppAuthUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  provider: "google" | "email";
};

export function toAppAuthUser(user: SupabaseUser): AppAuthUser {
  const meta = user.user_metadata ?? {};
  const name = meta.full_name || meta.name || meta.display_name;
  const avatar = meta.avatar_url || meta.picture;
  return {
    uid: user.id,
    email: user.email ?? null,
    displayName: typeof name === "string" && name.trim() ? name.trim() : null,
    photoURL: typeof avatar === "string" && avatar.startsWith("https://") ? avatar : null,
    emailVerified: Boolean(user.email_confirmed_at),
    provider: user.app_metadata?.provider === "google" ? "google" : "email",
  };
}

export function requireSupabaseClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase sign-in is not configured yet. Contact the site administrator.");
  return client;
}
