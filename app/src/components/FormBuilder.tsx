import { useState } from "react";
import { supabase } from "../lib/supabase";
import type { Field } from "../pages/Forms";

type FormDef = { id?: string; slug: string; title: string; subtitle: string | null; description: string | null; fields: Field[]; is_open: boolean; sensitive?: boolean };
const TYPES: [Field["type"], string][] = [
  ["text", "Short answer"], ["textarea", "Paragraph"], ["radio", "Multiple choice (pick one)"], ["checkbox", "Checkboxes (pick any)"],
  ["select", "Dropdown"], ["email", "Email"], ["tel", "Phone number"], ["number", "Number"], ["date", "Date"], ["section", "Section heading"],
];
const hasOptions = (t: Field["type"]) => t === "radio" || t === "checkbox" || t === "select";
const slugify = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "form";

// Admins create and edit forms like Google Forms: title, description, and questions of different types.
// Existing questions keep their internal key, so answers already received stay matched to them.
export default function FormBuilder({ form, close, saved }: { form: FormDef | null; close: () => void; saved: (id: string) => void }) {
  const [f, setF] = useState<FormDef>(form ?? { slug: "", title: "", subtitle: "", description: "", fields: [], is_open: false, sensitive: false });
  const [opts, setOpts] = useState<Record<number, string>>(() => Object.fromEntries((form?.fields ?? []).map((q, i) => [i, (q.options ?? []).join("\n")])));
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const isNew = !form?.id;

  const setQ = (i: number, patch: Partial<Field>) => setF((x) => ({ ...x, fields: x.fields.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const add = (type: Field["type"]) => {
    setF((x) => ({ ...x, fields: [...x.fields, { key: "", label: "", type, required: type !== "section" }] }));
    if (hasOptions(type)) setOpts((o) => ({ ...o, [f.fields.length]: "Option 1\nOption 2" }));
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= f.fields.length) return;
    setF((x) => { const a = [...x.fields]; [a[i], a[j]] = [a[j], a[i]]; return { ...x, fields: a }; });
    setOpts((o) => ({ ...o, [i]: o[j] ?? "", [j]: o[i] ?? "" }));
  };
  const remove = (i: number) => {
    if (!window.confirm("Remove this question? Answers people already gave to it stay in the downloaded responses only.")) return;
    setF((x) => ({ ...x, fields: x.fields.filter((_, j) => j !== i) }));
    setOpts((o) => { const n: Record<number, string> = {}; Object.entries(o).forEach(([k, v]) => { const ki = +k; if (ki < i) n[ki] = v; else if (ki > i) n[ki - 1] = v; }); return n; });
  };

  async function save() {
    if (!f.title.trim()) { setErr("Give the form a title."); return; }
    const used = new Set<string>();
    const fields: Field[] = [];
    for (const [i, q] of f.fields.entries()) {
      if (!q.label.trim()) { setErr(`Question ${i + 1} has no text.`); return; }
      const options = hasOptions(q.type) ? (opts[i] ?? "").split("\n").map((o) => o.trim()).filter(Boolean) : undefined;
      if (options && options.length < 2) { setErr(`“${q.label}” needs at least two options (one per line).`); return; }
      let key = q.key || slugify(q.label).replace(/-/g, "_").slice(0, 30) || `q${i + 1}`;
      while (used.has(key)) key += "_2";
      used.add(key);
      fields.push({ key, label: q.label.trim(), type: q.type, ...(q.type !== "section" && q.required ? { required: true } : {}), ...(q.help?.trim() ? { help: q.help.trim() } : {}), ...(options ? { options } : {}) });
    }
    if (!fields.some((q) => q.type !== "section")) { setErr("Add at least one question."); return; }
    setBusy(true); setErr("");
    const row = { title: f.title.trim(), subtitle: f.subtitle?.trim() || null, description: f.description?.trim() || null, fields, is_open: f.is_open, sensitive: !!f.sensitive };
    const res = isNew
      ? await supabase.from("forms").insert({ ...row, slug: `${slugify(f.title)}-${Date.now().toString(36).slice(-4)}` }).select("id").single()
      : await supabase.from("forms").update(row).eq("id", form!.id!).select("id").single();
    setBusy(false);
    if (res.error) { setErr(res.error.message); return; }
    saved(res.data.id);
  }

  return (
    <div className="card formbuilder">
      <div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>{isNew ? "New form" : "Edit form"}</h3><button className="linkbtn" onClick={close}>Close</button></div>
      <label className="field">Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Keys to Success 2027 Registration" /></label>
      <label className="field">Subtitle <small className="muted">(optional)</small><input value={f.subtitle ?? ""} onChange={(e) => setF({ ...f, subtitle: e.target.value })} /></label>
      <label className="field">Description <small className="muted">(shown at the top of the form)</small><textarea value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>

      <h4 style={{ margin: "8px 0 0" }}>Questions</h4>
      {f.fields.length === 0 && <p className="muted">No questions yet. Add one below.</p>}
      {f.fields.map((q, i) => (
        <div key={i} className={`fb-q${q.type === "section" ? " section" : ""}`}>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <b className="fb-n">{i + 1}</b>
            <select value={q.type} onChange={(e) => { const t = e.target.value as Field["type"]; setQ(i, { type: t }); if (hasOptions(t) && !opts[i]) setOpts((o) => ({ ...o, [i]: "Option 1\nOption 2" })); }} aria-label="Question type">
              {TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select>
            <span className="grow" />
            <button className="iconbtn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
            <button className="iconbtn sm" onClick={() => move(i, 1)} disabled={i === f.fields.length - 1} aria-label="Move down">↓</button>
            <button className="iconbtn sm" onClick={() => remove(i)} aria-label="Remove question">✕</button>
          </div>
          <input value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} placeholder={q.type === "section" ? "Section title" : "Question"} aria-label="Question text" />
          <input value={q.help ?? ""} onChange={(e) => setQ(i, { help: e.target.value })} placeholder={q.type === "section" ? "Section description (optional)" : "Hint under the question (optional)"} aria-label="Hint" />
          {hasOptions(q.type) && <label className="field">Options <small className="muted">one per line (add “Other” to let people type their own)</small>
            <textarea value={opts[i] ?? ""} onChange={(e) => setOpts((o) => ({ ...o, [i]: e.target.value }))} style={{ minHeight: 90 }} /></label>}
          {q.type !== "section" && <label className="check"><input type="checkbox" checked={!!q.required} onChange={(e) => setQ(i, { required: e.target.checked })} /> Required</label>}
        </div>
      ))}
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button className="btn ghost sm" onClick={() => add("text")}>+ Short answer</button>
        <button className="btn ghost sm" onClick={() => add("radio")}>+ Multiple choice</button>
        <button className="btn ghost sm" onClick={() => add("checkbox")}>+ Checkboxes</button>
        <button className="btn ghost sm" onClick={() => add("textarea")}>+ Paragraph</button>
        <button className="btn ghost sm" onClick={() => add("section")}>+ Section</button>
      </div>

      <label className="check"><input type="checkbox" checked={f.is_open} onChange={(e) => setF({ ...f, is_open: e.target.checked })} /> Open: members can see and fill it in</label>
      <label className="check"><input type="checkbox" checked={!!f.sensitive} onChange={(e) => setF({ ...f, sensitive: e.target.checked })} /> Sensitive: only admins can see the responses</label>
      {!isNew && <p className="muted small">Tip: if people have already answered, avoid deleting questions. Editing the wording is fine.</p>}
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : isNew ? "Create form" : "Save changes"}</button>
        <button className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
