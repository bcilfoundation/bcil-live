import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Profile } from "./supabase";

type Auth = { session: Session | null; profile: Profile | null; loading: boolean; isStaff: boolean; refreshProfile: () => Promise<void> };
const Ctx = createContext<Auth>({ session: null, profile: null, loading: true, isStaff: false, refreshProfile: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  async function refreshProfile() {
    if (!session) { setProfile(null); return; }
    const { data } = await supabase.from("profiles").select("id, full_name, role, avatar_url, bio").eq("id", session.user.id).single();
    setProfile(data as Profile | null);
  }
  useEffect(() => { refreshProfile(); }, [session?.user.id]);

  const isStaff = profile?.role === "admin" || profile?.role === "moderator";
  return <Ctx.Provider value={{ session, profile, loading, isStaff, refreshProfile }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
