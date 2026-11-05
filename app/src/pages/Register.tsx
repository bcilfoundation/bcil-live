import { useEffect, useState } from "react";
import { certificateInfo, certReason, downloadCertificate, type CertInfo } from "../lib/certificate";
import { supabase } from "../lib/supabase";
import { QuestionList, finalAnswers, type Field } from "./Forms";
import Ticket from "../components/Ticket";

type PublicForm = { id: string; slug: string; title: string; subtitle: string | null; description: string | null; fields: Field[]; fee_pesewas: number | null; fee_required: boolean };
type Done = { ticket: string; name: string; title: string; checked_in: boolean };
const base = import.meta.env.BASE_URL;

/**
 * Public registration: live.bcilfoundation.org/register/<form>. Works without a BCIL Foundation account
 * (people who are signed in are linked to their account). With ?w=<walk-in code> (the QR code at the venue)
 * the person is checked in as soon as they submit.
 */
export default function Register({ slug }: { slug: string }) {
  const params = new URLSearchParams(location.search);
  const walkIn = params.get("w");
  const [form, setForm] = useState<PublicForm | null | undefined>(undefined);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [mail, setMail] = useState("");
  const [isEvent, setIsEvent] = useState(false);   // only programme registrations give a ticket; Join us / Volunteer just say thanks

  useEffect(() => {
    supabase.from("forms").select("id, slug, title, subtitle, description, fields, fee_pesewas, fee_required").eq("slug", slug).eq("is_open", true).maybeSingle()
      .then(({ data }) => setForm((data as PublicForm | null) ?? null));
    supabase.from("event_pages").select("slug").or(`form_slug.eq.${slug},volunteer_form_slug.eq.${slug}`).limit(1).then(({ data, error }) => {
      if (!error) { setIsEvent(!!data?.length); return; }
      supabase.from("event_pages").select("slug").eq("form_slug", slug).limit(1).then(({ data: d }) => setIsEvent(!!d?.length));
    });
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, [slug]);

  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  const toggle = (k: string, opt: string) => {
    const cur = (answers[k] ?? "").split(", ").filter(Boolean);
    set(k, (cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]).join(", "));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const missing = form.fields.find((f) => f.required && !answers[f.key]?.trim());
    if (missing) { setError(`Please answer “${missing.label}”.`); document.getElementById(`q-${missing.key}`)?.scrollIntoView({ block: "center" }); return; }
    setBusy(true); setError("");
    const { data, error } = await supabase.rpc("submit_form", { p_slug: form.slug, p_answers: finalAnswers(form.fields, answers), p_onsite: walkIn });
    setBusy(false);
    if (error || !data?.[0]) { setError(error?.message?.includes("closed") ? "This form is closed." : "Could not send. Check your connection and try again."); return; }
    const r = data[0] as { ticket: string; name: string; form_title: string; checked_in: boolean };
    setDone({ ticket: r.ticket, name: r.name, title: r.form_title, checked_in: r.checked_in });
    window.scrollTo(0, 0);
    if (!isEvent) return;
    // email the ticket (does nothing until the email service is connected)
    supabase.functions.invoke("send-ticket", { body: { ticket: r.ticket } })
      .then(({ data: m }) => setMail(m?.sent ? "We've also emailed your ticket to you." : "")).catch(() => {});
  }

  return (
    <div className="regpage">
      <header className="reghead"><img src={`${base}logo-wordmark.webp`} alt="BCIL Foundation" /></header>
      {form === undefined ? <p className="muted">Loading…</p>
        : form === null ? <div className="card"><b>This form is closed or the link is not valid.</b><p className="muted">Check the link with the BCIL team.</p></div>
        : done && !isEvent ? (
          <div className="card regdone">
            <h2>🎉 Thank you, {done.name.split(" ")[0]}!</h2>
            <p>We've received your form for <b>{form.title}</b>. The BCIL team will get in touch with you.</p>
            {!signedIn && <div className="regjoin"><b>Want more from BCIL?</b><span className="muted">Get the BCIL Foundation app for live sessions, talks, the Daily Bite and the community.</span>
              <a className="btn primary" href={base}>Open the app</a></div>}
          </div>
        ) : done ? (
          <div className="card regdone">
            {done.checked_in
              ? <><h2>✅ Welcome, {done.name.split(" ")[0]}!</h2><p>You're registered <b>and checked in</b> for {form.title}. Enjoy the programme.</p></>
              : <><h2>🎉 You're registered, {done.name.split(" ")[0]}!</h2><p>Here's your ticket for <b>{form.title}</b>. Show it at the registration desk on the day.</p></>}
            <Ticket ticket={done.ticket} title={form.title} checkedIn={done.checked_in} />
            <p className="muted small">{mail || "Take a screenshot of your ticket now, or keep this link:"}</p>
            <a className="btn ghost" href={`${base}t/${done.ticket}`}>Open my ticket page</a>
            {!signedIn && <div className="regjoin"><b>Want more from BCIL?</b><span className="muted">Get the BCIL Foundation app for live sessions, talks, the Daily Bite and the community.</span>
              <a className="btn primary" href={base}>Open the app</a></div>}
          </div>
        ) : (
          <form className="card formcard" onSubmit={submit} noValidate>
            <div className="formhead">
              {walkIn && <p className="walkin">📍 Registering at the venue: you'll be checked in as soon as you submit.</p>}
              <h2>{form.title}</h2>
              {form.subtitle && <p className="muted">{form.subtitle}</p>}
              {form.description && <p>{form.description}</p>}
              {!signedIn && <p className="muted small">No account needed. Already have an account on our app? <a href={`${base}forms?form=${form.slug}`}>Sign in and {isEvent ? "register" : "fill it in"} there</a>.</p>}
              <small className="muted">* Required</small>
            </div>
            <QuestionList fields={form.fields} answers={answers} set={set} toggle={toggle} />
            <p className="err" role="alert">{error}</p>
            <button className="btn primary" disabled={busy}>{busy ? "Sending…" : walkIn ? "Register and check in" : "Register"}</button>
          </form>
        )}
    </div>
  );
}

/** live.bcilfoundation.org/t/<ticket>: the ticket on its own page (no sign-in), to show at the desk */
export function TicketPage({ ticket }: { ticket: string }) {
  const [info, setInfo] = useState<{ name: string; form_title: string; checked_in: boolean; event_title: string | null; event_starts: string | null; venue: string | null } | null | undefined>(undefined);
  useEffect(() => {
    if (!/^[0-9a-f-]{36}$/i.test(ticket)) { setInfo(null); return; }
    supabase.rpc("ticket_info", { p_ticket: ticket }).then(({ data }) => setInfo(data?.[0] ?? null));
  }, [ticket]);
  return (
    <div className="regpage">
      <header className="reghead"><img src={`${base}logo-wordmark.webp`} alt="BCIL Foundation" /></header>
      {info === undefined ? <p className="muted">Loading…</p> : info === null ? <div className="card"><b>Ticket not found.</b></div> : (
        <div className="card regdone">
          <h2>{info.name}</h2>
          <p className="muted">{info.event_title ?? info.form_title}{info.event_starts ? ` · ${new Date(info.event_starts + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" })}` : ""}{info.venue ? ` · ${info.venue}` : ""}</p>
          <CertificateBox ticket={ticket} />
          <Ticket ticket={ticket} title={info.event_title ?? info.form_title} checkedIn={info.checked_in} />
        </div>
      )}
    </div>
  );
}

/** "Download your certificate" once staff release certificates and this ticket qualifies; nothing before the programme. */
export function CertificateBox({ ticket }: { ticket: string }) {
  const [c, setC] = useState<CertInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { certificateInfo(ticket).then(setC); }, [ticket]);
  if (!c || c.reason === "not_found" || c.reason === "not_released") return null;
  if (!c.ok) return <p className="muted small">🎓 {certReason(c)}</p>;
  return (
    <div className="certbox">
      <b>🎓 Your {c.kind === "volunteer" ? "volunteer certificate" : "certificate"} is ready</b>
      <span className="muted small">For {c.name}. Check the spelling before you print it.</span>
      <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); try { await downloadCertificate(c); } finally { setBusy(false); } }}>{busy ? "Preparing…" : "Download certificate (PDF)"}</button>
    </div>
  );
}

