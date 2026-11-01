import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  // pkce lets "Continue with Google" hand the sign-in back to the website or the Android app safely
  { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } },
);

export type Profile = { id: string; full_name: string; role: "member" | "mentor" | "moderator" | "admin"; avatar_url?: string | null; bio?: string | null; is_minor?: boolean };

export const initials = (name: string) =>
  name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
