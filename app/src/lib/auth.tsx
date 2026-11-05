import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Profile } from "./supabase";

// isStaff is what the screens use. realStaff is the true role; an admin can switch on "view as member"
// to see the app exactly as a member does (staff buttons hidden) without changing their account.
type Auth = { session: Session | null; profile: Profile | null; loading: boolean; isStaff: boolean; realStaff: boolean; viewAsMember: boolean; setViewAsMember: (on: boolean) => void; refreshProfile: () => Promise<void> };
const Ctx = createContext<Auth>({ session: null, profile: null, loading: true, isStaff: false, realStaff: false, viewAsMember: false, setViewAsMember: () => {}, refreshProfile: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewAsMember, setView] = useState(() => { try { return sessionStorage.getItem("bcil.viewAsMember") === "1"; } catch { return false; } });
  const setViewAsMember = (on: boolean) => { setView(on); try { if (on) sessionStorage.setItem("bcil.viewAsMember", "1"); else sessionStorage.removeItem("bcil.viewAsMember"); } catch { /* ignore */ } };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  async function refreshProfile() {
    if (!session) { setProfile(null); return; }
    const cols = "id, full_name, role, avatar_url, bio, is_minor";
    let { data, error } = await supabase.from("profiles").select(`${cols}, newsletter`).eq("id", session.user.id).single();
    // before the newsletter column exists in the database, load the profile without it
    if (error && !data) ({ data } = await supabase.from("profiles").select(cols).eq("id", session.user.id).single());
    setProfile(data as Profile | null);
  }
  useEffect(() => { refreshProfile(); }, [session?.user.id]);

  const realStaff = profile?.role === "admin" || profile?.role === "moderator";
  const isStaff = realStaff && !viewAsMember;
  return <Ctx.Provider value={{ session, profile, loading, isStaff, realStaff, viewAsMember: realStaff && viewAsMember, setViewAsMember, refreshProfile }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
