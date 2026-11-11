import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { docLink } from "../lib/docs";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import Avatar from "../components/Avatar";

type Pair = { id: number; mentor_id: string; mentee_id: string; room_id: string | null; status: string; next_session: string | null;
  mentor: { full_name: string; avatar_url: string | null } | null; mentee: { full_name: string; avatar_url: string | null } | null };
const PAIR_COLS = "id, mentor_id, mentee_id, room_id, status, next_session, mentor:profiles!mentorships_mentor_id_fkey(full_name, avatar_url), mentee:profiles!mentorships_mentee_id_fkey(full_name, avatar_url)";

const when = (d: string) => new Date(d).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
// datetime-local wants local "YYYY-MM-DDTHH:MM"
const toLocalInput = (d: string | null) => { if (!d) return ""; const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

// BCIL Academic Mentorship: my mentor or mentees, the next session, and how to join
export default function Mentorship() {
  const { session, profile } = useAuth();
  const me = session!.user.id;
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [applied, setApplied] = useState<string[]>([]);
  const load = () => {
    supabase.from("mentorships").select(PAIR_COLS).eq("status", "active").or(`mentor_id.eq.${me},mentee_id.eq.${me}`)
      .then(({ data }) => setPairs((data ?? []) as unknown as Pair[]));
    supabase.from("form_responses").select("forms!inner(slug)").eq("user_id", me).in("forms.slug", ["mentorship-mentee", "mentorship-mentor"])
      .then(({ data }) => setApplied(((data ?? []) as unknown as { forms: { slug: string } }[]).map((r) => r.forms.slug)));
  };
  useEffect(() => { load(); }, []);

  const asMentee = (pairs ?? []).filter((p) => p.mentee_id === me);
  const asMentor = (pairs ?? []).filter((p) => p.mentor_id === me);

  return (
    <section className="view">
      <h1>Mentorship</h1>
      {profile?.role === "mentor" && <Link className="card planbar" to="/admin?tab=Plan%202027" style={{ textDecoration: "none", color: "inherit" }}>
        <span>📋 <b>For mentors:</b> your mentees' 2027 plans, and anything Solomon asks you to help with</span><span className="btn ghost sm">Open</span></Link>}
      <p className="muted">BCIL Academic Mentorship pairs students with experienced mentors for support beyond our programmes: studies, career, leadership and personal growth.</p>
      <Link to="/plan" className="card plancta">
        <span className="eyebrow">New · free pilot</span>
        <b>📝 Plan 2027</b>
        <span className="muted small">Write your one-year plan for 2027: your goals and targets for each area of life, with start and end months. Get feedback from BCIL mentors and check in every month.</span>
        <span className="btn primary sm">Open my plan</span>
      </Link>
      {pairs === null ? <p className="muted">Loading…</p> : <>
        {asMentee.map((p) => <PairCard key={p.id} p={p} other={p.mentor} label="Your mentor" reload={load} />)}
        {asMentor.length > 0 && <h2 style={{ marginTop: 16 }}>Your mentees</h2>}
        {asMentor.map((p) => <PairCard key={p.id} p={p} other={p.mentee} label="Mentee" reload={load} />)}

        <div className="grid2" style={{ marginTop: 16 }}>
          {asMentee.length === 0 && <div className="card mentorcta">
            <b>🎓 Find a mentor</b>
            <span className="muted small">Tell us what you'd like help with and we'll pair you with a mentor.</span>
            {applied.includes("mentorship-mentee") ? <span className="pill sent">Request sent · we'll be in touch</span>
              : <Link className="btn primary sm" to="/forms?form=mentorship-mentee">Ask for a mentor</Link>}
          </div>}
          <div className="card mentorcta">
            <b>🤝 Become a mentor</b>
            <span className="muted small">Share your time and experience with a student who's a step behind you.</span>
            {applied.includes("mentorship-mentor") ? <span className="pill sent">Offer received · thank you</span>
              : <Link className="btn ghost sm" to="/forms?form=mentorship-mentor">Offer to mentor</Link>}
          </div>
        </div>
      </>}
    </section>
  );
}

function PairCard({ p, other, label, reload }: { p: Pair; other: Pair["mentor"]; label: string; reload: () => void }) {
  const [edit, setEdit] = useState(false);
  const [at, setAt] = useState(toLocalInput(p.next_session));
  const [err, setErr] = useState("");
  const upcoming = p.next_session && new Date(p.next_session) > new Date();
  async function save(clear = false) {
    setErr("");
    const { error } = await supabase.rpc("set_mentorship_session", { p_id: p.id, p_at: clear || !at ? null : new Date(at).toISOString() });
    if (error) setErr(error.message); else { setEdit(false); reload(); }
  }
  return (
    <div className="card paircard">
      <div className="row" style={{ gap: 12, alignItems: "center" }}>
        <Avatar url={other?.avatar_url ?? null} name={other?.full_name ?? "?"} size={52} />
        <div className="grow"><span className="eyebrow">{label}</span><b>{other?.full_name ?? "Member"}</b></div>
        {p.room_id && <Link className="btn primary sm" to={`/chat?room=${p.room_id}`}>💬 Chat</Link>}
      </div>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <span>{upcoming ? <>📅 Next session: <b>{when(p.next_session!)}</b></> : <span className="muted">No session planned yet</span>}</span>
        <button className="linkbtn" onClick={() => setEdit((v) => !v)}>{upcoming ? "Change" : "Plan the next session"}</button>
      </div>
      {edit && <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Next session date and time" />
        <button className="btn primary sm" onClick={() => save()} disabled={!at}>Save</button>
        {p.next_session && <button className="btn ghost sm" onClick={() => save(true)}>Clear</button>}
        <small className="muted" style={{ width: "100%" }}>You'll both get a reminder an hour before.</small>
      </div>}
      {err && <p className="err">{err}</p>}
      <PairDocs pairId={p.id} />
    </div>
  );
}

// documents shared in this mentorship, each opening on a page where you can both comment
function PairDocs({ pairId }: { pairId: number }) {
  const { session } = useAuth();
  const me = session!.user.id;
  const nav = useNavigate();
  const [docs, setDocs] = useState<{ id: number; name: string; owner_id: string; created_at: string; version?: number; doc_comments: { count: number }[] }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    supabase.from("documents").select("id, name, owner_id, created_at, version, doc_comments(count)").eq("context", "mentorship").eq("ref_id", pairId).order("created_at", { ascending: false })
      .then(({ data, error }) => setDocs(error ? [] : (data ?? []) as never));
  }, [pairId]);
  async function share(file?: File) {
    if (!file) return; setErr("");
    if (file.size > 10 * 1024 * 1024) { setErr("That file is over 10 MB."); return; }
    setBusy(true);
    try {
      const path = `${me}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
      const up = await supabase.storage.from("form-files").upload(path, file, { contentType: file.type || undefined });
      if (up.error) throw new Error(/mime|type/i.test(up.error.message) ? "Please share a PDF, Word file (.docx) or a picture." : "Upload failed. Check your connection and try again.");
      nav(await docLink(path, file.name, "mentorship", pairId));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="pairdocs">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b>📄 Documents for review</b>
        <label className="btn ghost sm">{busy ? "Uploading…" : "＋ Share a document"}<input type="file" hidden disabled={busy} accept="application/pdf,image/*,.docx" onChange={(e) => { share(e.target.files?.[0]); e.target.value = ""; }} /></label>
      </div>
      {docs && docs.length === 0 && <small className="muted">Share a CV, essay, plan or application and get comments on it, like in Google Docs.</small>}
      {docs?.map((d) => (
        <Link key={d.id} to={`/doc/${d.id}`} className="pairdoc">
          <span className="grow"><b>{d.name}</b>{(d.version ?? 1) > 1 && <span className="pill">v{d.version}</span>}<small className="muted">{d.owner_id === me ? "You" : "Shared with you"} · {new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small></span>
          <span className="pill">💬 {d.doc_comments?.[0]?.count ?? 0}</span>
        </Link>
      ))}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
