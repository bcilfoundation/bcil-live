import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

export const YEAR = 2027;
export const AREAS = ["Studies", "Career", "Faith and purpose", "Health", "Money", "Relationships", "Leadership and service", "Personal growth"];
export const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export type Goal = { id?: number; plan_id?: number; area: string | null; title: string; description?: string | null; start_month?: number | null; end_month?: number | null; remark?: string | null; progress: number; sort: number;
  // from the first version of the planner (shown if filled in)
  success?: string | null; q1?: string | null; q2?: string | null; q3?: string | null; q4?: string | null; first_actions?: string | null };
export type PlanRow = { id: number; user_id: string; year: number; theme: string | null; vision: string | null; habits_build: string | null; habits_drop: string | null; status: "draft" | "submitted"; submitted_at: string | null; feedback: string | null; feedback_at: string | null; updated_at: string };
type Checkin = { id: number; note: string; score: number | null; created_at: string };
const blankGoal = (sort: number): Goal => ({ area: null, title: "", description: "", start_month: null, end_month: null, remark: "", progress: 0, sort });
const mon = (m?: number | null) => (m ? MONTHS[m - 1] : "");
/** Goals grouped by area (in the order of AREAS), numbered within each area, like Solomon's own plan. */
export function byArea(goals: Goal[]) {
  const names = [...new Set([...AREAS, ...goals.map((g) => g.area || "Other")])];
  return names.map((a) => [a, goals.filter((g) => (g.area || "Other") === a).sort((x, y) => x.sort - y.sort)] as const).filter(([, gs]) => gs.length);
}

// Plan 2027: each member writes a one-year plan in Solomon's format (theme, where they want to be, then
// area / goal / description / start / end / remark), submits it for feedback, then updates progress and checks in monthly.
export default function Plan() {
  const { session, profile } = useAuth();
  const me = session!.user.id;
  const [plan, setPlan] = useState<PlanRow | null | undefined>(undefined);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [edit, setEdit] = useState(false);
  const [track, setTrack] = useState(false);
  const load = async () => {
    const { data: p } = await supabase.from("plans").select("*").eq("user_id", me).eq("year", YEAR).maybeSingle();
    setPlan((p as PlanRow | null) ?? null);
    if (p) {
      const [{ data: g }, { data: c }] = await Promise.all([
        supabase.from("plan_goals").select("*").eq("plan_id", p.id).order("sort"),
        supabase.from("plan_checkins").select("id, note, score, created_at").eq("plan_id", p.id).order("created_at", { ascending: false }),
      ]);
      setGoals((g ?? []) as Goal[]); setCheckins((c ?? []) as Checkin[]);
    }
  };
  useEffect(() => { load(); }, []);

  async function start() {
    const { error } = await supabase.from("plans").insert({ user_id: me, year: YEAR });
    if (!error) { await load(); setEdit(true); }
  }

  if (plan === undefined) return <section className="view"><p className="muted">Loading…</p></section>;
  if (!plan) return (
    <section className="view">
      <Link to="/mentorship" className="linkbtn">← Mentorship</Link>
      <div className="card planhero">
        <span className="eyebrow">BCIL mentorship · free pilot</span>
        <h1>Plan {YEAR}</h1>
        <p>Start the year on purpose. Write a one-year plan for {YEAR}, get feedback from BCIL mentors, and keep going with monthly check-ins and quarterly reviews.</p>
        <ol className="plansteps">
          <li><b>Choose a theme</b> or a word for your year.</li>
          <li><b>Set your goals</b> across your life: studies, career, faith, health, money, relationships, leadership and personal growth. As many as you need, habits included.</li>
          <li><b>For each goal,</b> describe it and choose the month you'll start and the month you'll finish.</li>
          <li><b>Submit it</b> for feedback, then update your progress every month.</li>
        </ol>
        <button className="btn primary" onClick={start}>Start my {YEAR} plan</button>
        <small className="muted">Only you can see your plan until you submit it. Once submitted, BCIL mentors and staff can read it to give you feedback.</small>
      </div>
    </section>
  );

  if (edit) return <PlanEditor plan={plan} goals={goals} done={() => { setEdit(false); load(); }} />;

  const avg = goals.length ? Math.round(goals.reduce((s, g) => s + g.progress, 0) / goals.length) : 0;
  return (
    <section className="view">
      <Link to="/mentorship" className="linkbtn">← Mentorship</Link>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
        <div><span className="eyebrow">My plan for {YEAR}</span><h1 style={{ margin: "2px 0" }}>{plan.theme || `Plan ${YEAR}`}</h1></div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost sm" onClick={() => setEdit(true)}>✏️ Edit plan</button>
          <button className="btn ghost sm" onClick={() => downloadPlan(plan, goals, profile?.full_name)}>⬇️ PDF</button>
        </div>
      </div>
      {plan.vision && <p className="prewrap">{plan.vision}</p>}

      {plan.status === "draft" ? (
        <div className="card planbar">
          <span><b>Draft.</b> When it's ready, submit it to get feedback from BCIL mentors.</span>
          <button className="btn primary sm" disabled={!goals.length} onClick={async () => { await supabase.rpc("submit_plan", { p_id: plan.id }); load(); }}>Submit for feedback</button>
        </div>
      ) : plan.feedback ? (
        <div className="card planfeedback"><span className="eyebrow">💬 Feedback from your mentor</span><p className="prewrap">{plan.feedback}</p></div>
      ) : <div className="card planbar"><span>✅ Submitted. Feedback will appear here.</span></div>}

      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginTop: 14, gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Goals and targets</h2>
        <span className="row" style={{ gap: 8, alignItems: "center" }}><span className="muted">{avg}% overall</span>
          {goals.length > 0 && <button className={`btn sm ${track ? "primary" : "ghost"}`} onClick={() => setTrack((v) => !v)}>{track ? "Done" : "Update progress and remarks"}</button>}</span>
      </div>
      <div className="planprog"><span style={{ width: `${avg}%` }} /></div>
      {goals.length === 0 && <p className="muted">No goals yet. Tap “Edit plan” to add them.</p>}
      <PlanTable goals={goals} onSave={track ? async (id, patch) => { setGoals((x) => x.map((y) => (y.id === id ? { ...y, ...patch } : y))); await supabase.from("plan_goals").update(patch).eq("id", id); } : undefined} />

      <CheckIns planId={plan.id} list={checkins} reload={load} />
    </section>
  );
}

