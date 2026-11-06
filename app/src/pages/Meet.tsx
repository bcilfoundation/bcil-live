import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { docLink, fileName } from "../lib/docs";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import Avatar from "../components/Avatar";

const TOPICS = ["Mentorship", "My 2027 plan", "Career or studies", "Partnership or programme", "Speaking invitation", "Something else"];
const MODES = ["Phone call", "WhatsApp call", "Video call", "In person (Cape Coast)"];
type Req = { id: number; topic: string; message: string; mode: string | null; preferred: string | null; files: string[]; status: string; meet_at: string | null; reply: string | null; room_id: string | null; created_at: string };
const STATUS: Record<string, [string, string]> = { pending: ["Waiting for a reply", ""], confirmed: ["Confirmed", "paid"], declined: ["Not this time", ""], done: ["Done", "sent"] };
export const when = (d: string) => new Date(d).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Meet Solomon: members ask for a meeting, say when suits them, and attach documents. Staff confirm a time.
export default function Meet() {
  const { session } = useAuth();
  const me = session!.user.id;
  const nav = useNavigate();
  const [list, setList] = useState<Req[] | null>(null);
  const [f, setF] = useState({ topic: "", message: "", mode: "", preferred: "" });
  const [files, setFiles] = useState<{ path: string; name: string }[]>([]);
  const [busy, setBusy] = useState(""); const [err, setErr] = useState(""); const [sent, setSent] = useState(false);
  const load = () => supabase.from("meeting_requests").select("id, topic, message, mode, preferred, files, status, meet_at, reply, room_id, created_at").eq("user_id", me)
    .order("created_at", { ascending: false }).then(({ data }) => setList((data ?? []) as Req[]));
  useEffect(() => { load(); }, []);

  async function addFile(file?: File) {
    if (!file) return; setErr("");
    if (files.length >= 3) { setErr("Up to three documents."); return; }
    if (file.size > 10 * 1024 * 1024) { setErr("That file is over 10 MB."); return; }
    setBusy("Uploading…");
    const path = `${me}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
    const { error } = await supabase.storage.from("form-files").upload(path, file, { contentType: file.type || undefined });
    setBusy("");
    if (error) setErr("Upload failed. Check your connection and try again."); else setFiles((x) => [...x, { path, name: file.name }]);
  }
  async function send() {
    setErr("");
    if (!f.topic || !f.message.trim()) { setErr("Choose a topic and tell us a little about it."); return; }
    setBusy("Sending…");
    const { error } = await supabase.from("meeting_requests").insert({ user_id: me, topic: f.topic, message: f.message.trim(), mode: f.mode || null, preferred: f.preferred.trim() || null, files: files.map((x) => x.path) });
    setBusy("");
    if (error) { setErr("Could not send. Try again."); return; }
    setF({ topic: "", message: "", mode: "", preferred: "" }); setFiles([]); setSent(true); load();
  }

  return (
    <section className="view">
      <div className="row" style={{ gap: 12, alignItems: "center" }}>
        <Avatar url={`${import.meta.env.BASE_URL}team/solomon-agbesi.jpg`} name="Solomon Agbesi" size={64} />
        <div><h1 style={{ margin: 0 }}>Meet Solomon</h1><span className="muted">Solomon Agbesi · Founder, BCIL Foundation</span></div>
      </div>
      <p>Want to talk about mentorship, your plan for the year, your studies or career, or working with BCIL? Send a request, say when suits you and attach any documents. We'll confirm a time in the app.</p>

      {sent ? <div className="card planbar"><span>✅ Request sent. You'll get a notification when a time is confirmed.</span><button className="btn ghost sm" onClick={() => setSent(false)}>New request</button></div> : (
        <div className="card meetform">
          <label className="field">What is it about?<select value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}><option value="">Choose…</option>{TOPICS.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="field">Tell us a little more<textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="What would you like to talk about, and what would help most?" maxLength={1500} /></label>
          <label className="field">How would you like to meet?<select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="">Any</option>{MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="field">When suits you?<input value={f.preferred} onChange={(e) => setF({ ...f, preferred: e.target.value })} placeholder="e.g. weekday evenings after 6 pm, or Saturday mornings" maxLength={200} /></label>
          <div className="field"><span>Documents <small className="muted">(optional · CV, plan, proposal · up to 3, 10 MB each)</small></span>
            <div className="fileq">{files.map((x) => <span key={x.path} className="pill sent">📎 {x.name}</span>)}
              {files.length < 3 && <label className="btn ghost sm">{busy === "Uploading…" ? busy : "Attach a file"}<input type="file" hidden accept="application/pdf,image/*,.doc,.docx" onChange={(e) => addFile(e.target.files?.[0])} /></label>}</div>
            <small className="muted">Only BCIL staff can open your documents. They can leave comments on them, which you'll see under My requests.</small></div>
          {err && <p className="err">{err}</p>}
          <button className="btn primary" disabled={!!busy} onClick={send}>{busy === "Sending…" ? busy : "Send request"}</button>
        </div>
      )}

      {list && list.length > 0 && <>
        <h2 style={{ marginTop: 18 }}>My requests</h2>
        <div className="list">{list.map((r) => (
          <div key={r.id}><div className="grow">
            <b>{r.topic}</b> <span className={`pill ${STATUS[r.status]?.[1] ?? ""}`}>{STATUS[r.status]?.[0] ?? r.status}</span>
            {r.status === "confirmed" && r.meet_at && <div>📅 <b>{when(r.meet_at)}</b>{r.mode ? ` · ${r.mode}` : ""}</div>}
            {r.reply && <div className="muted">💬 {r.reply}</div>}
            {r.files?.length > 0 && <div className="row" style={{ gap: 6, flexWrap: "wrap", margin: "4px 0" }}>{r.files.map((p) => (
              <button key={p} className="btn ghost sm" onClick={async () => { try { nav(await docLink(p, fileName(p), "meeting", r.id)); } catch (e) { setErr((e as Error).message); } }}>📄 {fileName(p)} · comments</button>))}</div>}
            <small className="muted">Sent {new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small>
          </div>{r.room_id && r.status === "confirmed" && <Link className="btn ghost sm" to={`/chat?room=${r.room_id}`}>💬 Chat</Link>}</div>
        ))}</div>
      </>}
    </section>
  );
}
