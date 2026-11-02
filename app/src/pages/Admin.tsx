import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import AddAudioTalk from "../components/AddAudioTalk";

const TABS = ["Engagement", "Quotes", "Live sessions", "Talks", "Form responses", "Gifts", "Reports", "People"] as const;
type Tab = (typeof TABS)[number];
const THEMES = ["Integrity", "Mentorship", "Persistence", "Impact", "Responsibility", "Excellence"];
const PROGRAMS = ["Finding Campus Balance", "Keys to Success", "Operation 4.0", "Beyond Junior High", "Academic Mentorship", "Daily Bites", "Live sessions"];
const cedis = (p: number) => `GH₵ ${(p / 100).toLocaleString("en-GH")}`;
const fmt = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function Admin() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("Engagement");
  if (profile?.role !== "admin" && profile?.role !== "moderator")
    return <section className="view"><h1>Admin</h1><div className="empty"><b>Admins only</b>Ask a BCIL admin to give you access.</div></section>;
  const isAdmin = profile.role === "admin";
  const tabs = isAdmin ? TABS : (["Engagement", "Reports"] as const);
  return (
    <section className="view">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}><h1>Admin</h1>
        <Link className="btn primary" to="/checkin">📷 Scan tickets</Link></div>
      <div className="chips">{tabs.map((t) => <button key={t} className="chip" aria-pressed={t === tab} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === "Quotes" && isAdmin && <QuotesAdmin />}
      {tab === "Live sessions" && isAdmin && <LiveAdmin />}
      {tab === "Talks" && isAdmin && <TalksAdmin />}
      {tab === "Form responses" && isAdmin && <FormsAdmin />}
      {tab === "Gifts" && isAdmin && <GiftsAdmin />}
      {tab === "Engagement" && <EngagementAdmin />}
      {(tab === "Reports" || (!isAdmin && tab !== "Engagement")) && <ReportsAdmin />}
      {tab === "People" && isAdmin && <PeopleAdmin />}
    </section>
  );
}

function QuotesAdmin() {
  const [rows, setRows] = useState<{ id: number; show_on: string; theme: string; body: string; author: string }[]>([]);
  const [f, setF] = useState({ show_on: new Date().toISOString().slice(0, 10), theme: THEMES[0], body: "", author: "BCIL Foundation", reflection: "" });
  const [msg, setMsg] = useState("");
  // admins see future quotes too (the read rule hides them from members)
  const load = () => supabase.from("quotes").select("id, show_on, theme, body, author").order("show_on", { ascending: false }).limit(60).then(({ data }) => setRows(data ?? []));
  useEffect(() => { load(); }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.body.trim()) { setMsg("Write the quote first."); return; }
    const { error } = await supabase.from("quotes").upsert({ ...f, reflection: f.reflection || null }, { onConflict: "show_on" });
    setMsg(error ? error.message : "Saved."); if (!error) { setF({ ...f, body: "", reflection: "" }); load(); }
  }
  return (<>
    <form className="card" onSubmit={save}>
      <h3>Add a daily quote</h3>
      <div className="grid2">
        <label className="field">Show on<input type="date" value={f.show_on} onChange={(e) => setF({ ...f, show_on: e.target.value })} /></label>
        <label className="field">Theme<select value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })}>{THEMES.map((t) => <option key={t}>{t}</option>)}</select></label>
      </div>
      <label className="field">Quote<textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      <label className="field">Author<input value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} /></label>
      <label className="field">Reflection (optional)<input value={f.reflection} onChange={(e) => setF({ ...f, reflection: e.target.value })} placeholder="A short action for today" /></label>
      <p className="muted">{msg}</p>
      <button className="btn primary">Save quote</button>
    </form>
    <div className="list">{rows.map((r) => <div key={r.id}><div className="grow"><b>{r.show_on}</b> · {r.theme}<br /><small className="muted">“{r.body}” — {r.author}</small></div>
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

type Field = { key: string; label: string; type?: string };
type FormRow = { id: string; title: string; fields: Field[]; is_open: boolean; fee_pesewas: number | null; fee_label: string | null; fee_required: boolean };
type RespRow = { id: number; answers: Record<string, string>; status: string; created_at: string; paid_at: string | null; checked_in_at: string | null; profiles: { full_name: string } | null };

function FormsAdmin() {
  const [forms, setForms] = useState<FormRow[]>([]);
  const [formId, setFormId] = useState("");
  const [rows, setRows] = useState<RespRow[]>([]);
  const [busy, setBusy] = useState(false);
  const loadForms = () => supabase.from("forms").select("id, title, fields, is_open, fee_pesewas, fee_label, fee_required").order("created_at")
    .then(({ data }) => { setForms((data ?? []) as FormRow[]); setFormId((cur) => cur || data?.[0]?.id || ""); });
  useEffect(() => { loadForms(); }, []);
  const load = () => formId && supabase.from("form_responses").select("id, answers, status, created_at, paid_at, checked_in_at, profiles(full_name)")
    .eq("form_id", formId).order("created_at", { ascending: false }).then(({ data }) => setRows((data ?? []) as unknown as RespRow[]));
  useEffect(() => { load(); }, [formId]);
  const found = forms.find((f) => f.id === formId);
  const form = found && { ...found, fields: found.fields.filter((f) => f.type !== "section") };

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
  return (<>
    <div className="row" style={{ flexWrap: "wrap" }}>
      <select value={formId} onChange={(e) => setFormId(e.target.value)} aria-label="Form" style={{ maxWidth: 360 }}>
        {forms.map((f) => <option key={f.id} value={f.id}>{f.title}{f.is_open ? "" : " (closed)"}</option>)}</select>
      <span className="muted">{rows.length} responses</span>
      <button className="btn primary" onClick={downloadExcel} disabled={busy || !rows.length}>{busy ? "Preparing…" : "Download Excel"}</button>
      {form && <button className="btn ghost" onClick={toggleOpen}>{form.is_open ? "Close form" : "Reopen form"}</button>}
    </div>
    {form && !form.is_open && <p className="muted">This form is closed. Members can no longer see or fill it in.</p>}
    {form && <FeeEditor form={form} onSaved={loadForms} paid={rows.filter((r) => r.paid_at).length} total={rows.length} checkedIn={rows.filter((r) => r.checked_in_at).length} />}
    <div className="list">{rows.map((r) => (
      <div key={r.id}><div className="grow">
        <b>{r.answers.full_name || r.answers.name || r.profiles?.full_name || "Member"}</b> <small className="muted">· {fmt(r.created_at)}</small>
        {form?.fee_pesewas ? (r.paid_at ? <span className="pill paid" style={{ marginLeft: 6 }}>Paid</span> : <span className="pill" style={{ marginLeft: 6 }}>Not paid</span>) : null}
        {r.checked_in_at && <span className="pill sent" style={{ marginLeft: 6 }}>Checked in</span>}
        {form?.fields.filter((f) => !/full_name|^name$/.test(f.key)).map((f) => r.answers[f.key] ? <div key={f.key}><small className="muted">{f.label}:</small> {r.answers[f.key]}</div> : null)}
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
  return (<>
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
      .toFile(`BCIL Live engagement (last ${days} days).xlsx`);
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