/** live.bcilfoundation.org/c/<ticket>: anyone can check that a BCIL certificate is genuine */
export function CertificateCheck({ ticket }: { ticket: string }) {
  const [c, setC] = useState<CertInfo | null | undefined>(undefined);
  useEffect(() => { if (!/^[0-9a-f-]{36}$/i.test(ticket)) { setC(null); return; } certificateInfo(ticket).then(setC); }, [ticket]);
  return (
    <div className="regpage">
      <header className="reghead"><img src={`${base}logo-wordmark.webp`} alt="BCIL Foundation" /></header>
      {c === undefined ? <p className="muted">Checking…</p> : c?.ok ? (
        <div className="card regdone">
          <h2>✅ Genuine certificate</h2>
          <p><b>{c.name}</b> {c.kind === "volunteer" ? <>served as a volunteer{c.team ? ` on the ${c.team} team` : ""} at</> : "took part in"} <b>{c.event_title}</b>{c.event_subtitle ? ` (${c.event_subtitle})` : ""}{c.starts_on ? `, ${new Date(c.starts_on + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}{c.venue ? `, at ${c.venue}` : ""}.</p>
          <p className="muted small">Certificate no. {c.ticket.slice(0, 8).toUpperCase()} · issued by BCIL Foundation</p>
        </div>
      ) : <div className="card"><b>❌ We couldn't confirm this certificate.</b><p className="muted">If you think this is a mistake, contact info@bcilfoundation.org.</p></div>}
    </div>
  );
}
