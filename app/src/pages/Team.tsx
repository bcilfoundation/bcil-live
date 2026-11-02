import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { uploadPhoto } from "../lib/media";
import Avatar from "../components/Avatar";

type Links = { linkedin?: string; facebook?: string; instagram?: string; website?: string; scholar?: string };
type Member = { id: string; name: string; role: string; team: string; bio: string | null; photo_url: string | null; sort: number; links?: Links | null };
// one profile link each: LinkedIn, or Facebook for someone without LinkedIn
const LINKS: [keyof Links, string, string][] = [["linkedin", "LinkedIn", "#0a66c2"], ["facebook", "Facebook", "#1877f2"]];
async function openUrl(url: string) {
  const { isNative } = await import("../lib/native");
  if (isNative) { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url }); return; }
  window.open(url, "_blank", "noopener");
}
const TEAMS = ["Board of Directors", "Executives", "Coordinators", "Advisors"];
const VALUES = ["Integrity", "Mentorship", "Persistence", "Responsibility", "Excellence", "Impact"];

// About us: who BCIL Foundation is (vision, mission, core values) and the people leading it. Staff add and edit people here.
export default function Team() {
  const { isStaff } = useAuth();
  const [people, setPeople] = useState<Member[] | null>(null);
  const [open, setOpen] = useState<Member | null>(null);
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const load = () => supabase.from("team_members").select("*").order("sort").order("created_at").then(({ data }) => setPeople((data ?? []) as Member[]));
  useEffect(() => { load(); }, []);
  const teams = [...new Set([...TEAMS, ...(people ?? []).map((p) => p.team)])].filter((t) => (people ?? []).some((p) => p.team === t));

  return (
    <section className="view">
      <div className="about-hero">
        <img src={`${import.meta.env.BASE_URL}logo-wordmark.webp`} alt="BCIL Foundation" />
        <h1>About us</h1>
        <p className="about-mantra">Grooming Generational Leaders</p>
        <p>BCIL Foundation is a youth-focused non-profit organisation in Ghana (a Company Limited by Guarantee). Our work centres on youth empowerment, mentorship, leadership development, personal growth and positive social impact.</p>
      </div>
      <div className="about-vm">
        <div className="card"><span className="eyebrow">Our vision</span><p>To become a globally recognized leader in youth empowerment by enabling the next generation to discover and fulfill their purpose, realize their full potential and make a meaningful and positive impact in society.</p></div>
        <div className="card"><span className="eyebrow">Our mission</span><p>To empower young people, particularly students, through conferences, mentorship, and guidance, enabling them to fulfil their purpose and nurture future leaders who make positive contributions to society.</p></div>
      </div>
      <h2>Our core values</h2>
      <div className="about-values">{VALUES.map((v) => <div key={v}><b>{v}</b></div>)}</div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 18 }}>
        <h2 style={{ margin: 0 }}>Our team</h2>
        {isStaff && <button className="btn primary sm" style={{ whiteSpace: "nowrap" }} onClick={() => setEditing("new")}>+ Add person</button>}
      </div>
      {people === null ? <p className="muted">Loading…</p> : people.length === 0 ? (
        <div className="empty"><b>Team profiles are coming soon</b>{isStaff ? "Tap “+ Add person” to add the directors and executives." : ""}</div>
      ) : teams.map((t) => (
        <div key={t}>
          <h3 className="about-team">{t}</h3>
          <div className="teamgrid">{people.filter((p) => p.team === t).map((p) => (
            <button key={p.id} className="teamcard" onClick={() => setOpen(p)}>
              {p.photo_url ? <img src={p.photo_url} alt="" loading="lazy" /> : <Avatar name={p.name} size={84} />}
              <b>{p.name}</b><small className="muted">{p.role}</small>
            </button>
          ))}</div>
        </div>
      ))}

      {open && <>
        <div className="sheet-back" onClick={() => setOpen(null)} />
        <div className="sheet" role="dialog" aria-label={open.name}>
          <div className="ps-head" style={{ display: "flex", gap: 14, alignItems: "center" }}>
            {open.photo_url ? <img src={open.photo_url} alt="" style={{ width: 84, height: 84, borderRadius: "50%", objectFit: "cover" }} /> : <Avatar name={open.name} size={84} />}
            <div className="grow"><h3 style={{ margin: 0 }}>{open.name}</h3><span className="muted">{open.role} · {open.team}</span></div>
            <button className="linkbtn" onClick={() => setOpen(null)} aria-label="Close">✕</button>
          </div>
          {open.bio ? <p className="prewrap">{open.bio}</p> : <p className="muted">More about {open.name.split(" ")[0]} soon.</p>}
          {open.links && LINKS.some(([k]) => open.links?.[k]) && <div className="teamlinks">{LINKS.filter(([k]) => open.links?.[k]).slice(0, 1).map(([k, label, color]) => (
            <button key={k} className="btn sm" style={{ background: color, color: "#fff", border: 0 }} onClick={() => openUrl(open.links![k]!)}>View {open.name.split(" ")[0]}'s {label} profile</button>))}</div>}
          {isStaff && <button className="btn ghost" onClick={() => { setEditing(open); setOpen(null); }}>✏️ Edit</button>}
        </div>
      </>}
      {editing && <Editor m={editing === "new" ? null : editing} close={() => setEditing(null)} saved={() => { setEditing(null); load(); }} />}
    </section>
  );
}

function Editor({ m, close, saved }: { m: Member | null; close: () => void; saved: () => void }) {
  const { session } = useAuth();
  const [f, setF] = useState({ name: m?.name ?? "", role: m?.role ?? "", team: m?.team ?? "Executives", bio: m?.bio ?? "", photo_url: m?.photo_url ?? "", sort: m?.sort ?? 100 });
  const [links, setLinks] = useState<Links>(m?.links ?? {});
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function photo(file?: File) {
    if (!file) return; setBusy(true); setErr("");
    try { const url = await uploadPhoto(session!.user.id, file, 700); setF((x) => ({ ...x, photo_url: url })); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  async function save() {
    if (!f.name.trim() || !f.role.trim()) { setErr("Add the name and the role."); return; }
    setBusy(true); setErr("");
    const clean: Links = {};
    for (const [k] of LINKS) { let v = (links[k] ?? "").trim(); if (!v) continue; if (!/^https?:\/\//.test(v)) v = "https://" + v; clean[k] = v; }
    const row = { name: f.name.trim(), role: f.role.trim(), team: f.team.trim() || "Executives", bio: f.bio.trim() || null, photo_url: f.photo_url || null, sort: Number(f.sort) || 100, links: clean };
    const { error } = m ? await supabase.from("team_members").update(row).eq("id", m.id) : await supabase.from("team_members").insert(row);
    setBusy(false);
    if (error) setErr(error.message); else saved();
  }
  async function remove() {
    if (!m || !window.confirm(`Remove ${m.name} from Our team?`)) return;
    const { error } = await supabase.from("team_members").delete().eq("id", m.id);
    if (error) setErr(error.message); else saved();
  }
  return (
    <>
      <div className="sheet-back" onClick={close} />
      <div className="sheet tall" role="dialog" aria-label="Edit team member">
        <div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>{m ? "Edit person" : "Add a person"}</h3><button className="linkbtn" onClick={close}>Close</button></div>
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          {f.photo_url ? <img src={f.photo_url} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover" }} /> : <Avatar name={f.name} size={64} />}
          <label className="btn ghost sm">{busy ? "Uploading…" : f.photo_url ? "Change photo" : "Add photo"}<input type="file" accept="image/*" hidden onChange={(e) => photo(e.target.files?.[0])} /></label>
        </div>
        <label className="field">Full name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Role<input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="e.g. Executive Director" /></label>
        <label className="field">Group <small className="muted">(pick or type)</small><input list="team-groups" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} />
          <datalist id="team-groups">{TEAMS.map((t) => <option key={t} value={t} />)}</datalist></label>
        <label className="field">Short bio <small className="muted">(optional)</small><textarea value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></label>
        {LINKS.map(([k, label]) => <label key={k} className="field">{label} link <small className="muted">(optional)</small><input value={links[k] ?? ""} onChange={(e) => setLinks({ ...links, [k]: e.target.value })} inputMode="url" placeholder="https://…" /></label>)}
        <label className="field">Order <small className="muted">(smaller numbers show first)</small><input value={f.sort} onChange={(e) => setF({ ...f, sort: Number(e.target.value.replace(/\D/g, "")) || 0 })} inputMode="numeric" /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" disabled={busy} onClick={save}>Save</button>
          {m && <button className="btn ghost" style={{ color: "var(--live)" }} disabled={busy} onClick={remove}>Remove</button>}
        </div>
      </div>
    </>
  );
}
