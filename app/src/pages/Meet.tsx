import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { docLink, fileName } from "../lib/docs";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import Avatar from "../components/Avatar";
import { dayKey, googleCalLink, icsFile, timeOf, tzName, type Slot } from "../lib/calendar";

const TOPICS = ["Mentorship", "My 2027 plan", "Career or studies", "Partnership or programme", "Speaking invitation", "Something else"];
const MODES = ["In the app (video)", "In the app (audio)", "WhatsApp"];
type Req = { id: number; topic: string; message: string; mode: string | null; preferred: string | null; files: string[]; status: string; meet_at: string | null; slot_at?: string | null; minutes?: number; reply: string | null; room_id: string | null; created_at: string };
const STATUS: Record<string, [string, string]> = { pending: ["Waiting for a reply", ""], confirmed: ["Confirmed", "paid"], declined: ["Not this time", ""], done: ["Done", "sent"] };
// file types people can attach (Excel and CSV included); the content type is set from the extension because some phones send none
const DOC_TYPES: Record<string, string> = { pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };
const UNDO_SECONDS = 15;
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
  const [review, setReview] = useState(false);   // the "check before you send" sheet
  const [undo, setUndo] = useState<{ id: number; left: number; f: typeof f; files: typeof files; slot: Slot | null } | null>(null);
  useEffect(() => {   // count down the undo window, then it's final
    if (!undo) return;
    if (undo.left <= 0) { setUndo(null); return; }
    const t = setTimeout(() => setUndo((u) => (u ? { ...u, left: u.left - 1 } : u)), 1000);
    return () => clearTimeout(t);
  }, [undo]);
  // Solomon's open times (from his availability), shown in the member's own time zone
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const loadSlots = () => supabase.rpc("meeting_slots", { p_days: 28 }).then(({ data, error }) => setSlots(error ? [] : (data ?? []) as Slot[]));
  useEffect(() => { loadSlots(); }, []);
  const load = () => supabase.from("meeting_requests").select("*").eq("user_id", me)
    .order("created_at", { ascending: false }).then(({ data }) => setList((data ?? []) as Req[]));
  useEffect(() => { load(); }, []);

  async function addFile(file?: File) {
    if (!file) return; setErr("");
    if (files.length >= 3) { setErr("Up to three documents."); return; }
    if (file.size > 10 * 1024 * 1024) { setErr("That file is over 10 MB."); return; }
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!DOC_TYPES[ext]) { setErr("Please attach a PDF, Word, Excel or CSV file, or a picture."); return; }
    setBusy("Uploading…");
    const path = `${me}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
    const { error } = await supabase.storage.from("form-files").upload(path, file, { contentType: DOC_TYPES[ext] });
    setBusy("");
    if (error) setErr("Upload failed. Check your connection and try again."); else setFiles((x) => [...x, { path, name: file.name }]);
  }
  // remove a document before the request is sent (it's deleted from storage too)
  async function removeFile(path: string) {
    setFiles((x) => x.filter((y) => y.path !== path));
    await supabase.storage.from("form-files").remove([path]);
  }
  function check() {   // first step of sending: check the form, then show what will be sent
    setErr("");
    if (!f.topic || !f.message.trim()) { setErr("Choose a topic and tell us a little about it."); return; }
    if (slots && slots.length > 0 && !slot && !f.preferred.trim()) { setErr("Choose a time from the calendar."); return; }
    setReview(true);
  }
  async function undoSend() {
    if (!undo) return;
    const u = undo; setUndo(null); setBusy("Undoing…");
    const { error } = await supabase.rpc("undo_meeting_request", { p_id: u.id });
    setBusy("");
    if (error) { setErr(/too late/i.test(error.message) ? "It's too late to undo this request. Message us from My requests instead." : "Could not undo. Check your connection and try again."); return; }
    setF(u.f); setFiles(u.files); setSlot(u.slot); setSent(false); load(); loadSlots();
  }
  async function send() {
    setReview(false); setErr("");
    setBusy("Sending…");
    const snap = { f, files, slot };
    const { data: made, error } = await supabase.from("meeting_requests").insert({ user_id: me, topic: f.topic, message: f.message.trim(), mode: f.mode || null,
      preferred: f.preferred.trim() || null, files: files.map((x) => x.path), ...(slot ? { slot_at: slot.slot_at, minutes: slot.minutes } : {}) }).select("id").single();
    setBusy("");
    if (error) {
      if (/duplicate|unique/i.test(error.message)) { setErr("Someone has just booked that time. Please choose another."); setSlot(null); loadSlots(); }
      else setErr("Could not send. Try again.");
      return;
    }
    setF({ topic: "", message: "", mode: "", preferred: "" }); setFiles([]); setSlot(null); setSent(true); load(); loadSlots();
    if (made) setUndo({ id: (made as { id: number }).id, left: UNDO_SECONDS, ...snap });
  }

  return (
    <section className="view">
      <div className="row" style={{ gap: 12, alignItems: "center" }}>
        <Avatar url={`${import.meta.env.BASE_URL}team/solomon-agbesi.jpg`} name="Solomon Agbesi" size={64} />
        <div><h1 style={{ margin: 0 }}>Meet Solomon</h1><span className="muted">Solomon Agbesi · Founder, BCIL Foundation</span></div>
      </div>
      <p>Want to talk about mentorship, your plan for the year, your studies or career, or working with BCIL? Pick a time from Solomon's calendar, tell us what it's about and attach any documents. You'll get a notification when it's confirmed.</p>

      {sent ? <div className="card planbar"><span>✅ Request sent. You'll get a notification when a time is confirmed.</span>
        {undo ? <button className="btn primary sm" onClick={undoSend}>↩ Undo ({undo.left}s)</button>
          : <button className="btn ghost sm" disabled={!!busy} onClick={() => setSent(false)}>{busy === "Undoing…" ? busy : "New request"}</button>}</div> : (
        <div className="card meetform">
          <label className="field">What is it about?<select value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}><option value="">Choose…</option>{TOPICS.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="field">Tell us a little more<textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="What would you like to talk about, and what would help most?" maxLength={1500} /></label>
          <label className="field">How would you like to meet?<select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="">Any</option>{MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
          <div className="field"><span>Choose a time <small className="muted">(shown in your time: {tzName()})</small></span>
            {slots === null ? <small className="muted">Loading Solomon's calendar…</small>
              : slots.length === 0 ? <>
                <small className="muted">There are no open times in the next few weeks. Tell us when suits you and we'll find a time.</small>
                <input value={f.preferred} onChange={(e) => setF({ ...f, preferred: e.target.value })} placeholder="e.g. weekday evenings after 6 pm" maxLength={200} aria-label="When suits you" />
              </> : <SlotPicker slots={slots} value={slot} onPick={setSlot} />}
          </div>
          <div className="field"><span>Documents <small className="muted">(optional · CV, plan, proposal, budget · PDF, Word, Excel or pictures · up to 3, 10 MB each)</small></span>
            <div className="fileq">{files.map((x) => <span key={x.path} className="pill sent filepill">📎 {x.name}
                <button type="button" className="filex" onClick={() => removeFile(x.path)} aria-label={`Remove ${x.name}`}>✕</button></span>)}
              {files.length < 3 && <label className="btn ghost sm">{busy === "Uploading…" ? busy : "Attach a file"}<input type="file" hidden accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.csv" onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ""; }} /></label>}</div>
            <small className="muted">Only Solomon (and anyone he asks to help) can open your documents. Comments on them appear under My requests.</small></div>
          {err && <p className="err">{err}</p>}
          <button className="btn primary" disabled={!!busy} onClick={check}>{busy === "Sending…" ? busy : "Send request"}</button>
        </div>
      )}

      {review && <div className="sheet-back" role="dialog" aria-modal="true" aria-labelledby="mreview-h" onClick={() => setReview(false)}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <h2 id="mreview-h">Check your request</h2>
          <p className="muted">This is what Solomon will get. You can't change or remove the documents after you send it.</p>
          <dl className="mreview">
            <dt>About</dt><dd>{f.topic}</dd>
            <dt>Message</dt><dd style={{ whiteSpace: "pre-wrap" }}>{f.message.trim()}</dd>
            <dt>How</dt><dd>{f.mode || "Any"}</dd>
            <dt>When</dt><dd>{slot ? `${dayKey(slot.slot_at)}, ${timeOf(slot.slot_at)} (${slot.minutes} minutes)` : f.preferred.trim() || "—"}</dd>
            <dt>Documents</dt><dd>{files.length ? files.map((x) => <div key={x.path}>📎 {x.name}</div>) : "None"}</dd>
          </dl>
          <button className="btn primary block" onClick={send}>Send request</button>
          <button className="btn ghost block" onClick={() => setReview(false)}>Go back and edit</button>
        </div>
      </div>}

      {list && list.length > 0 && <>
        <h2 style={{ marginTop: 18 }}>My requests</h2>
        <div className="list">{list.map((r) => (
          <div key={r.id}><div className="grow">
            <b>{r.topic}</b> <span className={`pill ${STATUS[r.status]?.[1] ?? ""}`}>{STATUS[r.status]?.[0] ?? r.status}</span>
            {r.status === "pending" && r.slot_at && <div className="muted">🕒 You asked for <b>{when(r.slot_at)}</b></div>}
            {r.status === "confirmed" && r.meet_at && <div>📅 <b>{when(r.meet_at)}</b>{r.mode ? ` · ${r.mode}` : ""}
              {new Date(r.meet_at) > new Date() && <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                <a className="btn ghost sm" target="_blank" rel="noopener" href={googleCalLink({ title: `Meeting with Solomon Agbesi (BCIL): ${r.topic}`, start: r.meet_at, minutes: r.minutes, details: [r.reply, r.mode && `How: ${r.mode}`].filter(Boolean).join("\n"), location: r.mode ?? "" })}>📅 Add to Google Calendar</a>
                <button className="btn ghost sm" onClick={() => icsFile({ uid: `meet-${r.id}@bcilfoundation.org`, title: `Meeting with Solomon Agbesi (BCIL): ${r.topic}`, start: r.meet_at!, minutes: r.minutes, details: r.reply ?? "", location: r.mode ?? "" })}>Other calendar</button>
              </div>}</div>}
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

// Solomon's open times, grouped by day, in the member's time zone
function SlotPicker({ slots, value, onPick }: { slots: Slot[]; value: Slot | null; onPick: (s: Slot) => void }) {
  const days: [string, Slot[]][] = [];
  for (const s of slots) { const k = dayKey(s.slot_at); const d = days.find((x) => x[0] === k); if (d) d[1].push(s); else days.push([k, [s]]); }
  const [show, setShow] = useState(4);
  return (
    <div className="slotpicker">
      {days.slice(0, show).map(([day, list]) => (
        <div key={day} className="slotday">
          <b>{day}</b>
          <div className="chips">{list.map((s) => (
            <button key={s.slot_at} type="button" className="chip" aria-pressed={value?.slot_at === s.slot_at} onClick={() => onPick(s)}>{timeOf(s.slot_at)}</button>))}</div>
        </div>
      ))}
      {days.length > show && <button type="button" className="linkbtn" onClick={() => setShow((n) => n + 4)}>Show more days</button>}
      {value && <small>Selected: <b>{dayKey(value.slot_at)}, {timeOf(value.slot_at)}</b> ({value.minutes} minutes)</small>}
    </div>
  );
}
