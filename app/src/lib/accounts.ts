import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Several accounts on one phone (for example the BCIL Foundation account and your personal one).
// Each account's sign-in is kept on this device only, so you can switch without typing a password again.
export type Saved = { id: string; email: string; name: string; avatar: string | null; rt: string };
const KEY = "bcil.accounts";
export function savedAccounts(): Saved[] { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
function write(list: Saved[]) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* */ } window.dispatchEvent(new Event("bcil-accounts")); }

export function rememberSession(s: Session | null, profile?: { full_name?: string | null; avatar_url?: string | null } | null) {
  if (!s?.refresh_token) return;
  const list = savedAccounts();
  const old = list.find((a) => a.id === s.user.id);
  const entry: Saved = { id: s.user.id, email: s.user.email ?? s.user.phone ?? "", rt: s.refresh_token,
    name: profile?.full_name ?? old?.name ?? s.user.email ?? "Account", avatar: profile?.avatar_url ?? old?.avatar ?? null };
  write([entry, ...list.filter((a) => a.id !== s.user.id)].slice(0, 5));
}
export function forgetAccount(id: string) { write(savedAccounts().filter((a) => a.id !== id)); }

// switch to a saved account: its saved sign-in starts a fresh session (the current one stays saved)
export async function switchTo(id: string): Promise<string | null> {
  const acc = savedAccounts().find((a) => a.id === id);
  if (!acc) return "That account isn't saved on this phone.";
  const { data: cur } = await supabase.auth.getSession();
  if (cur.session) rememberSession(cur.session);
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: acc.rt });
  if (error || !data.session) {
    forgetAccount(id);
    if (cur.session) await supabase.auth.refreshSession({ refresh_token: savedAccounts().find((a) => a.id === cur.session!.user.id)?.rt ?? cur.session.refresh_token }).catch(() => {});
    return "That account was signed out. Sign in to it again.";
  }
  rememberSession(data.session);
  return null;
}

// add another account: keep this one saved and go to the sign-in screen (without signing this one out everywhere)
export async function addAccount() {
  const { data } = await supabase.auth.getSession();
  if (data.session) rememberSession(data.session);
  await supabase.auth.signOut({ scope: "local" });
}

// sign out of this account on this phone and forget it here
export async function signOutHere() {
  const { data } = await supabase.auth.getSession();
  if (data.session) forgetAccount(data.session.user.id);
  await supabase.auth.signOut({ scope: "local" });
}
