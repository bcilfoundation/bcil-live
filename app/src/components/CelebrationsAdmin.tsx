import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { uploadPhoto } from "../lib/media";
import Avatar from "./Avatar";

export type SpotlightRow = { id: string; name: string; user_id: string | null; photo_url: string | null; role: string | null; headline: string; story: string | null;
  link_url: string | null; starts_on: string; ends_on: string | null; published: boolean };
type Bday = { id: string; full_name: string; avatar_url: string | null; birthday_month: number; birthday_day: number; days_away: number; shown: boolean };

const today = () => new Date().toISOString().slice(0, 10);
const plus = (d: string, n: number) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const nice = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Admin → Celebrations: Spotlight of the week, and the birthdays coming up
export default function CelebrationsAdmin() {
  return <><SpotlightAdmin /><BirthdaysAdmin /></>;
}

function SpotlightAdmin() {
  const [rows, setRows] = useState<SpotlightRow[] | null>(null);
  const [editing, setEditing] = useState<SpotlightRow | "new" | null>(null);
  const [err, setErr] = useState("");
  const load = () => supabase.from("spotlights").select("*").order("starts_on", { ascending: false }).limit(40)
    .then(({ data, error }) => { if (error) setErr("Run the database update for Celebrations first (053_birthdays_spotlight)."); setRows((data ?? []) as SpotlightRow[]); });
  useEffect(() => { load(); }, []);
  const t = today();
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div><h2 style={{ margin: 0 }}>⭐ Spotlight of the week</h2>
          <small className="muted">Celebrate a member, volunteer, mentor or partner. It shows in the rolling cards on Home for a week.</small></div>
        <button className="btn primary sm" onClick={() => setEditing("new")}>+ New spotlight</button>
      </div>
      {err && <p className="err">{err}</p>}
      {editing && <SpotlightEditor s={editing === "new" ? null : editing} close={() => setEditing(null)} saved={() => { setEditing(null); load(); }} />}
      {rows === null ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">No spotlights yet.</p> : (
        <div className="list">{rows.map((r) => {
          const end = r.ends_on ?? plus(r.starts_on, 6);
          const status = !r.published ? "Hidden" : r.starts_on > t ? `Starts ${nice(r.starts_on)}` : end < t ? "Ended" : "On Home now";
          return (
            <div key={r.id} className="row" style={{ gap: 10, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <Avatar name={r.name} url={r.photo_url} size={44} />
              <div className="grow"><b>{r.name}</b>{r.role && <small className="muted"> · {r.role}</small>}<br /><small>{r.headline}</small><br />
                <small className="muted">{nice(r.starts_on)} – {nice(end)} · {status}</small></div>
              <button className="btn ghost sm" onClick={() => setEditing(r)}>Edit</button>
            </div>
          );
        })}</div>
      )}
    </div>
  );
}