/** The plan as a table in Solomon's format: Area, Goals, Description of goal, Start, End, Remark.
 *  With onSave, each row gets a progress picker and an editable remark. */
export function PlanTable({ goals, onSave }: { goals: Goal[]; onSave?: (id: number, patch: Partial<Goal>) => void }) {
  const groups = useMemo(() => byArea(goals), [goals]);
  if (!goals.length) return null;
  return (
    <div className="plantable-wrap">
      <table className="plantable">
        <thead><tr><th>Area</th><th>Goals</th><th>Description of goal</th><th>Start</th><th>End</th><th>Remark</th></tr></thead>
        <tbody>{groups.map(([area, gs]) => gs.map((g, n) => (
          <tr key={g.id ?? `${area}${n}`}>
            {n === 0 && <th scope="rowgroup" rowSpan={gs.length} className="planarea">{area}</th>}
            <td className="plangoal"><b>{n + 1}. {g.title}</b>{g.progress > 0 && <small className="muted"> · {g.progress}%</small>}</td>
            <td className="prewrap">{g.description || [g.success, g.q1, g.q2, g.q3, g.q4, g.first_actions].filter(Boolean).join("\n")}</td>
            <td>{mon(g.start_month)}</td><td>{mon(g.end_month)}</td>
            <td>{onSave ? <RemarkCell g={g} onSave={onSave} /> : <span className="prewrap">{g.remark}</span>}</td>
          </tr>)))}</tbody>
      </table>
    </div>
  );
}
function RemarkCell({ g, onSave }: { g: Goal; onSave: (id: number, patch: Partial<Goal>) => void }) {
  const [r, setR] = useState(g.remark ?? "");
  return (
    <div className="remarkcell">
      <select value={g.progress} onChange={(e) => onSave(g.id!, { progress: Number(e.target.value) })} aria-label={`Progress on ${g.title}`}>
        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => <option key={v} value={v}>{v === 100 ? "Done ✓" : `${v}%`}</option>)}
      </select>
      <textarea rows={2} value={r} onChange={(e) => setR(e.target.value)} onBlur={() => r.trim() !== (g.remark ?? "") && onSave(g.id!, { remark: r.trim() || null })} placeholder="e.g. Finished in March" aria-label={`Remark on ${g.title}`} maxLength={300} />
    </div>
  );
}

