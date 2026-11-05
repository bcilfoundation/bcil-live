import type { Field } from "./Forms";
import FormBuilder from "../components/FormBuilder";
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import AddAudioTalk from "../components/AddAudioTalk";

const TABS = ["Engagement", "Daily Bite", "Live sessions", "Talks", "Forms", "Mentorship", "Gifts", "Reports", "People"] as const;
type Tab = (typeof TABS)[number];
const PROGRAMS = ["Finding Campus Balance", "Operation 4.0", "Beyond Junior High", "Academic Mentorship", "Daily Bites", "Live sessions"];
const cedis = (p: number) => `GH₵ ${(p / 100).toLocaleString("en-GH")}`;
const fmt = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function Admin() {
  const { profile, setViewAsMember } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("Engagement");
  if (profile?.role !== "admin" && profile?.role !== "moderator")
    return <section className="view"><h1>Admin</h1><div className="empty"><b>Admins only</b>Ask a BCIL admin to give you access.</div></section>;
  const isAdmin = profile.role === "admin";
  const tabs = isAdmin ? TABS : (["Engagement", "Reports"] as const);
  return (
    <section className="view">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}><h1>Admin</h1>
        <span className="row" style={{ gap: 8 }}><button className="btn ghost" onClick={() => { setViewAsMember(true); navigate("/"); }}>👁 View as member</button>
        <Link className="btn primary" to="/checkin">📷 Scan tickets</Link></span></div>
      <div className="chips">{tabs.map((t) => <button key={t} className="chip" aria-pressed={t === tab} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === "Daily Bite" && isAdmin && <QuotesAdmin />}
      {tab === "Live sessions" && isAdmin && <LiveAdmin />}
      {tab === "Talks" && isAdmin && <TalksAdmin />}
      {tab === "Forms" && isAdmin && <FormsAdmin />}
      {tab === "Mentorship" && isAdmin && <MentorshipAdmin />}
      {tab === "Gifts" && isAdmin && <GiftsAdmin />}
      {tab === "Engagement" && <EngagementAdmin />}
      {(tab === "Reports" || (!isAdmin && tab !== "Engagement")) && <ReportsAdmin />}
      {tab === "People" && isAdmin && <PeopleAdmin />}
    </section>
  );
}

function QuotesAdmin() {
  const [rows, setRows] = useState<{ id: number; show_on: string; body: string; author: string }[]>([]);
  const [f, setF] = useState({ show_on: new Date().toISOString().slice(0, 10), body: "", author: "BCIL Foundation", reflection: "" });
  const [msg, setMsg] = useState("");
  // admins see future quotes too (the read rule hides them from members)
  const load = () => supabase.from("quotes").select("id, show_on, body, author").order("show_on", { ascending: false }).limit(60).then(({ data }) => setRows(data ?? []));
  useEffect(() => { load(); }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.body.trim()) { setMsg("Write the bite first."); return; }
    let { error } = await supabase.from("quotes").upsert({ ...f, body: f.body.trim(), reflection: f.reflection || null }, { onConflict: "show_on" });
    // older database (before categories were removed) still needs a theme
    if (error && /theme/i.test(error.message)) ({ error } = await supabase.from("quotes").upsert({ ...f, body: f.body.trim(), theme: "Impact", reflection: f.reflection || null }, { onConflict: "show_on" }));
    setMsg(error ? error.message : "Saved."); if (!error) { setF({ ...f, body: "", reflection: "" }); load(); }
  }
  return (<>
    <form className="card" onSubmit={save}>
      <h3>Add a Daily Bite</h3>
      <label className="field">Show on<input type="date" value={f.show_on} onChange={(e) => setF({ ...f, show_on: e.target.value })} /></label>
      <label className="field">Bite<textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      <label className="field">Author<input value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} /></label>
      <label className="field">Reflection (optional)<input value={f.reflection} onChange={(e) => setF({ ...f, reflection: e.target.value })} placeholder="A short action for today" /></label>
      <p className="muted">{msg}</p>
      <button className="btn primary">Save bite</button>
    </form>
    <div className="list">{rows.map((r) => <div key={r.id}><div className="grow"><b>{r.show_on}</b><br /><small className="muted">“{r.body}” — {r.author}</small></div>
      <button className="linkbtn" onClick={async () => { await supabase.from("quotes").delete().eq("id", r.id); load(); }}>Delete</button></div>)}</div>
  </>);
}

