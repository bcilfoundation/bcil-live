import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Field } from "../pages/Forms";

// Admin → FCB 2027: everything for Finding Campus Balance 2027 in one place
const FCB_FORMS: { slug: string; label: string; what: string }[] = [
  { slug: "fcb27-registration", label: "Participant registration", what: "Students sign up and get a QR ticket" },
  { slug: "fcb27-volunteer", label: "Volunteering", what: "Volunteers sign up for a team" },
  { slug: "fcb27-mentorship", label: "Mentorship registration", what: "Participants ask for a mentor for the year" },
  { slug: "fcb27-evaluation", label: "Evaluation", what: "Open it on the day, after the last session" },
];
type F = { id: string; slug: string; title: string; is_open: boolean; fields: Field[] };
const EVENT_DAY = new Date("2027-01-23T08:00:00Z");

export default function FcbHub({ isAdmin }: { isAdmin: boolean }) {
  const [forms, setForms] = useState<Record<string, F>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState("");
  const load = async () => {
    const { data } = await supabase.from("forms").select("id, slug, title, is_open, fields").in("slug", FCB_FORMS.map((f) => f.slug));
    setForms(Object.fromEntries(((data ?? []) as F[]).map((f) => [f.slug, f])));
    const c = await Promise.all(FCB_FORMS.map((f) => supabase.rpc("form_count", { p_slug: f.slug }).then(({ data }) => [f.slug, typeof data === "number" ? data : 0] as const)));
    setCounts(Object.fromEntries(c));
  };
  useEffect(() => { load(); }, []);
  const days = Math.ceil((+EVENT_DAY - Date.now()) / 864e5);
  async function toggle(f: F) {
    if (!confirm(f.is_open ? `Close "${f.title}"? People won't be able to fill it until you open it again.` : `Open "${f.title}" so people can fill it?`)) return;
    await supabase.from("forms").update({ is_open: !f.is_open }).eq("id", f.id); load();
  }
  function copy(slug: string) {
    navigator.clipboard?.writeText(`${location.origin}/register/${slug}`); setCopied(slug); setTimeout(() => setCopied(""), 2000);
  }
  return (
    <>
      <div className="card fcbhub-head">
        <span className="eyebrow">6th edition · Saturday 23 January 2027 · Auditorium 900, UCC</span>
        <h2 style={{ margin: "4px 0" }}>Finding Campus Balance 2027</h2>
        <p className="muted" style={{ margin: 0 }}>{days > 0 ? `${days} days to go` : days === 0 ? "Today!" : "The event has taken place"}</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <Link className="btn primary sm" to="/events/fcb2027">Programme page</Link>
          <Link className="btn ghost sm" to="/events/fcb2027?edit=1">✏️ Edit page</Link>
          <Link className="btn ghost sm" to="/checkin">📷 Scan tickets</Link>
          <Link className="btn ghost sm" to="/events/fcb27-volunteer-training">Volunteer training</Link>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Forms</h2>
        {FCB_FORMS.map(({ slug, label, what }) => {
          const f = forms[slug];
          return (
            <div key={slug} className="fcbform">
              <div className="grow"><b>{label}</b> {f ? <span className={`pill ${f.is_open ? "live" : "soon"}`}>{f.is_open ? "Open" : "Closed"}</span> : <span className="pill soon">Not set up</span>}
                <br /><small className="muted">{what}{f ? ` · ${(counts[slug] ?? 0).toLocaleString()} responses` : ""}</small></div>
              {f && <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {isAdmin && <Link className="btn ghost sm" to={`/admin?tab=Forms&form=${slug}`}>Responses</Link>}
                <button className="btn ghost sm" onClick={() => copy(slug)}>{copied === slug ? "Copied ✓" : "Copy link"}</button>
                <button className="btn ghost sm" onClick={() => toggle(f)}>{f.is_open ? "Close" : "Open"}</button>
              </div>}
            </div>
          );
        })}
        {!forms["fcb27-evaluation"] && <p className="err small">The evaluation form needs the database update 054_fcb_evaluation.</p>}
      </div>

      {forms["fcb27-evaluation"] && <EvalResults form={forms["fcb27-evaluation"]} total={counts["fcb27-evaluation"] ?? 0} />}
    </>
  );
}