function SpotlightEditor({ s, close, saved }: { s: SpotlightRow | null; close: () => void; saved: () => void }) {
  const { session } = useAuth();
  const [f, setF] = useState({ name: s?.name ?? "", role: s?.role ?? "", headline: s?.headline ?? "", story: s?.story ?? "", photo_url: s?.photo_url ?? "",
    link_url: s?.link_url ?? "", starts_on: s?.starts_on ?? today(), ends_on: s?.ends_on ?? "", published: s?.published ?? true, user_id: s?.user_id ?? null as string | null });
  const [q, setQ] = useState(""); const [found, setFound] = useState<{ id: string; full_name: string; avatar_url: string | null }[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const set = (k: Partial<typeof f>) => setF((x) => ({ ...x, ...k }));

  // pick someone who is in the app: fills in their name and photo
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => supabase.from("profiles").select("id, full_name, avatar_url").ilike("full_name", `%${q.trim()}%`).limit(6)
      .then(({ data }) => setFound((data ?? []) as typeof found)), 250);
    return () => clearTimeout(t);
  }, [q]);

  async function pick(file?: File) {
    if (!file) return; setBusy(true); setErr("");
    try { set({ photo_url: await uploadPhoto(session!.user.id, file, 1200) }); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim() || !f.headline.trim()) { setErr("Add a name and a one-line headline."); return; }
    setBusy(true);
    const row = { name: f.name.trim(), role: f.role.trim() || null, headline: f.headline.trim(), story: f.story.trim() || null, photo_url: f.photo_url || null,
      link_url: f.link_url.trim() || null, starts_on: f.starts_on, ends_on: f.ends_on || null, published: f.published, user_id: f.user_id };
    const { error } = s ? await supabase.from("spotlights").update(row).eq("id", s.id) : await supabase.from("spotlights").insert(row);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    saved();
  }
  async function hide() {
    if (!s) return;
    setBusy(true); await supabase.from("spotlights").update({ published: !s.published }).eq("id", s.id); setBusy(false); saved();
  }
  return (
    <form className="card" onSubmit={save} style={{ background: "var(--bg)", marginTop: 10 }}>
      <b>{s ? "Edit spotlight" : "New spotlight"}</b>
      <label className="field">Find them in the app <small className="muted">(optional: fills in name and photo)</small>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name" /></label>
      {found.length > 0 && <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{found.map((p) => (
        <button type="button" key={p.id} className="chip" onClick={() => { set({ user_id: p.id, name: p.full_name, photo_url: f.photo_url || p.avatar_url || "" }); setQ(""); setFound([]); }}>{p.full_name}</button>
      ))}</div>}
      <div className="row" style={{ gap: 12, alignItems: "center" }}>
        <Avatar name={f.name || "?"} url={f.photo_url || null} size={64} />
        <button type="button" className="btn ghost sm" onClick={() => file.current?.click()} disabled={busy}>{busy ? "Uploading…" : f.photo_url ? "Change photo" : "Add a photo"}</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <label className="field">Name<input value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} /></label>
      <label className="field">Who they are <small className="muted">(e.g. FCB volunteer · UCC)</small><input value={f.role} onChange={(e) => set({ role: e.target.value })} maxLength={80} /></label>
      <label className="field">Why we celebrate them <small className="muted">(one line)</small><input value={f.headline} onChange={(e) => set({ headline: e.target.value })} maxLength={140} placeholder="e.g. Led 40 volunteers at Finding Campus Balance" /></label>
      <label className="field">Their story <small className="muted">(optional)</small><textarea value={f.story} onChange={(e) => set({ story: e.target.value })} maxLength={1200} style={{ minHeight: 90 }} /></label>
      <label className="field">Link <small className="muted">(optional: a post or article)</small><input value={f.link_url} onChange={(e) => set({ link_url: e.target.value })} placeholder="https://" /></label>
      <div className="grid2">
        <label className="field">From<input type="date" value={f.starts_on} onChange={(e) => set({ starts_on: e.target.value })} /></label>
        <label className="field">Until <small className="muted">(empty = one week)</small><input type="date" value={f.ends_on} onChange={(e) => set({ ends_on: e.target.value })} /></label>
      </div>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.published} onChange={(e) => set({ published: e.target.checked })} /> Show on Home</label>
      {err && <p className="err">{err}</p>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn primary" disabled={busy}>Save</button>
        <button type="button" className="btn ghost" onClick={close}>Cancel</button>
        {s && <button type="button" className="btn ghost" onClick={hide} disabled={busy}>{s.published ? "Hide from Home" : "Show on Home"}</button>}
      </div>
    </form>
  );
}

function BirthdaysAdmin() {
  const [rows, setRows] = useState<Bday[] | null>(null);
  useEffect(() => { supabase.rpc("birthdays_upcoming", { p_days: 31 }).then(({ data }) => setRows((data ?? []) as Bday[])); }, []);
  return (
    <div className="card">
      <h2 style={{ margin: 0 }}>🎂 Birthdays in the next month</h2>
      <small className="muted">Members add their birthday (day and month only) under Edit profile. On the day, they get a "Happy birthday" notification at 6:00 am Ghana time and appear in the rolling cards on Home, unless they turned that off or are under 18.</small>
      {rows === null ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">No birthdays saved for the next month yet.</p> : (
        <div className="list">{rows.map((r) => (
          <div key={r.id} className="row" style={{ gap: 10, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
            <Avatar name={r.full_name} url={r.avatar_url} size={36} />
            <div className="grow"><b>{r.full_name}</b><br /><small className="muted">{r.birthday_day} {MONTHS[r.birthday_month - 1]}{r.shown ? "" : " · not shown on Home"}</small></div>
            <span className={`pill ${r.days_away === 0 ? "live" : "soon"}`}>{r.days_away === 0 ? "Today 🎉" : r.days_away === 1 ? "Tomorrow" : `In ${r.days_away} days`}</span>
          </div>
        ))}</div>
      )}
    </div>
  );
}