function LiveAdmin() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<{ id: string; title: string; starts_at: string; status: string }[]>([]);
  const [f, setF] = useState({ title: "", topic: "", starts_at: "" });
  const load = () => supabase.from("live_sessions").select("id, title, starts_at, status").order("starts_at", { ascending: false }).limit(30).then(({ data }) => setRows(data ?? []));
  useEffect(() => { load(); }, []);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.title || !f.starts_at) return;
    await supabase.from("live_sessions").insert({ title: f.title, topic: f.topic || null, starts_at: new Date(f.starts_at).toISOString(), host_id: session!.user.id });
    setF({ title: "", topic: "", starts_at: "" }); load();
  }
  const set = async (id: string, status: string) => {
    if (status === "live" && !window.confirm("Go live now?\n\nEveryone with the app will be notified and the room opens straight away.")) return;
    const patch = status === "live" ? { status, starts_at: new Date().toISOString(), host_id: session!.user.id } : { status };
    const { error } = await supabase.from("live_sessions").update(patch).eq("id", id);
    if (error) { alert("Could not update the session: " + error.message); return; }
    if (status === "live") navigate("/live", { state: { autostart: true } }); else load();
  };
  return (<>
    <form className="card" onSubmit={add}>
      <h3>Schedule a live session</h3>
      <label className="field">Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Mentorship hour: Planning your semester" /></label>
      <label className="field">Topic (optional)<input value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} /></label>
      <label className="field">Starts<input type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></label>
      <button className="btn primary">Schedule</button>
    </form>
    <div className="list">{rows.map((r) => <div key={r.id}><div className="grow"><b>{r.title}</b><br /><small className="muted">{fmt(r.starts_at)} · {r.status}</small></div>
      {r.status === "scheduled" && <button className="btn primary" onClick={() => set(r.id, "live")}>Go live</button>}
      {r.status === "live" && <button className="btn ghost" onClick={() => set(r.id, "ended")}>End</button>}</div>)}</div>
    <p className="muted">Tip: you can also go live straight from the Live tab without scheduling.</p>
  </>);
}

function youtubeId(link: string) {
  const m = link.match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : /^[\w-]{11}$/.test(link.trim()) ? link.trim() : null;
}
function TalksAdmin() {
  const [rows, setRows] = useState<{ id: string; title: string; program: string | null; youtube_id: string | null; kind: string }[]>([]);
  const [f, setF] = useState({ link: "", title: "", program: "", published_on: "" });
  const [msg, setMsg] = useState("");
  const load = () => supabase.from("talks").select("id, title, program, youtube_id, kind").order("created_at", { ascending: false }).then(({ data }) => setRows(data ?? []));
  useEffect(() => { load(); }, []);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const id = youtubeId(f.link);
    if (!id) { setMsg("Paste a YouTube link, for example https://youtu.be/…"); return; }
    if (!f.title.trim()) { setMsg("Add a title."); return; }
    const { error } = await supabase.from("talks").insert({ youtube_id: id, title: f.title.trim(), program: f.program.trim() || null, published_on: f.published_on || null });
    setMsg(error ? error.message : "Added to the Library."); if (!error) { setF({ ...f, link: "", title: "" }); load(); }
  }
  return (<>
    <form className="card" onSubmit={add}>
      <h3>Add a talk from YouTube</h3>
      <label className="field">YouTube link<input value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://youtu.be/…" /></label>
      <label className="field">Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <div className="grid2">
        <label className="field">Programme or type (optional)<input list="programs" value={f.program} onChange={(e) => setF({ ...f, program: e.target.value })} /><datalist id="programs">{PROGRAMS.map((p) => <option key={p} value={p} />)}</datalist></label>
        <label className="field">Date (optional)<input type="date" value={f.published_on} onChange={(e) => setF({ ...f, published_on: e.target.value })} /></label>
      </div>
      <p className="muted">{msg}</p>
      <button className="btn primary">Add talk</button>
    </form>
    <AddAudioTalk onSaved={load} />
    <div className="list">{rows.map((r) => <div key={r.id}><div className="grow"><b>{r.title}</b><br /><small className="muted">{r.kind === "audio" ? "🎧 Audio" : "▶ YouTube"}{r.program ? ` · ${r.program}` : ""}</small></div>
      <button className="linkbtn" onClick={async () => { if (window.confirm(`Remove “${r.title}” from the Library?`)) { await supabase.from("talks").delete().eq("id", r.id); load(); } }}>Remove</button></div>)}</div>
  </>);
}

type FormRow = { id: string; slug: string; title: string; subtitle: string | null; description: string | null; sensitive?: boolean; fields: Field[]; is_open: boolean; fee_pesewas: number | null; fee_label: string | null; fee_required: boolean };
type RespRow = { id: number; answers: Record<string, string>; status: string; created_at: string; paid_at: string | null; checked_in_at: string | null; review_score?: number | null; review_note?: string | null; profiles: { full_name: string } | null };

// the selection committee's score (out of 100; 60 to be considered) and notes on an application
function Review({ r, reload }: { r: RespRow; reload: () => void }) {
  const [score, setScore] = useState(r.review_score?.toString() ?? ""); const [note, setNote] = useState(r.review_note ?? ""); const [saved, setSaved] = useState(false);
  const dirty = score !== (r.review_score?.toString() ?? "") || note !== (r.review_note ?? "");
  async function save() {
    const n = score === "" ? null : Math.max(0, Math.min(100, Number(score)));
    await supabase.from("form_responses").update({ review_score: n, review_note: note.trim() || null }).eq("id", r.id);
    setSaved(true); setTimeout(() => setSaved(false), 1500); reload();
  }
  return (<div className="review row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
    <label className="small">Score <input type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} style={{ width: 70 }} aria-label="Score out of 100" /> / 100</label>
    {r.review_score != null && <span className={`pill ${r.review_score >= 60 ? "paid" : ""}`}>{r.review_score >= 60 ? "Meets 60" : "Below 60"}</span>}
    <input placeholder="Committee notes" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: "1 1 200px" }} aria-label="Committee notes" />
    <button className="btn ghost sm" disabled={!dirty} onClick={save}>{saved ? "Saved ✓" : "Save"}</button>
  </div>);
}