// Evaluation results: every rating shown highest first, and the parts of the day ranked from best rated down
function EvalResults({ form, total }: { form: F; total: number }) {
  const [tally, setTally] = useState<{ field: string; answer: string; n: number }[] | null>(null);
  const [texts, setTexts] = useState<Record<string, string>[]>([]);
  useEffect(() => {
    supabase.rpc("form_tally", { p_slug: form.slug }).then(({ data }) => setTally((data ?? []) as never));
    supabase.from("form_responses").select("answers").eq("form_id", form.id).order("created_at", { ascending: false }).limit(200)
      .then(({ data }) => setTexts(((data ?? []) as { answers: Record<string, string> }[]).map((r) => r.answers)));
  }, [form.id]);
  if (!total) return <div className="card"><h2 style={{ marginTop: 0 }}>Evaluation results</h2><p className="muted">No evaluations yet. Results appear here as people send them, with the highest ratings first.</p></div>;
  if (!tally) return <div className="card"><p className="muted">Loading results…</p></div>;
  const rated = form.fields.filter((f) => f.type === "radio" && f.options?.some((o) => /^\d ·/.test(o)));
  const scaled = form.fields.filter((f) => f.type === "radio" && f.options && !rated.includes(f) && ["useful", "recommend", "mentorship"].includes(f.key));
  const count = (k: string, o: string) => tally.find((t) => t.field === k && t.answer === o)?.n ?? 0;
  const avg = (f: Field) => {
    let s = 0, n = 0;
    for (const o of f.options ?? []) { const m = /^(\d) ·/.exec(o); if (m) { const c = count(f.key, o); s += +m[1] * c; n += c; } }
    return n ? s / n : 0;
  };
  const ranking = [...rated].map((f) => ({ f, a: avg(f) })).filter((x) => x.a > 0).sort((x, y) => y.a - x.a);
  const bars = (f: Field) => {
    const opts = f.options ?? [];
    const n = opts.reduce((s, o) => s + count(f.key, o), 0) || 1;
    return <div className="evbars">{opts.map((o) => { const c = count(f.key, o); return (
      <div key={o} className="evbar"><span className="evbar-l">{o}</span><span className="evbar-t"><span style={{ width: `${(c / n) * 100}%` }} /></span><span className="evbar-n">{c}</span></div>
    ); })}</div>;
  };
  const list = (k: string, title: string) => {
    const xs = texts.filter((t) => (t[k] || "").trim()).slice(0, 30).map((t) => k === "testimonial" ? `${t[k].trim()} (sharing: ${t.share_ok || "not answered"})` : t[k].trim());
    return xs.length ? <details className="evtext"><summary>{title} ({xs.length})</summary><ul>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></details> : null;
  };
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Evaluation results · {total} {total === 1 ? "response" : "responses"}</h2>
      <h3>Ranked from highest to lowest (average out of 5)</h3>
      <ol className="evrank">{ranking.map(({ f, a }) => <li key={f.key}><span>{f.label.replace(/^Overall, how would you rate FCB 2027\?$/, "Overall")}</span><b>{a.toFixed(1)}</b></li>)}</ol>
      {[...rated, ...scaled].map((f) => <div key={f.key} className="evq"><b>{f.label}</b>{bars(f)}</div>)}
      {list("valuable", "Most valuable thing learned")}
      {list("improve", "What to improve")}
      {list("topics", "Topics for next time")}
      {list("testimonial", "Testimonials")}
      <small className="muted">Download every answer as a spreadsheet from Responses.</small>
    </div>
  );
}
