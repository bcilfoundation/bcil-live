import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

// Question types, matching what BCIL uses in Google Forms
export type Field = {
  key: string; label: string; required?: boolean; help?: string;
  type: "text" | "tel" | "email" | "date" | "number" | "textarea" | "select" | "radio" | "checkbox";
  options?: string[];
};
type Form = { id: string; slug: string; title: string; subtitle: string | null; description: string | null; fields: Field[] };
type Resp = { id: number; form_id: string; status: string; created_at: string };

const STATUS: Record<string, string> = { received: "Received", accepted: "Accepted", declined: "Not accepted", waitlist: "Waitlist" };

export default function Forms() {
  const { session, profile } = useAuth();
  const [forms, setForms] = useState<Form[]>([]);
  const [mine, setMine] = useState<Resp[]>([]);
  const [open, setOpen] = useState<Form | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const load = () => {
    supabase.from("forms").select("id, slug, title, subtitle, description, fields").eq("is_open", true).order("created_at").then(({ data }) => setForms((data ?? []) as Form[]));
    supabase.from("form_responses").select("id, form_id, status, created_at").order("created_at", { ascending: false }).then(({ data }) => setMine((data ?? []) as Resp[]));
  };
  useEffect(load, []);

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
    setBusy(true);
    const { error } = await supabase.from("form_responses").insert({ form_id: open!.id, user_id: session!.user.id, answers });
    setBusy(false);
    if (error) { setError("Could not send. Check your connection and try again."); return; }
    setDone(open!.title); setOpen(null); setAnswers({}); load();
  }

  if (open) return (
    <section className="view">
      <button className="linkbtn" onClick={() => setOpen(null)}>← Forms</button>
      <form className="card formcard" onSubmit={submit} noValidate>
        <div className="formhead">
          <h2>{open.title}</h2>
          {open.subtitle && <p className="muted">{open.subtitle}</p>}
          {open.description && <p>{open.description}</p>}
          <small className="muted">* Required</small>
        </div>
        {open.fields.map((f) => (
          <fieldset className="q" key={f.key} id={`q-${f.key}`}>
            <legend>{f.label}{f.required && <span className="req"> *</span>}</legend>
            {f.help && <small className="muted">{f.help}</small>}
            {f.type === "textarea" ? <textarea value={answers[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} />
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
          </fieldset>
        ))}
        <p className="err" role="alert">{error}</p>
        <button className="btn primary" disabled={busy}>{busy ? "Sending…" : "Submit"}</button>
      </form>
    </section>
  );

  return (
    <section className="view">
      <h1>Forms</h1>
      {done && <p className="ok" role="status">Thank you! Your response to “{done}” has been received.</p>}
      <h2>Open forms</h2>
      {forms.length ? <div className="list">
        {forms.map((f) => {
          const sent = mine.find((r) => r.form_id === f.id);
          return (
            <button key={f.id} onClick={() => start(f)}>
              <div className="grow"><b>{f.title}</b><br /><small className="muted">{f.subtitle}</small></div>
              {sent ? <span className="pill sent">Sent</span> : <span className="pill soon">Fill in</span>}
            </button>);
        })}
      </div> : <div className="empty"><b>No open forms right now</b>New registrations will appear here.</div>}
      <h2>My responses</h2>
      {mine.length ? <div className="list">{mine.map((r) => (
        <div key={r.id}><div className="grow"><b>{forms.find((f) => f.id === r.form_id)?.title ?? "Form"}</b><br />
          <small className="muted">Sent {new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</small></div>
          <span className={`pill ${r.status === "accepted" ? "paid" : r.status === "declined" ? "failed" : ""}`}>{STATUS[r.status] ?? r.status}</span></div>
      ))}</div> : <div className="empty"><b>You have not sent any forms yet</b></div>}
    </section>
  );
}