function FormsAdmin() {
  const [forms, setForms] = useState<FormRow[]>([]);
  const [formId, setFormId] = useState("");
  const [rows, setRows] = useState<RespRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState<"new" | "edit" | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const loadForms = () => supabase.from("forms").select("id, slug, title, subtitle, description, sensitive, fields, is_open, fee_pesewas, fee_label, fee_required").order("created_at")
    .then(({ data }) => { setForms((data ?? []) as FormRow[]); setFormId((cur) => cur || data?.[0]?.id || ""); });
  useEffect(() => { loadForms(); }, []);
  const load = async () => {
    if (!formId) return;
    const q = (cols: string) => supabase.from("form_responses").select(cols).eq("form_id", formId).order("created_at", { ascending: false });
    let { data, error } = await q("id, answers, status, created_at, paid_at, checked_in_at, review_score, review_note, profiles(full_name)");
    if (error) ({ data } = await q("id, answers, status, created_at, paid_at, checked_in_at, profiles(full_name)"));   // before migration 037
    setRows((data ?? []) as unknown as RespRow[]);
  };
  useEffect(() => { load(); }, [formId]);
  const found = forms.find((f) => f.id === formId);
  const form = found && { ...found, fields: found.fields.filter((f) => f.type !== "section") };
  // the programme this form registers people for (certificates are released per programme)
  const [ev, setEv] = useState<{ slug: string; title: string; certificates_open: boolean; volunteer_form_slug?: string | null } | null>(null);
  const loadEv = () => found && supabase.from("event_pages").select("slug, title, certificates_open, volunteer_form_slug")
    .or(`form_slug.eq.${found.slug},volunteer_form_slug.eq.${found.slug}`).limit(1).maybeSingle().then(({ data }) => setEv(data as never));
  useEffect(() => { setEv(null); loadEv(); }, [found?.slug]);
  const isVol = !!ev && ev.volunteer_form_slug === found?.slug;   // this is the programme's volunteer form
  const wantsCert = (r: RespRow) => isVol || (r.answers.certificate ?? "Yes") === "Yes";
  const certReady = (r: RespRow) => !!r.checked_in_at && wantsCert(r) && (isVol || !form?.fee_pesewas || !!r.paid_at);
  const markServed = async (r: RespRow) => {
    await supabase.from("form_responses").update({ checked_in_at: r.checked_in_at ? null : new Date().toISOString() }).eq("id", r.id); load();
  };
  async function toggleCerts() {
    if (!ev) return;
    if (!ev.certificates_open && !window.confirm(`Release certificates for ${ev.title}? ${rows.filter(certReady).length} people can then download theirs from the app or their ticket link.`)) return;
    await supabase.from("event_pages").update({ certificates_open: !ev.certificates_open }).eq("slug", ev.slug);
    loadEv();
  }
  const markPaid = async (r: RespRow) => {
    if (!r.paid_at && !window.confirm(`Mark the ${form?.fee_label?.toLowerCase() || "fee"} as paid for ${r.answers.full_name || r.profiles?.full_name || "this person"}? Only do this once you've seen the Mobile Money payment.`)) return;
    await supabase.from("form_responses").update({ paid_at: r.paid_at ? null : new Date().toISOString() }).eq("id", r.id); load();
  };

  // Download every response as an Excel file, like Google Forms' "Download responses"
  async function downloadExcel() {
    if (!form) return;
    setBusy(true);
    try {
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      const head = ["Timestamp", "Account name", "Status", ...(form.fee_pesewas ? ["Paid"] : []), "Checked in", ...form.fields.map((f) => f.label)]
        .map((value) => ({ value, fontWeight: "bold" as const, backgroundColor: "#e3ebf6", wrap: true }));
      const body = [...rows].reverse().map((r) => [
        { value: new Date(r.created_at), type: Date, format: "dd/mm/yyyy hh:mm" },
        { value: r.profiles?.full_name ?? "" },
        { value: r.status },
        ...(form.fee_pesewas ? [{ value: r.paid_at ? "Yes" : "No" }] : []),
        { value: r.checked_in_at ? "Yes" : "" },
        ...form.fields.map((f) => ({ value: String(r.answers[f.key] ?? "") })),
      ]);
      const safe = form.title.replace(/[^a-z0-9]+/gi, " ").trim();
      await writeXlsxFile([head, ...body] as never, {
        sheet: "Responses", stickyRowsCount: 1,
        columns: [{ width: 18 }, { width: 24 }, { width: 12 }, ...(form.fee_pesewas ? [{ width: 8 }] : []), { width: 10 }, ...form.fields.map(() => ({ width: 30 }))],
      }).toFile(`${safe} (Responses).xlsx`);
    } finally { setBusy(false); }
  }
  async function toggleOpen() {
    if (!form) return;
    await supabase.from("forms").update({ is_open: !form.is_open }).eq("id", form.id);
    loadForms();
  }
  const setStatus = async (id: number, status: string) => { await supabase.from("form_responses").update({ status }).eq("id", id); load(); };
  if (showQr && found) return <FormQr form={found} close={() => setShowQr(false)} />;
  if (building) return <FormBuilder form={building === "edit" && found ? found : null} close={() => setBuilding(null)}
    saved={(id) => { setBuilding(null); setFormId(id); loadForms(); }} />;
  const copyLink = async () => {
    if (!found) return;
    await navigator.clipboard?.writeText(`${location.origin}${import.meta.env.BASE_URL}forms?form=${found.slug}`).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  return (<>
    <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
      <button className="btn primary" onClick={() => setBuilding("new")}>+ New form</button>
      {found && <button className="btn ghost" onClick={() => setBuilding("edit")}>✏️ Edit this form</button>}
      {found && <button className="btn ghost" onClick={copyLink}>{copied ? "Link copied ✓" : "🔗 Copy form link"}</button>}
      {found && <button className="btn ghost" onClick={() => setShowQr(true)}>📱 QR codes</button>}
    </div>
    <div className="row" style={{ flexWrap: "wrap" }}>
      <select value={formId} onChange={(e) => setFormId(e.target.value)} aria-label="Form" style={{ maxWidth: 360 }}>
        {forms.map((f) => <option key={f.id} value={f.id}>{f.title}{f.is_open ? "" : " (closed)"}</option>)}</select>
      <span className="muted">{rows.length} responses</span>
      <button className="btn primary" onClick={downloadExcel} disabled={busy || !rows.length}>{busy ? "Preparing…" : "Download Excel"}</button>
      {form && <button className="btn ghost" onClick={toggleOpen}>{form.is_open ? "Close form" : "Reopen form"}</button>}
    </div>
    {form && !form.is_open && <p className="muted">This form is closed. Members can no longer see or fill it in.</p>}
    {ev && <div className="card certadmin">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span><b>🎓 {isVol ? "Volunteer certificates" : "Certificates"}</b> · {rows.filter(certReady).length} ready{!isVol && form?.fee_pesewas ? ` · ${rows.filter((r) => r.checked_in_at && wantsCert(r) && !r.paid_at).length} checked in but fee not paid` : ""}{isVol ? ` · ${rows.length - rows.filter(certReady).length} not marked as served` : ""}</span>
        <button className={`btn ${ev.certificates_open ? "ghost" : "primary"} sm`} onClick={toggleCerts}>{ev.certificates_open ? "Hide certificates" : "Release certificates"}</button>
      </div>
      <small className="muted">{isVol
        ? (ev.certificates_open ? `Released for ${ev.title}: volunteers who served can download theirs now.` : `Volunteers who are checked in on the day (scan their ticket, or tap "Mark served" below) get one. Releasing here releases all ${ev.title} certificates.`)
        : (ev.certificates_open ? "Released: people who were checked in (and paid, if they asked for a certificate) can download theirs now." : "Release them after the programme. Only people checked in at the venue get one.")}</small>
    </div>}
    {form && <FeeEditor form={form} onSaved={loadForms} paid={rows.filter((r) => r.paid_at).length} total={rows.length} checkedIn={rows.filter((r) => r.checked_in_at).length} />}
    <div className="list">{rows.map((r) => (
      <div key={r.id}><div className="grow">
        <b>{r.answers.full_name || r.answers.name || r.profiles?.full_name || "Member"}</b> <small className="muted">· {fmt(r.created_at)}</small>
        {form?.fee_pesewas ? (r.paid_at ? <span className="pill paid" style={{ marginLeft: 6 }}>Paid</span> : <span className="pill" style={{ marginLeft: 6 }}>Not paid</span>) : null}
        {r.checked_in_at && <span className="pill sent" style={{ marginLeft: 6 }}>{isVol ? "Served" : "Checked in"}</span>}
        {isVol && <button className="linkbtn" style={{ marginLeft: 8 }} onClick={() => markServed(r)}>{r.checked_in_at ? "Undo served" : "Mark served"}</button>}
        {ev && certReady(r) && <span className="pill paid" style={{ marginLeft: 6 }}>🎓 Certificate</span>}
        {form?.fee_pesewas && wantsCert(r) ? <button className="linkbtn" style={{ marginLeft: 8 }} onClick={() => markPaid(r)}>{r.paid_at ? "Undo paid" : "Mark paid"}</button> : null}
        {form?.fields.filter((f) => !/full_name|^name$/.test(f.key)).map((f) => r.answers[f.key] ? <div key={f.key}><small className="muted">{f.label}:</small> {f.type === "file"
          ? <button className="linkbtn" onClick={async () => { const { data } = await supabase.storage.from("form-files").createSignedUrl(r.answers[f.key], 600); if (data) window.open(data.signedUrl, "_blank", "noopener"); }}>📎 Open file</button>
          : r.answers[f.key]}</div> : null)}
        {form?.slug.startsWith("student-support") && <Review r={r} reload={load} />}
      </div>
        <select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)} aria-label="Status" style={{ width: 130 }}>{["received", "accepted", "waitlist", "declined"].map((s) => <option key={s}>{s}</option>)}</select></div>
    ))}</div>
  </>);
}

