import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

type Field = { key: string; label: string; type: "text" | "tel" | "textarea" | "select"; required?: boolean; options?: string[] };
type Form = { id: string; title: string; subtitle: string | null; fields: Field[] };
type Resp = { id: number; form_id: string; status: string; created_at: string };

export default function Forms() {
  const { session } = useAuth();
  const [forms, setForms] = useState<Form[]>([]);
  const [mine, setMine] = useState<Resp[]>([]);
  const [open, setOpen] = useState<Form | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = () => {
    supabase.from("forms").select("id, title, subtitle, fields").eq("is_open", true).order("created_at").then(({ data }) => setForms((data ?? []) as Form[]));
    supabase.from("form_responses").select("id, form_id, status, created_at").order("created_at", { ascending: false }).then(({ data }) => setMine((data ?? []) as Resp[]));
  };
  useEffect(load, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing = open!.fields.find((f) => f.required && !answers[f.key]?.trim());
    if (missing) { setError(`Please fill in “${missing.label}”.`); return; }
    const { error } = await supabase.from("form_responses").insert({ form_id: open!.id, user_id: session!.user.id, answers });
    if (error) { setError("Could not send. Try again."); return; }
    setOpen(null); setAnswers({}); setError(""); load();
  }

  if (open) return (
    <section className="view">
      <button className="linkbtn" onClick={() => setOpen(null)}>← Forms</button>
      <form className="card" onSubmit={submit}>
        <h2>{open.title}</h2>{open.subtitle && <p className="muted">{open.subtitle}</p>}
        {open.fields.map((f) => (
          <label className="field" key={f.key}>{f.label}{f.required ? "" : " (optional)"}
            {f.type === "textarea" ? <textarea value={answers[f.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} />
              : f.type === "select" ? <select value={answers[f.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}><option value="">Choose…</option>{f.options?.map((o) => <option key={o}>{o}</option>)}</select>
              : <input type={f.type} value={answers[f.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} />}
          </label>
        ))}
        <p className="err" role="alert">{error}</p>
        <button className="btn primary">Send</button>
      </form>
    </section>
  );

  return (
    <section className="view">
      <h1>Forms</h1>
      <h2>Open forms</h2>
      <div className="list">
        {forms.map((f) => (
          <button key={f.id} onClick={() => setOpen(f)}>
            <div className="grow"><b>{f.title}</b><br /><small className="muted">{f.subtitle}</small></div>
            {mine.some((r) => r.form_id === f.id) && <span className="pill sent">Sent</span>}
          </button>
        ))}
      </div>
      <h2>My responses</h2>
      {mine.length ? <div className="list">{mine.map((r) => (
        <div key={r.id}><div className="grow"><b>{forms.find((f) => f.id === r.form_id)?.title ?? "Form"}</b><br />
          <small className="muted">Sent {new Date(r.created_at).toLocaleDateString("en-GB")} · {r.status}</small></div></div>
      ))}</div> : <div className="empty"><b>You have not sent any forms yet</b></div>}
    </section>
  );
}
