import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// A tick next to the names of BCIL admins and moderators (blue) and mentors (gold), so people know who they're talking to.
type Roles = Map<string, "staff" | "mentor">;
let cache: Roles | null = null;
let pending: Promise<Roles> | null = null;
const subs = new Set<() => void>();
export function loadRoles(force = false): Promise<Roles> {
  if (cache && !force) return Promise.resolve(cache);
  if (pending && !force) return pending;
  pending = (async () => {
    const { data } = await supabase.from("profiles").select("id, role").in("role", ["admin", "moderator", "mentor"]).limit(2000);
    const m: Roles = new Map();
    for (const r of (data ?? []) as { id: string; role: string }[]) m.set(r.id, r.role === "mentor" ? "mentor" : "staff");
    cache = m; pending = null; subs.forEach((f) => f());
    return m;
  })();
  return pending;
}
export function roleOf(id?: string | null) { return id && cache ? cache.get(id) ?? null : null; }

export default function Tick({ id, size = 15 }: { id?: string | null; size?: number }) {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); if (!cache) loadRoles(); return () => { subs.delete(f); }; }, []);
  const r = roleOf(id);
  if (!r) return null;
  const label = r === "staff" ? "BCIL team" : "BCIL mentor";
  return (
    <span className={`vtick ${r}`} title={label} aria-label={label} role="img" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" /><path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}