function GiftsAdmin() {
  const [rows, setRows] = useState<{ id: number; amount_pesewas: number; purpose: string; method: string; status: string; created_at: string; kind?: string; under_18?: boolean; profiles?: { full_name: string } | null }[]>([]);
  useEffect(() => { supabase.from("gifts").select("id, amount_pesewas, purpose, method, status, created_at, kind, under_18, profiles(full_name)").order("created_at", { ascending: false }).limit(300).then(({ data }) => setRows((data ?? []) as never)); }, []);
  const paid = rows.filter((r) => r.status === "paid" || r.status === "recorded");
  const total = paid.reduce((s, r) => s + r.amount_pesewas, 0);
  const liveGifts = paid.filter((r) => r.kind === "live_gift").reduce((n, r) => n + r.amount_pesewas, 0);
  const byPurpose = Object.entries(paid.reduce<Record<string, number>>((m, r) => ({ ...m, [r.purpose]: (m[r.purpose] ?? 0) + r.amount_pesewas }), {})).sort((a, b) => b[1] - a[1]);
  return (<>
    <div className="grid2">
      <div className="card"><span className="muted">Received (paid + recorded)</span><b className="big">{cedis(total)}</b><small className="muted">{paid.length} gifts · {cedis(liveGifts)} from live gifts · FCB 2027 goal GH₵ 47,000</small></div>
      <div className="card"><span className="muted">By purpose</span>{byPurpose.map(([p, v]) => <div key={p} className="row"><span className="grow">{p}</span><b>{cedis(v)}</b></div>)}</div>
    </div>
    <div className="list">{rows.map((r) => <div key={r.id}><div className="grow"><b>{cedis(r.amount_pesewas)}</b> · {r.purpose}<br /><small className="muted">{r.profiles?.full_name ?? "Member"}{r.under_18 ? " (under 18, guardian confirmed)" : ""} · {r.method.replace("_", " ")} · {fmt(r.created_at)}</small></div><span className={`pill ${r.status}`}>{r.status}</span></div>)}</div>
  </>);
}