function CheckIns({ planId, list, reload }: { planId: number; list: Checkin[]; reload: () => void }) {
  const [note, setNote] = useState(""); const [score, setScore] = useState(0); const [busy, setBusy] = useState(false);
  const thisMonth = list.some((c) => new Date(c.created_at).getMonth() === new Date().getMonth() && new Date(c.created_at).getFullYear() === new Date().getFullYear());
  async function save() {
    if (!note.trim()) return; setBusy(true);
    await supabase.from("plan_checkins").insert({ plan_id: planId, note: note.trim(), score: score || null });
    setBusy(false); setNote(""); setScore(0); reload();
  }
  return (<>
    <h2 style={{ marginTop: 18 }}>Monthly check-ins</h2>
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <b>{thisMonth ? "Add another note" : "How did this month go?"}</b>
      <div className="row" style={{ gap: 6 }} role="radiogroup" aria-label="How do you feel about your progress?">
        {["😟", "😕", "😐", "🙂", "😄"].map((e, i) => <button key={e} className={`chip${score === i + 1 ? " on" : ""}`} aria-pressed={score === i + 1} onClick={() => setScore(i + 1)}>{e}</button>)}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What went well, what got in the way, and what you'll do next month" aria-label="Check-in note" />
      <button className="btn primary sm" style={{ alignSelf: "flex-start" }} disabled={busy || !note.trim()} onClick={save}>Save check-in</button>
    </div>
    <div className="list">{list.map((c) => <div key={c.id}><div className="grow">
      <small className="muted">{new Date(c.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}{c.score ? ` · ${["😟", "😕", "😐", "🙂", "😄"][c.score - 1]}` : ""}</small>
      <p className="prewrap" style={{ margin: "2px 0 0" }}>{c.note}</p></div></div>)}</div>
  </>);
}

function MonthPick({ value, onChange, label }: { value: number | null | undefined; onChange: (m: number | null) => void; label: string }) {
  return <select value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} aria-label={label}>
    <option value="">Choose…</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{new Date(YEAR, i, 1).toLocaleString("en-GB", { month: "long" })}</option>)}</select>;
}

