import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { TicketSheet } from "../components/Ticket";
import { PAYMENTS_ENABLED, TEST_NOTE, paymentsOn, startPayment } from "../lib/pay";

// Question types, matching what BCIL uses in Google Forms
export type Field = {
  key: string; label: string; required?: boolean; help?: string;
  type: "text" | "tel" | "email" | "date" | "number" | "textarea" | "select" | "radio" | "checkbox" | "section" | "file";
  options?: string[];
};
type Form = { id: string; slug: string; title: string; subtitle: string | null; description: string | null; fields: Field[]; fee_pesewas: number | null; fee_label: string | null; fee_required: boolean };
type Resp = { id: number; form_id: string; status: string; created_at: string; paid_at: string | null; ticket?: string | null; checked_in_at?: string | null };
export const cedis = (p: number) => `GH₵ ${(p / 100).toLocaleString("en-GH")}`;

const STATUS: Record<string, string> = { received: "Received", accepted: "Accepted", declined: "Not accepted", waitlist: "Waitlist" };

export default function Forms() {
  const { session, profile, isStaff } = useAuth();
  const canPay = paymentsOn(isStaff);
  const [payFor, setPayFor] = useState<{ resp: number; form: Form } | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payMsg, setPayMsg] = useState("");
  const [forms, setForms] = useState<Form[]>([]);
  const [mine, setMine] = useState<Resp[]>([]);
  const [open, setOpen] = useState<Form | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [doneId, setDoneId] = useState<number | null>(null);
  const [ticketFor, setTicketFor] = useState<Resp | null>(null);
  const [eventForms, setEventForms] = useState<Record<string, string>>({});   // form slug → event title (these forms give a QR ticket)
  useEffect(() => { supabase.from("event_pages").select("form_slug, volunteer_form_slug, title").then(({ data, error }) => {
    // volunteer forms give a ticket too (to check in on the day, and for the volunteer certificate)
    const rows = (error ? [] : data ?? []) as { form_slug: string | null; volunteer_form_slug: string | null; title: string }[];
    const map: Record<string, string> = {};
    for (const e of rows) { if (e.form_slug) map[e.form_slug] = e.title; if (e.volunteer_form_slug) map[e.volunteer_form_slug] = `${e.title} (volunteer)`; }
    if (error) supabase.from("event_pages").select("form_slug, title").not("form_slug", "is", null).then(({ data: d }) =>
      setEventForms(Object.fromEntries(((d ?? []) as { form_slug: string; title: string }[]).map((e) => [e.form_slug, e.title]))));
    else setEventForms(map);
  }); }, []);
  const ticketTitle = (r: Resp) => { const f = forms.find((x) => x.id === r.form_id); return f ? eventForms[f.slug] : undefined; };

  const load = () => {
    supabase.from("forms").select("id, slug, title, subtitle, description, fields, fee_pesewas, fee_label, fee_required").eq("is_open", true).order("created_at").then(({ data }) => setForms((data ?? []) as Form[]));
    supabase.from("form_responses").select("id, form_id, status, created_at, paid_at, ticket, checked_in_at").order("created_at", { ascending: false }).then(({ data }) => setMine((data ?? []) as Resp[]));
  };
  useEffect(load, []);
  // open a form straight from a link like /forms?form=fcb27-registration
  const [params, setParams] = useSearchParams();
  const opened = useRef(false);
  useEffect(() => {
    const slug = params.get("form");
    if (!slug || opened.current || !forms.length) return;
    const f = forms.find((x) => x.slug === slug);
    opened.current = true; setParams({}, { replace: true });
    if (f && !mine.some((r) => r.form_id === f.id)) start(f);
  }, [forms, mine]);

  function start(f: Form) {
    // fill in what we already know, so people type less
    const pre: Record<string, string> = {};
    for (const q of f.fields) {
      if (/full_name|^name$/.test(q.key) && profile?.full_name) pre[q.key] = profile.full_name;
      if (q.type === "email" && session?.user.email) pre[q.key] = session.user.email;
    }
    setAnswers(pre); setError(""); setDone(""); setOpen(f);
    window.scrollTo(0, 0);
  }
  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  const toggle = (k: string, opt: string) => {
    const cur = (answers[k] ?? "").split(", ").filter(Boolean);
    set(k, (cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]).join(", "));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing = open!.fields.find((f) => f.required && !answers[f.key]?.trim());
    if (missing) { setError(`Please answer “${missing.label}”.`); document.getElementById(`q-${missing.key}`)?.scrollIntoView({ block: "center" }); return; }
    const final = finalAnswers(open!.fields, answers);
    setBusy(true);
    const { data: sent, error } = await supabase.from("form_responses").insert({ form_id: open!.id, user_id: session!.user.id, answers: final }).select("id, ticket").single();
    setBusy(false);
    if (error) { setError("Could not send. Check your connection and try again."); return; }
    // email the QR ticket too (does nothing until the email service is connected, or if this form has no programme)
    if (sent?.ticket && eventForms[open!.slug]) supabase.functions.invoke("send-ticket", { body: { ticket: sent.ticket } }).catch(() => {});
    if (open!.fee_pesewas && sent) setPayFor({ resp: sent.id, form: open! });
    setDone(open!.title); setDoneId(sent?.id ?? null); setOpen(null); setAnswers({}); load();
  }

  async function pay(resp: number) {
    setPayBusy(true); setPayMsg("");
    try { await startPayment({ kind: "form_fee", response_id: resp }); setPayMsg("Finish on the Paystack page (Mobile Money or card). It shows as Paid here once it's done."); }
    catch (e) { setPayMsg((e as Error).message); }
    finally { setPayBusy(false); }
  }
  // poll while a payment may be in progress, so "Paid" appears by itself
  useEffect(() => { if (!payMsg) return; const t = setInterval(load, 8000); return () => clearInterval(t); }, [payMsg]);

  if (open) return (
    <section className="view">
      <button className="linkbtn" onClick={() => setOpen(null)}>← Forms</button>
      <form className="card formcard" onSubmit={submit} noValidate>
        <div className="formhead">
          <h2>{open.title}</h2>
          {open.subtitle && <p className="muted">{open.subtitle}</p>}
          {open.description && <p>{open.description}</p>}
          {open.fee_pesewas && (open.fee_required
            ? <p className="feenote">💳 {open.fee_label || "Fee"}: <b>{cedis(open.fee_pesewas)}</b>. You can pay right after you submit.</p>
            : <p className="muted">Attendance is free. If you'd like a certificate, it costs {cedis(open.fee_pesewas)}, and you can pay any time after registering (optional).</p>)}
          <small className="muted">* Required</small>
        </div>
        <QuestionList fields={open.fields} answers={answers} set={set} toggle={toggle} />
        <p className="err" role="alert">{error}</p>
        <button className="btn primary" disabled={busy}>{busy ? "Sending…" : "Submit"}</button>
      </form>
    </section>
  );

  return (
    <section className="view">
      <h1>Forms</h1>
      {done && (() => { const r = mine.find((x) => x.id === doneId); const t = r && ticketTitle(r);
        return <div className="card donecard"><p className="ok" role="status" style={{ margin: 0 }}>Thank you! Your response to “{done}” has been received.</p>
          {r && t && <><small className="muted">Your QR ticket for {t} is ready. You'll show it at the registration desk.</small>
            <button className="btn primary" onClick={() => setTicketFor(r)}>🎟 Show my ticket</button></>}</div>; })()}
      {payFor && !mine.find((r) => r.id === payFor.resp)?.paid_at && (
        <div className="card paycard">
          <b>{payFor.form.fee_required ? `💳 ${payFor.form.fee_label || "Fee"}: ${cedis(payFor.form.fee_pesewas!)}` : `🎓 Want a certificate? ${cedis(payFor.form.fee_pesewas!)} (optional)`}</b>
          {canPay ? <>
            {!PAYMENTS_ENABLED && <p className="testnote">{TEST_NOTE}</p>}
            <p className="muted">Pay now with Mobile Money or card. {payFor.form.fee_required ? "Your registration is complete once it's paid." : "You can also pay later from My responses."}</p>
            <button className="btn primary" disabled={payBusy} onClick={() => pay(payFor.resp)}>{payBusy ? "Opening Paystack…" : `Pay ${cedis(payFor.form.fee_pesewas!)}`}</button>
          </> : <p className="muted">Payment in the app opens soon. You'll be able to pay here from My responses.</p>}
          {payMsg && <p className="muted small">{payMsg}</p>}
        </div>
      )}
      <h2>Open forms</h2>
      {forms.length ? <div className="list">
        {forms.map((f) => {
          const sent = mine.find((r) => r.form_id === f.id);
          return (
            <button key={f.id} onClick={() => start(f)}>
              <div className="grow"><b>{f.title}</b><br /><small className="muted">{f.subtitle}</small></div>
              {f.fee_pesewas && f.fee_required && !sent && <span className="pill">{cedis(f.fee_pesewas)}</span>}
              {sent ? <span className="pill sent">Sent</span> : <span className="pill soon">Fill in</span>}
            </button>);
        })}
      </div> : <div className="empty"><b>No open forms right now</b>New registrations will appear here.</div>}
      <h2>My responses</h2>
      {payMsg && !payFor && <p className="muted small">{payMsg}</p>}
      {mine.length ? <div className="list">{mine.map((r) => (
        <div key={r.id}><div className="grow"><b>{forms.find((f) => f.id === r.form_id)?.title ?? "Form"}</b><br />
          <small className="muted">Sent {new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</small></div>
          {(() => { const f = forms.find((x) => x.id === r.form_id); if (!f?.fee_pesewas) return null;
            return r.paid_at ? <span className="pill paid">Paid</span>
              : canPay ? <button className="btn primary sm" disabled={payBusy} onClick={() => pay(r.id)}>Pay {cedis(f.fee_pesewas)}</button>
              : f.fee_required ? <span className="pill">{cedis(f.fee_pesewas)} due</span> : null; })()}
          {ticketTitle(r) && r.ticket && <button className="btn ghost sm" onClick={() => setTicketFor(r)}>🎟 Ticket</button>}
          <span className={`pill ${r.status === "accepted" ? "paid" : r.status === "declined" ? "failed" : ""}`}>{STATUS[r.status] ?? r.status}</span></div>
      ))}</div> : <div className="empty"><b>You have not sent any forms yet</b></div>}
      {ticketFor?.ticket && <TicketSheet ticket={ticketFor.ticket} title={ticketTitle(ticketFor) ?? "BCIL"} checkedIn={!!ticketFor.checked_in_at} close={() => setTicketFor(null)} />}
    </section>
  );
}

/** The questions of a form (shared by the in-app form and the public registration page) */
export function QuestionList({ fields, answers, set, toggle }: { fields: Field[]; answers: Record<string, string>; set: (k: string, v: string) => void; toggle: (k: string, opt: string) => void }) {
  return (<>
      {fields.map((f) => f.type === "section" ? (
        <div className="qsection" key={f.key}><h3>{f.label}</h3>{f.help && <p className="muted">{f.help}</p>}</div>
      ) : (
        <fieldset className="q" key={f.key} id={`q-${f.key}`}>
          <legend>{f.label}{f.required && <span className="req"> *</span>}</legend>
          {f.help && <small className="muted">{f.help}</small>}
          {f.type === "file" ? <FileQuestion label={f.label} value={answers[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
            : f.type === "textarea" ? <textarea value={answers[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} />
            : f.type === "select" ? (
              <select value={answers[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label}>
                <option value="">Choose…</option>{f.options?.map((o) => <option key={o}>{o}</option>)}
              </select>)
            : f.type === "radio" ? (
              <div className="choices">{f.options?.map((o) => (
                <label key={o} className={`choice${answers[f.key] === o ? " on" : ""}`}>
                  <input type="radio" name={f.key} checked={answers[f.key] === o} onChange={() => set(f.key, o)} />{o}
                </label>))}</div>)
            : f.type === "checkbox" ? (
              <div className="choices">{f.options?.map((o) => {
                const on = (answers[f.key] ?? "").split(", ").includes(o);
                return (<label key={o} className={`choice${on ? " on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(f.key, o)} />{o}
                </label>);
              })}</div>)
            : <input type={f.type} value={answers[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label}
                inputMode={f.type === "tel" ? "tel" : f.type === "number" ? "numeric" : undefined} />}
          {(f.type === "radio" || f.type === "checkbox") && (answers[f.key] ?? "").split(", ").includes("Other") &&
            <input placeholder="Please specify" aria-label={`${f.label}: other`} value={answers[`${f.key}__other`] ?? ""} onChange={(e) => set(`${f.key}__other`, e.target.value)} />}
        </fieldset>
      ))}
  </>);
}

/** A document upload (PDF or photo, up to 10 MB). Files go to private storage only BCIL staff can open; the answer keeps the file's path. */
function FileQuestion({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const name = value ? value.split("/").pop()!.replace(/^[0-9a-f-]{36}-/, "") : "";
  async function pick(file?: File) {
    if (!file) return; setErr("");
    if (file.size > 10 * 1024 * 1024) { setErr("That file is over 10 MB. Try a smaller copy or a photo."); return; }
    setBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    const path = `${session?.user.id ?? "guest"}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
    const { error } = await supabase.storage.from("form-files").upload(path, file, { contentType: file.type || undefined });
    setBusy(false);
    if (error) setErr("Upload failed. Check your connection and try again."); else onChange(path);
  }
  return (<div className="fileq">
    {value ? <span className="pill sent">📎 {name}</span> : null}
    <label className="btn ghost sm">{busy ? "Uploading…" : value ? "Replace file" : "Choose file"}
      <input type="file" hidden accept="application/pdf,image/*,.doc,.docx" aria-label={label} onChange={(e) => pick(e.target.files?.[0])} /></label>
    {err && <small className="err">{err}</small>}
  </div>);
}

/** Answers ready to save: "Other" text folded in like Google Forms, sections skipped */
export function finalAnswers(fields: Field[], answers: Record<string, string>) {
  const final: Record<string, string> = {};
  for (const f of fields) {
    if (f.type === "section") continue;
    let v = answers[f.key] ?? "";
    const other = answers[`${f.key}__other`]?.trim();
    if (other && v.split(", ").includes("Other")) v = v.split(", ").map((x) => (x === "Other" ? `Other: ${other}` : x)).join(", ");
    if (v) final[f.key] = v;
  }
  return final;
}