function ReportsAdmin() {
  const [rows, setRows] = useState<{ id: number; target_type: string; target_id: string; reason: string | null; created_at: string }[]>([]);
  const [preview, setPreview] = useState<Record<number, string>>({});
  const load = () => supabase.from("reports").select("*").eq("resolved", false).order("created_at").then(async ({ data }) => {
    setRows(data ?? []);
    const p: Record<number, string> = {};
    for (const r of data ?? []) {
      const table = r.target_type === "message" ? "messages" : r.target_type === "comment" ? "talk_comments" : r.target_type === "live_chat" ? "live_chat" : null;
      if (table) { const { data: m } = await supabase.from(table).select("body").eq("id", Number(r.target_id)).maybeSingle(); p[r.id] = m?.body ?? "(deleted)"; }
    }
    setPreview(p);
  });
  useEffect(() => { load(); }, []);
  async function act(r: { id: number; target_type: string; target_id: string }, hide: boolean) {
    const table = r.target_type === "message" ? "messages" : r.target_type === "comment" ? "talk_comments" : "live_chat";
    if (hide && r.target_type !== "user") await supabase.from(table).update({ hidden: true }).eq("id", Number(r.target_id));
    await supabase.from("reports").update({ resolved: true }).eq("id", r.id); load();
  }
  return rows.length ? <div className="list">{rows.map((r) => (
    <div key={r.id}><div className="grow"><b>{r.target_type.replace("_", " ")}</b> <small className="muted">{fmt(r.created_at)}</small><p>“{preview[r.id] ?? "…"}”</p></div>
      <button className="btn primary" onClick={() => act(r, true)}>Hide it</button><button className="btn ghost" onClick={() => act(r, false)}>Keep</button></div>
  ))}</div> : <div className="empty"><b>No open reports</b></div>;
}

function PeopleAdmin() {
  const [rows, setRows] = useState<{ id: string; full_name: string; phone: string | null; role: string; is_minor: boolean }[]>([]);
  const [q, setQ] = useState("");
  const load = () => supabase.from("profiles").select("id, full_name, phone, role, is_minor").order("created_at", { ascending: false }).limit(200).then(({ data }) => setRows(data ?? []));
  useEffect(() => { load(); }, []);
  const update = async (id: string, patch: Record<string, unknown>) => { await supabase.from("profiles").update(patch).eq("id", id); load(); };
  const [nl, setNl] = useState("");
  async function newsletterList() {
    setNl("Preparing…");
    const { data, error } = await supabase.rpc("newsletter_list");
    if (error) { setNl("Couldn't load the list."); return; }
    const list = (data ?? []) as { full_name: string; email: string; joined: string }[];
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    await writeXlsxFile([[{ value: "Name", fontWeight: "bold" }, { value: "Email", fontWeight: "bold" }, { value: "Joined", fontWeight: "bold" }],
      ...list.map((r) => [{ value: r.full_name }, { value: r.email }, { value: r.joined }])] as never,
      { sheet: "Newsletter", columns: [{ width: 28 }, { width: 34 }, { width: 12 }] }).toFile("BCIL newsletter list (app members).xlsx");
    setNl(`${list.length} app member${list.length === 1 ? "" : "s"} on the list. Website sign-ups are in WordPress → SureForms → Entries.`);
  }
  return (<>
    <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
      <button className="btn ghost sm" onClick={newsletterList}>📬 Download newsletter list</button>
      {nl && <small className="muted">{nl}</small>}
    </div>
    <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone" aria-label="Search people" />
    <div className="list">{rows.filter((r) => (r.full_name + (r.phone ?? "")).toLowerCase().includes(q.toLowerCase())).map((r) => (
      <div key={r.id}><div className="grow"><b>{r.full_name || "No name"}</b><br /><small className="muted">{r.phone}</small></div>
        <label className="row" style={{ fontSize: ".85rem" }}><input type="checkbox" checked={r.is_minor} onChange={(e) => update(r.id, { is_minor: e.target.checked })} style={{ width: "auto" }} /> Under 18</label>
        <select value={r.role} onChange={(e) => update(r.id, { role: e.target.value })} aria-label="Role" style={{ width: 130 }}>{["member", "mentor", "moderator", "admin"].map((x) => <option key={x}>{x}</option>)}</select></div>
    ))}</div>
  </>);
}

