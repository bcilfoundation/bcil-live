import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { PAYMENTS_ENABLED, TEST_NOTE, paymentsOn, startPayment } from "../lib/pay";
import { cedis } from "./Forms";

type Item = { time?: string; title: string; detail?: string };
type Speaker = { name: string; role?: string; photo?: string };
type Ev = { slug: string; title: string; subtitle: string | null; starts_on: string | null; venue: string | null; about: string | null; hero_url: string | null; form_slug: string | null; schedule: Item[]; speakers: Speaker[] };
type Mine = { id: number; ticket: string; paid_at: string | null; checked_in_at: string | null; status: string };
type FormInfo = { id: string; fee_pesewas: number | null; fee_label: string | null; is_open: boolean };

// An event page (FCB 2027): what, when, where, the day's programme, speakers, how many registered, and my QR ticket
export default function Event() {
  const { slug = "fcb2027" } = useParams();
  const { session, isStaff } = useAuth();
  const [ev, setEv] = useState<Ev | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [form, setForm] = useState<FormInfo | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [showTicket, setShowTicket] = useState(false);
  const [editing, setEditing] = useState(false);
  const [payMsg, setPayMsg] = useState("");

  const load = async () => {
    const { data: e } = await supabase.from("event_pages").select("*").eq("slug", slug).maybeSingle();
    setEv(e as Ev | null);
    if (!e?.form_slug) return;
    const [{ data: n }, { data: f }] = await Promise.all([
      supabase.rpc("form_count", { p_slug: e.form_slug }),
      supabase.from("forms").select("id, fee_pesewas, fee_label, is_open").eq("slug", e.form_slug).maybeSingle(),
    ]);
    setCount(typeof n === "number" ? n : null); setForm(f as FormInfo | null);
    if (f) {
      const { data: r } = await supabase.from("form_responses").select("id, ticket, paid_at, checked_in_at, status")
        .eq("form_id", f.id).eq("user_id", session!.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      setMine(r as Mine | null);
    }
  };
  useEffect(() => { load(); }, [slug]);
  useEffect(() => { if (!payMsg) return; const t = setInterval(load, 8000); return () => clearInterval(t); }, [payMsg]);

  if (!ev) return <section className="view"><p className="muted">Loading…</p></section>;
  if (editing) return <EventEditor ev={ev} done={() => { setEditing(false); load(); }} />;
  const date = ev.starts_on ? new Date(ev.starts_on + "T12:00:00") : null;
  const days = date ? Math.ceil((date.getTime() - Date.now()) / 864e5) : null;
  const pay = async () => {
    if (!mine) return;
    try { await startPayment({ kind: "form_fee", response_id: mine.id }); setPayMsg("Finish on the Paystack page. This page updates once it's paid."); }
    catch (e) { setPayMsg((e as Error).message); }
  };

  return (
    <section className="view event">
      <div className="banner hero photo" style={{ backgroundImage: `linear-gradient(180deg, rgba(10,25,60,.5), rgba(10,25,60,.92)), url(${ev.hero_url?.startsWith("/") ? import.meta.env.BASE_URL + ev.hero_url.slice(1) : ev.hero_url ?? ""})` }}>
        {ev.subtitle && <span className="eyebrow">{ev.subtitle}{date ? ` · ${date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}` : ""}</span>}
        <h1>{ev.title}</h1>
        {ev.venue && <p className="venue">📍 {ev.venue}</p>}
        <div className="evstats">
          {days !== null && days >= 0 && <span><b>{days}</b> day{days === 1 ? "" : "s"} to go</span>}
          {count !== null && <span><b>{count.toLocaleString()}</b> registered</span>}
        </div>
        {isStaff && <button className="btn ghost sm evedit" onClick={() => setEditing(true)}>✏️ Edit page</button>}
      </div>

      {/* my registration and ticket */}
      {mine ? (
        <div className="card evme">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <b>✅ You're registered{mine.checked_in_at ? " and checked in" : ""}</b>
            <button className="btn primary sm" onClick={() => setShowTicket((v) => !v)}>{showTicket ? "Hide ticket" : "🎟 Show my ticket"}</button>
          </div>
          {form?.fee_pesewas ? (mine.paid_at ? <span className="pill paid">{form.fee_label || "Fee"} paid</span> : paymentsOn(isStaff) ? <>
            {!PAYMENTS_ENABLED && <p className="testnote">{TEST_NOTE}</p>}
            <button className="btn ghost" onClick={pay}>💳 Pay {form.fee_label?.toLowerCase() || "fee"} · {cedis(form.fee_pesewas)}</button>
          </> : <small className="muted">{form.fee_label || "Fee"}: {cedis(form.fee_pesewas)}. Payment in the app opens soon.</small>) : null}
          {payMsg && <small className="muted">{payMsg}</small>}
          {showTicket && <Ticket ticket={mine.ticket} title={ev.title} />}
        </div>
      ) : form?.is_open ? (
        <Link className="btn primary evreg" to={`/forms?form=${ev.form_slug}`}>Register for {ev.title}{form.fee_pesewas ? ` · ${form.fee_label || "fee"} ${cedis(form.fee_pesewas)}` : ""}</Link>
      ) : null}

      {ev.about && <p className="evabout">{ev.about}</p>}

      <h2>Programme</h2>
      <ol className="evsched">{ev.schedule.map((s, i) => (
        <li key={i}><span className="t">{s.time || "·"}</span><div><b>{s.title}</b>{s.detail && <small className="muted">{s.detail}</small>}</div></li>
      ))}</ol>

      <h2>Speakers</h2>
      {ev.speakers.length ? <div className="evspeakers">{ev.speakers.map((p, i) => (
        <div key={i} className="evspk">{p.photo ? <img src={p.photo} alt="" loading="lazy" /> : <div className="ava">{p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>}
          <b>{p.name}</b>{p.role && <small className="muted">{p.role}</small>}</div>
      ))}</div> : <p className="muted">Speakers will be announced soon.</p>}

      {isStaff && <Link className="btn ghost" to="/checkin" style={{ marginTop: 16 }}>📷 Check people in (scan tickets)</Link>}
    </section>
  );
}

function Ticket({ ticket, title }: { ticket: string; title: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { import("qrcode").then((Q) => Q.toDataURL(ticket, { width: 320, margin: 1 }).then(setSrc)); }, [ticket]);
  return (
    <div className="ticket">
      {src ? <img src={src} alt="Your QR ticket" /> : <p className="muted">Making your ticket…</p>}
      <b>{title}</b>
      <small className="muted">Show this at the registration desk. Screenshot it in case there's no internet at the venue.</small>
    </div>
  );
}

// Admins and moderators edit the page: one line per programme item / speaker
function EventEditor({ ev, done }: { ev: Ev; done: () => void }) {
  const [f, setF] = useState({
    title: ev.title, subtitle: ev.subtitle ?? "", starts_on: ev.starts_on ?? "", venue: ev.venue ?? "", about: ev.about ?? "",
    schedule: ev.schedule.map((s) => [s.time ?? "", s.title, s.detail ?? ""].join(" | ").replace(/( \| )+$/, "")).join("\n"),
    speakers: ev.speakers.map((s) => [s.name, s.role ?? "", s.photo ?? ""].join(" | ").replace(/( \| )+$/, "")).join("\n"),
  });
  const [msg, setMsg] = useState("");
  const parse = (txt: string) => txt.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p.some(Boolean));
  const save = async () => {
    const schedule = parse(f.schedule).map((p) => p.length === 1 ? { title: p[0] } : { time: p[0], title: p[1] ?? "", detail: p[2] || undefined });
    const speakers = parse(f.speakers).map((p) => ({ name: p[0], role: p[1] || undefined, photo: p[2] || undefined }));
    const { error } = await supabase.from("event_pages").update({ title: f.title, subtitle: f.subtitle || null, starts_on: f.starts_on || null, venue: f.venue || null,
      about: f.about || null, schedule, speakers, updated_at: new Date().toISOString() }).eq("slug", ev.slug);
    if (error) setMsg(error.message); else done();
  };
  return (
    <section className="view">
      <button className="linkbtn" onClick={done}>← Back</button>
      <div className="card stack">
        <h2>Edit {ev.title}</h2>
        <label className="field">Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <div className="grid2">
          <label className="field">Subtitle<input value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} /></label>
          <label className="field">Date<input type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} /></label>
        </div>
        <label className="field">Venue<input value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} /></label>
        <label className="field">About<textarea value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} rows={3} /></label>
        <label className="field">Programme: one item per line, written as time | title | details<textarea value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })} rows={10} placeholder={"8:00 | Registration and check-in\n9:00 | Opening | Welcome by the Executive Director"} /></label>
        <label className="field">Speakers: one per line, written as name | role | photo link (optional)<textarea value={f.speakers} onChange={(e) => setF({ ...f, speakers: e.target.value })} rows={6} placeholder={"Prof. Ama Mensah | Dean of Students, UCC"} /></label>
        {msg && <p className="err">{msg}</p>}
        <div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={save}>Save</button><button className="btn ghost" onClick={done}>Cancel</button></div>
      </div>
    </section>
  );
}
