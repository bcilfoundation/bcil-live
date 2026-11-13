import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// Who to invite to a live session: members, whole groups, or any email address
export type Picks = { users: { id: string; name: string }[]; rooms: { id: string; name: string; n?: number }[]; emails: string[] };
export const noPicks = (): Picks => ({ users: [], rooms: [], emails: [] });
export const pickCount = (p: Picks) => p.users.length + p.rooms.length + p.emails.length;
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

/** Invite the picked people to a session. Members are notified in the app; email addresses get an email. */
export async function sendInvites(session: string, p: Picks): Promise<string> {
  if (!pickCount(p)) return "";
  const { error } = await supabase.rpc("invite_to_live", {
    p_session: session, p_users: p.users.map((u) => u.id), p_rooms: p.rooms.map((r) => r.id), p_emails: p.emails });
  if (error) return "Could not send the invites: " + error.message;
  const parts: string[] = [];
  if (p.users.length || p.rooms.length) parts.push("Members were notified in the app");
  if (p.emails.length) {
    const { data, error: fe } = await supabase.functions.invoke("send-live-invite", { body: { session } });
    const r = (data ?? {}) as { sent?: number; failed?: string[]; reason?: string };
    if (fe || r.reason) parts.push("the email invites could not be sent yet" + (r.reason ? ` (${r.reason})` : ""));
    else parts.push(`${r.sent ?? 0} email${r.sent === 1 ? "" : "s"} sent${r.failed?.length ? `, ${r.failed.length} failed (${r.failed.join(", ")})` : ""}`);
  }
  return parts.join("; ") + ".";
}

export function InvitePicker({ value, onChange, label = "Invite" }: { value: Picks; onChange: (p: Picks) => void; label?: string }) {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string; member_count?: number }[]>([]);
  const allGroups = useRef<{ id: string; name: string; member_count?: number; kind?: string }[] | null>(null);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || isEmail(t)) { setPeople([]); setGroups([]); return; }
    const h = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("id, full_name").ilike("full_name", `%${t.replace(/[%_,()]/g, "")}%`).limit(6);
      setPeople((data ?? []) as { id: string; full_name: string }[]);
      if (!allGroups.current) { const { data: g } = await supabase.rpc("group_list"); allGroups.current = (g ?? []) as typeof allGroups.current; }
      setGroups((allGroups.current ?? []).filter((g) => g.kind !== "dm" && g.name.toLowerCase().includes(t.toLowerCase())).slice(0, 4));
    }, 250);
    return () => clearTimeout(h);
  }, [q]);
  const add = (p: Partial<Picks>) => { onChange({ users: [...value.users, ...(p.users ?? [])], rooms: [...value.rooms, ...(p.rooms ?? [])], emails: [...value.emails, ...(p.emails ?? [])] }); setQ(""); };
  const t = q.trim();
  const showEmail = isEmail(t) && !value.emails.includes(t.toLowerCase());
  return (
    <div className="inv">
      <div className="glA-cap">{label}</div>
      <input className="inv-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, group or email address" aria-label="Invite people"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (showEmail) add({ emails: [t.toLowerCase()] }); } }} />
      {(people.length > 0 || groups.length > 0 || showEmail) && (
        <div className="inv-list" role="listbox">
          {showEmail && <button type="button" onClick={() => add({ emails: [t.toLowerCase()] })}>✉ Invite <b>{t}</b> by email</button>}
          {groups.filter((g) => !value.rooms.some((r) => r.id === g.id)).map((g) => (
            <button type="button" key={g.id} onClick={() => add({ rooms: [{ id: g.id, name: g.name, n: g.member_count }] })}>👥 <b>{g.name}</b><small>{g.member_count ? ` · all ${g.member_count} members` : " · whole group"}</small></button>))}
          {people.filter((p) => !value.users.some((u) => u.id === p.id)).map((p) => (
            <button type="button" key={p.id} onClick={() => add({ users: [{ id: p.id, name: p.full_name || "Member" }] })}>{p.full_name || "Member"}</button>))}
        </div>)}
      {pickCount(value) > 0 && (
        <div className="inv-chips">
          {value.users.map((u) => <span key={u.id} className="inv-chip">{u.name}<button type="button" aria-label={`Remove ${u.name}`} onClick={() => onChange({ ...value, users: value.users.filter((x) => x.id !== u.id) })}>✕</button></span>)}
          {value.rooms.map((r) => <span key={r.id} className="inv-chip">👥 {r.name}<button type="button" aria-label={`Remove ${r.name}`} onClick={() => onChange({ ...value, rooms: value.rooms.filter((x) => x.id !== r.id) })}>✕</button></span>)}
          {value.emails.map((m) => <span key={m} className="inv-chip mail">✉ {m}<button type="button" aria-label={`Remove ${m}`} onClick={() => onChange({ ...value, emails: value.emails.filter((x) => x !== m) })}>✕</button></span>)}
        </div>)}
    </div>
  );
}

/** A sheet to invite more people to a session that already exists (scheduled or live). */
export function InviteSheet({ session, title, onClose }: { session: string; title: string; onClose: () => void }) {
  const [p, setP] = useState<Picks>(noPicks());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [invited, setInvited] = useState<number | null>(null);
  useEffect(() => { supabase.from("live_invites").select("user_id", { count: "exact", head: true }).eq("session_id", session).then(({ count }) => setInvited(count ?? 0)); }, [session, msg]);
  return (<>
    <div className="sheet-back" onClick={onClose} />
    <div className="sheet" role="dialog" aria-label="Invite people">
      <h3 style={{ margin: 0 }}>Invite people</h3>
      <p className="muted small" style={{ margin: "2px 0 6px" }}>{title}{invited !== null ? ` · ${invited} invited so far` : ""}</p>
      <InvitePicker value={p} onChange={setP} label="Who" />
      {msg && <p className="ok small">{msg}</p>}
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn primary" disabled={busy || !pickCount(p)} onClick={async () => { setBusy(true); const m = await sendInvites(session, p); setBusy(false); setMsg(m); if (!m.startsWith("Could not")) setP(noPicks()); }}>{busy ? "Sending…" : "Send invites"}</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  </>);
}