// A fee on a form (e.g. FCB certificate). Members pay after submitting; paid responses are marked automatically.
function FeeEditor({ form, onSaved, paid, total, checkedIn }: { form: FormRow; onSaved: () => void; paid: number; total: number; checkedIn: number }) {
  const [amount, setAmount] = useState(form.fee_pesewas ? String(form.fee_pesewas / 100) : "");
  const [label, setLabel] = useState(form.fee_label ?? "Certificate fee");
  const [required, setRequired] = useState(form.fee_required);
  const [msg, setMsg] = useState("");
  useEffect(() => { setAmount(form.fee_pesewas ? String(form.fee_pesewas / 100) : ""); setLabel(form.fee_label ?? "Certificate fee"); setRequired(form.fee_required); setMsg(""); }, [form.id]);
  const save = async () => {
    const n = Number(amount);
    if (amount && !(n >= 1)) { setMsg("The smallest fee is GH₵ 1."); return; }
    const { error } = await supabase.from("forms").update({ fee_pesewas: amount ? Math.round(n * 100) : null, fee_label: label.trim() || null, fee_required: required }).eq("id", form.id);
    setMsg(error ? error.message : amount ? "Saved. Members will be asked to pay after they submit." : "Fee removed."); onSaved();
  };
  return (
    <div className="card feeeditor">
      <b>💳 Fee for this form</b>
      <div className="grid2">
        <label className="field">What is it for?<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Certificate fee" /></label>
        <label className="field">Amount (GH₵), leave empty for no fee<input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="e.g. 20" /></label>
      </div>
      <label className="choice"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Payment is required (not optional)</label>
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn primary sm" onClick={save}>Save fee</button>
        {form.fee_pesewas ? <span className="muted">{paid} of {total} paid · {checkedIn} checked in</span> : checkedIn ? <span className="muted">{checkedIn} checked in</span> : null}
      </div>
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}

// Who is engaging: listening to talks, attending live sessions, reading and liking quotes
type Lead = { user_id: string; name: string; avatar_url: string | null; listen_minutes: number; talks_finished: number; live_minutes: number; live_sessions: number; quotes_read: number; quote_likes: number; days_active: number; score: number };
type TalkStat = { talk_id: string; title: string; kind: string; listeners: number; minutes: number; finished: number };
type QuoteStat = { quote_id: number; show_on: string; body: string; reads: number; likes: number };
function EngagementAdmin() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [talks, setTalks] = useState<TalkStat[]>([]);
  const [quotes, setQuotes] = useState<QuoteStat[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    setRows(null); setErr("");
    Promise.all([
      supabase.rpc("engagement_leaderboard", { p_days: days }),
      supabase.rpc("talk_stats", { p_days: days }),
      supabase.rpc("quote_stats", { p_days: Math.min(days, 30) }),
    ]).then(([l, t, q]) => {
      if (l.error) setErr(l.error.message);
      setRows((l.data ?? []) as Lead[]); setTalks((t.data ?? []) as TalkStat[]); setQuotes((q.data ?? []) as QuoteStat[]);
    });
  }, [days]);
  const sum = (k: keyof Lead) => (rows ?? []).reduce((n, r) => n + Number(r[k] || 0), 0);
  const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  async function download() {
    if (!rows) return;
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    const head = ["Rank", "Name", "Score", "Talk listening (min)", "Talks finished", "Live sessions (min)", "Live sessions joined", "Quotes read", "Quote likes", "Active days"]
      .map((value) => ({ value, fontWeight: "bold" as const, backgroundColor: "#e3ebf6" }));
    const body = rows.map((r, i) => [i + 1, r.name, r.score, r.listen_minutes, r.talks_finished, r.live_minutes, r.live_sessions, r.quotes_read, r.quote_likes, r.days_active].map((value) => ({ value })));
    await writeXlsxFile([head, ...body] as never, { sheet: "Engagement", stickyRowsCount: 1, columns: [{ width: 6 }, { width: 28 }, ...Array(8).fill({ width: 14 })] })
      .toFile(`BCIL Foundation engagement (last ${days} days).xlsx`);
  }
  return (<>
    <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <div className="chips">{[7, 30, 90, 365].map((d) => <button key={d} className="chip" aria-pressed={d === days} onClick={() => setDays(d)}>{d === 365 ? "This year" : `Last ${d} days`}</button>)}</div>
      <button className="btn ghost sm" onClick={download} disabled={!rows?.length}>Download Excel</button>
    </div>
    {err && <p className="err">{err}</p>}
    <div className="statgrid">
      <div className="card"><span className="muted">People engaging</span><b className="big">{rows?.length ?? "…"}</b></div>
      <div className="card"><span className="muted">Talk listening</span><b className="big">{hours(sum("listen_minutes"))}</b><small className="muted">{sum("talks_finished")} talks finished</small></div>
      <div className="card"><span className="muted">Live sessions</span><b className="big">{hours(sum("live_minutes"))}</b><small className="muted">{sum("live_sessions")} attendances</small></div>
      <div className="card"><span className="muted">Quotes</span><b className="big">{sum("quotes_read")}</b><small className="muted">reads · {sum("quote_likes")} likes</small></div>
    </div>

    <h2>🏆 Leaderboard</h2>
    <p className="muted small">Score = minutes listening to talks + minutes in live sessions + 5 per talk finished + 2 per quote read + 1 per quote liked.</p>
    {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="empty"><b>No activity yet in this period</b>Listening, live sessions and quote reads will show here.</div> : (
      <div className="leaders">{rows.slice(0, 50).map((r, i) => (
        <div key={r.user_id} className={`leader${i < 3 ? " top" : ""}`}>
          <span className="rank">{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
          <div className="grow"><b>{r.name || "Member"}</b>
            <small className="muted">🎧 {hours(r.listen_minutes)}{r.talks_finished ? ` · ${r.talks_finished} finished` : ""} · 🔴 {hours(r.live_minutes)} live · 💬 {r.quotes_read} quotes{r.quote_likes ? ` · ❤️ ${r.quote_likes}` : ""} · {r.days_active} active day{r.days_active === 1 ? "" : "s"}</small></div>
          <span className="score">{r.score}</span>
        </div>
      ))}</div>
    )}

    <div className="grid2" style={{ marginTop: 16 }}>
      <div><h2>Most listened talks</h2>
        {talks.length ? <div className="list">{talks.slice(0, 10).map((t) => (
          <div key={t.talk_id}><div className="grow"><b>{t.title}</b><br /><small className="muted">{t.kind === "audio" ? `${t.listeners} listener${t.listeners === 1 ? "" : "s"} · ${hours(t.minutes)} · ${t.finished} finished` : `${t.listeners} opened (video)`}</small></div></div>
        ))}</div> : <p className="muted">No listening yet.</p>}
      </div>
      <div><h2>Quotes</h2>
        {quotes.length ? <div className="list">{quotes.slice(0, 10).map((q) => (
          <div key={q.quote_id}><div className="grow"><small className="muted">{new Date(q.show_on + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small><br />“{q.body.length > 90 ? q.body.slice(0, 90) + "…" : q.body}”</div>
            <span className="pill">👁 {q.reads}</span><span className="pill">❤️ {q.likes}</span></div>
        ))}</div> : <p className="muted">No quotes in this period.</p>}
      </div>
    </div>
  </>);
}

// QR codes for a form: one to share (people register with or without an account) and one for the venue
// (people who register there are checked in straight away)
function FormQr({ form, close }: { form: { id: string; slug: string; title: string }; close: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [imgs, setImgs] = useState<{ share?: string; walk?: string }>({});
  const share = `${location.origin}${import.meta.env.BASE_URL}register/${form.slug}`;
  const walk = code ? `${share}?w=${code}` : "";
  useEffect(() => { supabase.rpc("form_onsite_code", { p_form: form.id }).then(({ data }) => setCode((data as string) ?? null)); }, [form.id]);
  useEffect(() => {
    import("qrcode").then(async (Q) => setImgs({ share: await Q.toDataURL(share, { width: 720, margin: 2 }), walk: walk ? await Q.toDataURL(walk, { width: 720, margin: 2 }) : undefined }));
  }, [share, walk]);
  const Card = ({ title, note, url, img, file }: { title: string; note: string; url: string; img?: string; file: string }) => (
    <div className="card qrcard">
      <b>{title}</b><small className="muted">{note}</small>
      {img ? <img src={img} alt={`QR code: ${title}`} /> : <p className="muted">Making the QR code…</p>}
      <code className="qrurl">{url}</code>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {img && <a className="btn primary sm" href={img} download={file}>⬇ Download QR</a>}
        <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(url)}>Copy link</button>
      </div>
    </div>
  );
  const safe = form.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return (<>
    <div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>QR codes · {form.title}</h3><button className="linkbtn" onClick={close}>Close</button></div>
    <div className="grid2">
      <Card title="Registration (share this)" note="For flyers, WhatsApp and posters. People register with or without a BCIL Foundation account, and get a QR ticket." url={share} img={imgs.share} file={`${safe}-registration-QR.png`} />
      {code ? <Card title="Walk-in at the venue" note="Print for the registration desk on the day. People who register with this are checked in straight away. Don't share it before the day." url={walk} img={imgs.walk} file={`${safe}-walk-in-QR.png`} />
        : <div className="card"><p className="muted">Making the walk-in code…</p></div>}
    </div>
  </>);
}


type MReq = { id: number; user_id: string | null; answers: Record<string, string>; created_at: string; forms: { slug: string } };
type MPair = { id: number; mentor_id: string; mentee_id: string; room_id: string | null; next_session: string | null; created_at: string;
  mentor: { full_name: string } | null; mentee: { full_name: string } | null };

// Mentorship: requests from students, offers from mentors, and the pairs. Pairing opens a private chat for the two.
function MentorshipAdmin() {
  const [reqs, setReqs] = useState<MReq[]>([]);
  const [pairs, setPairs] = useState<MPair[]>([]);
  const [mentee, setMentee] = useState(""); const [mentor, setMentor] = useState("");
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const load = () => {
    supabase.from("form_responses").select("id, user_id, answers, created_at, forms!inner(slug)").in("forms.slug", ["mentorship-mentee", "mentorship-mentor"])
      .order("created_at", { ascending: false }).then(({ data }) => setReqs((data ?? []) as unknown as MReq[]));
    supabase.from("mentorships").select("id, mentor_id, mentee_id, room_id, next_session, created_at, mentor:profiles!mentorships_mentor_id_fkey(full_name), mentee:profiles!mentorships_mentee_id_fkey(full_name)")
      .eq("status", "active").order("created_at", { ascending: false }).then(({ data }) => setPairs((data ?? []) as unknown as MPair[]));
  };
  useEffect(() => { load(); }, []);
  const paired = new Set(pairs.map((p) => p.mentee_id));
  const load_of = (uid: string) => pairs.filter((p) => p.mentor_id === uid).length;
  const students = reqs.filter((r) => r.forms.slug === "mentorship-mentee");
  const mentors = reqs.filter((r) => r.forms.slug === "mentorship-mentor");
  const name = (r: MReq) => r.answers.full_name || "Member";
  async function pair() {
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("pair_mentorship", { p_mentor: mentor, p_mentee: mentee });
    setBusy(false);
    if (error) setMsg(error.message); else { setMsg("Paired ✓ Both have been told in the app, and their chat is open."); setMentee(""); setMentor(""); load(); }
  }
  async function end(p: MPair) {
    if (!window.confirm(`End the mentorship between ${p.mentor?.full_name} and ${p.mentee?.full_name}? Their chat stays.`)) return;
    await supabase.from("mentorships").update({ status: "ended" }).eq("id", p.id); load();
  }
  const Req = ({ r }: { r: MReq }) => (
    <div><div className="grow">
      <b>{name(r)}</b> <small className="muted">· {fmt(r.created_at)}</small>
      {!r.user_id && <span className="pill" style={{ marginLeft: 6 }}>No app account</span>}
      {r.forms.slug === "mentorship-mentee" && r.user_id && paired.has(r.user_id) && <span className="pill paid" style={{ marginLeft: 6 }}>Paired</span>}
      {r.forms.slug === "mentorship-mentor" && r.user_id && <span className="pill" style={{ marginLeft: 6 }}>{load_of(r.user_id)} mentee(s) · can take {r.answers.capacity || "?"}</span>}
      {["school", "level", "work", "areas", "goal", "frequency", "phone"].map((k) => r.answers[k] ? <div key={k}><small className="muted">{k === "areas" ? (r.forms.slug === "mentorship-mentor" ? "Can help with" : "Wants help with") : k[0].toUpperCase() + k.slice(1)}:</small> {r.answers[k]}</div> : null)}
    </div></div>
  );
  return (<>
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <b>🤝 Pair a mentor with a student</b>
      <select value={mentee} onChange={(e) => setMentee(e.target.value)} aria-label="Student">
        <option value="">Choose a student…</option>
        {students.filter((r) => r.user_id && !paired.has(r.user_id)).map((r) => <option key={r.id} value={r.user_id!}>{name(r)}{r.answers.areas ? ` · ${r.answers.areas}` : ""}</option>)}
      </select>
      <select value={mentor} onChange={(e) => setMentor(e.target.value)} aria-label="Mentor">
        <option value="">Choose a mentor…</option>
        {mentors.filter((r) => r.user_id).map((r) => <option key={r.id} value={r.user_id!}>{name(r)} · {load_of(r.user_id!)} now{r.answers.areas ? ` · ${r.answers.areas}` : ""}</option>)}
      </select>
      <button className="btn primary" disabled={!mentee || !mentor || busy} onClick={pair}>{busy ? "Pairing…" : "Pair them"}</button>
      {msg && <small className="muted">{msg}</small>}
      <small className="muted">Requests without an app account can't be paired yet: ask them to sign up in the app and fill the form there.</small>
    </div>
    <h3>Active pairs ({pairs.length})</h3>
    <div className="list">{pairs.length ? pairs.map((p) => <div key={p.id}><div className="grow"><b>{p.mentor?.full_name}</b> → {p.mentee?.full_name}<br />
      <small className="muted">Since {fmt(p.created_at)}{p.next_session ? ` · next session ${fmt(p.next_session)}` : ""}</small></div>
      <button className="btn ghost sm" onClick={() => end(p)}>End</button></div>) : <p className="muted">No pairs yet.</p>}</div>
    <h3>Students asking for a mentor ({students.length})</h3>
    <div className="list">{students.length ? students.map((r) => <Req key={r.id} r={r} />) : <p className="muted">No requests yet.</p>}</div>
    <h3>Mentors ({mentors.length})</h3>
    <div className="list">{mentors.length ? mentors.map((r) => <Req key={r.id} r={r} />) : <p className="muted">No mentors yet.</p>}</div>
  </>);
}