function PlanEditor({ plan, goals: initial, done }: { plan: PlanRow; goals: Goal[]; done: () => void }) {
  const [p, setP] = useState({ theme: plan.theme ?? "", vision: plan.vision ?? "" });
  const [goals, setGoals] = useState<Goal[]>(initial.length ? initial : [blankGoal(0)]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const setG = (i: number, patch: Partial<Goal>) => setGoals((x) => x.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  async function save() {
    setErr("");
    const keep = goals.filter((g) => g.title.trim());
    if (keep.length > 60) { setErr("That's more than 60 goals. Please combine some of them."); return; }
    if (keep.some((g) => g.start_month && g.end_month && g.end_month < g.start_month)) { setErr("A goal ends before it starts. Check the start and end months."); return; }
    setBusy(true);
    const { error } = await supabase.from("plans").update({ theme: p.theme.trim() || null, vision: p.vision.trim() || null, updated_at: new Date().toISOString() }).eq("id", plan.id);
    if (error) { setErr(error.message); setBusy(false); return; }
    const gone = initial.filter((g) => !keep.some((k) => k.id === g.id)).map((g) => g.id!);
    if (gone.length) await supabase.from("plan_goals").delete().in("id", gone);
    for (const [i, g] of keep.entries()) {
      const row = { plan_id: plan.id, area: g.area || null, title: g.title.trim().slice(0, 140), description: g.description?.trim() || null,
        start_month: g.start_month || null, end_month: g.end_month || null, remark: g.remark?.trim() || null, progress: g.progress, sort: i };
      const { error: e } = g.id ? await supabase.from("plan_goals").update(row).eq("id", g.id) : await supabase.from("plan_goals").insert(row);
      if (e) { setErr(/column/i.test(e.message) ? "The new plan format isn't switched on yet. Please try again a little later." : e.message); setBusy(false); return; }
    }
    setBusy(false); done();
  }
  return (
    <section className="view planedit">
      <button className="linkbtn" onClick={done}>← Back without saving</button>
      <h1>My {YEAR} plan</h1>
      <label className="field">Theme or word for {YEAR}<input value={p.theme} onChange={(e) => setP({ ...p, theme: e.target.value })} placeholder="e.g. Focus, Year of Excellence, Build" maxLength={80} /></label>
      <label className="field">Where do you want to be by December {YEAR}?<textarea value={p.vision} onChange={(e) => setP({ ...p, vision: e.target.value })} placeholder="A few sentences: who you want to become and what you want to have achieved" /></label>
      <h2>Goals and targets</h2>
      <p className="muted small" style={{ marginTop: -6 }}>Add as many goals as you need, in any area. Habits you want to build or drop can be goals too.</p>
      {goals.map((g, i) => (
        <div key={g.id ?? `n${i}`} className="card goaledit">
          <div className="row" style={{ justifyContent: "space-between" }}><b>Goal {i + 1}</b>
            {goals.length > 1 && <button className="linkbtn" onClick={() => setGoals((x) => x.filter((_, j) => j !== i))}>Remove</button>}</div>
          <label className="field">Area<select value={g.area ?? ""} onChange={(e) => setG(i, { area: e.target.value || null })}><option value="">Choose…</option>{AREAS.map((a) => <option key={a}>{a}</option>)}</select></label>
          <label className="field">Goal<input value={g.title} onChange={(e) => setG(i, { title: e.target.value })} placeholder="e.g. Read 12 books" maxLength={140} /></label>
          <label className="field">Description of goal<textarea rows={3} value={g.description ?? ""} onChange={(e) => setG(i, { description: e.target.value })} placeholder="What you'll do. e.g. One book a month: 1. The Power of Now  2. The Psychology of Money …" /></label>
          <div className="grid2">
            <label className="field">Start<MonthPick label="Start month" value={g.start_month} onChange={(m) => setG(i, { start_month: m })} /></label>
            <label className="field">End<MonthPick label="End month" value={g.end_month} onChange={(m) => setG(i, { end_month: m })} /></label>
          </div>
          <label className="field">Remark <small className="muted">(optional, update it through the year)</small><input value={g.remark ?? ""} onChange={(e) => setG(i, { remark: e.target.value })} maxLength={300} /></label>
        </div>
      ))}
      <button className="btn ghost sm" onClick={() => setGoals((x) => [...x, { ...blankGoal(x.length), area: x[x.length - 1]?.area ?? null }])}>+ Add a goal</button>
      {err && <p className="err">{err}</p>}
      <button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save my plan"}</button>
    </section>
  );
}

/** The plan as a PDF in Solomon's format: a table of Area, Goals, Description of goal, Start, End, Remark. */
export async function downloadPlan(plan: PlanRow, goals: Goal[], name?: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const W = 297, H = 210, M = 12;
  const cols = [36, 52, 110, 18, 18, W - 2 * M - 234];
  const navy: [number, number, number] = [30, 63, 120], gold: [number, number, number] = [201, 162, 39], ink: [number, number, number] = [43, 52, 64];
  let y = 16;
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...navy);
  doc.text(`1 YEAR PLAN: GOALS & TARGETS FOR ${plan.year}`, M, y);
  doc.setFontSize(10.5); doc.setTextColor(...gold);
  const sub = [name, plan.theme ? `Theme: ${plan.theme}` : ""].filter(Boolean).join("   ·   ");
  if (sub) { y += 6; doc.text(sub, M, y); }
  if (plan.vision) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(9.5); doc.setTextColor(...ink);
    const l = doc.splitTextToSize(`Where I want to be by December ${plan.year}: ${plan.vision}`, W - 2 * M) as string[];
    doc.text(l, M, y + 6); y += l.length * 4 + 4;
  }
  y += 4;
  const header = () => {
    doc.setFillColor(...navy); doc.rect(M, y, W - 2 * M, 8, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
    let x = M; ["AREA", "GOALS", "DESCRIPTION OF GOAL", "START", "END", "REMARK"].forEach((h, i) => { doc.text(h, x + 2, y + 5.4); x += cols[i]; });
    y += 8;
  };
  header();
  doc.setDrawColor(200, 205, 215);
  for (const [area, gs] of byArea(goals)) {
    gs.forEach((g, n) => {
      doc.setFontSize(9);
      const desc = g.description || [g.success, g.q1, g.q2, g.q3, g.q4, g.first_actions].filter(Boolean).join("\n");
      const cells = [n === 0 ? area.toUpperCase() : "", `${n + 1}. ${g.title}`, desc ?? "", mon(g.start_month), mon(g.end_month), g.remark ?? ""]
        .map((c, i) => doc.splitTextToSize(c, cols[i] - 4) as string[]);
      const h = Math.max(...cells.map((c) => c.length)) * 4 + 4;
      if (y + h > H - 12) { doc.addPage(); y = 14; header(); }
      let x = M;
      cells.forEach((c, i) => {
        doc.rect(x, y, cols[i], h);
        doc.setFont("helvetica", i < 2 ? "bold" : "normal"); doc.setTextColor(...(i === 0 ? navy : ink));
        doc.text(c, x + 2, y + 5);
        x += cols[i];
      });
      y += h;
    });
  }
  doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(120, 128, 140);
  doc.text("BCIL Foundation · Plan 2027 · Grooming Generational Leaders", M, H - 7);
  doc.save(`My ${plan.year} plan.pdf`);
}
