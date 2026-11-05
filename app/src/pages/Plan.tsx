import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

export const YEAR = 2027;
export const AREAS = ["Studies", "Career", "Faith and purpose", "Health", "Money", "Relationships", "Leadership and service", "Personal growth"];
export type Goal = { id?: number; plan_id?: number; area: string | null; title: string; success: string | null; q1: string | null; q2: string | null; q3: string | null; q4: string | null; first_actions: string | null; progress: number; sort: number };
export type PlanRow = { id: number; user_id: string; year: number; theme: string | null; vision: string | null; habits_build: string | null; habits_drop: string | null; status: "draft" | "submitted"; submitted_at: string | null; feedback: string | null; feedback_at: string | null; updated_at: string };
type Checkin = { id: number; note: string; score: number | null; created_at: string };
const blankGoal = (sort: number): Goal => ({ area: null, title: "", success: "", q1: "", q2: "", q3: "", q4: "", first_actions: "", progress: 0, sort });
const QUARTERS: [keyof Goal, string][] = [["q1", "By end of March"], ["q2", "By end of June"], ["q3", "By end of September"], ["q4", "By end of December"]];

// Plan 2027: each member writes a one-year plan (a theme, 3–5 goals with quarterly milestones, habits), submits it
// for feedback, then updates progress and checks in every month.
export default function Plan() {
  const { session, profile } = useAuth();
  const me = session!.user.id;
  const [plan, setPlan] = useState<PlanRow | null | undefined>(undefined);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [edit, setEdit] = useState(false);
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
          <li><b>Set 3–5 goals</b> across your life: studies, career, faith, health, money, relationships, leadership.</li>
          <li><b>Break each goal down</b> into what success looks like, a milestone for each quarter, and your first actions.</li>
          <li><b>Pick your habits:</b> what to build and what to drop.</li>
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

      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
        <h2 style={{ margin: 0 }}>Goals</h2><span className="muted">{avg}% overall</span>
      </div>
      <div className="planprog"><span style={{ width: `${avg}%` }} /></div>
      {goals.length === 0 && <p className="muted">No goals yet. Tap “Edit plan” to add them.</p>}
      {goals.map((g) => <GoalCard key={g.id} g={g} onProgress={async (v) => { await supabase.from("plan_goals").update({ progress: v }).eq("id", g.id!); setGoals((x) => x.map((y) => (y.id === g.id ? { ...y, progress: v } : y))); }} />)}

      {(plan.habits_build || plan.habits_drop) && <div className="grid2" style={{ marginTop: 12 }}>
        {plan.habits_build && <div className="card"><span className="eyebrow">Habits to build</span><p className="prewrap">{plan.habits_build}</p></div>}
        {plan.habits_drop && <div className="card"><span className="eyebrow">Habits to drop</span><p className="prewrap">{plan.habits_drop}</p></div>}
      </div>}

      <CheckIns planId={plan.id} list={checkins} reload={load} />
    </section>
  );
}

function GoalCard({ g, onProgress }: { g: Goal; onProgress: (v: number) => void }) {
  const [v, setV] = useState(g.progress);
  const t = useRef<number>();
  return (
    <div className="card goalcard">
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <div className="grow">{g.area && <span className="pill">{g.area}</span>}<b style={{ display: "block", marginTop: 4 }}>{g.title}</b></div>
        <b className="goalpct">{v}%</b>
      </div>
      {g.success && <p className="muted small" style={{ margin: "6px 0" }}>Success looks like: {g.success}</p>}
      <div className="quarters">{QUARTERS.map(([k, label]) => g[k] ? <div key={k}><small className="muted">{label}</small><span>{g[k] as string}</span></div> : null)}</div>
      {g.first_actions && <p className="small" style={{ margin: "6px 0 0" }}><b>First actions:</b> {g.first_actions}</p>}
      <input type="range" min={0} max={100} step={5} value={v} aria-label={`Progress on ${g.title}`}
        onChange={(e) => { const n = Number(e.target.value); setV(n); clearTimeout(t.current); t.current = window.setTimeout(() => onProgress(n), 500); }} />
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

function PlanEditor({ plan, goals: initial, done }: { plan: PlanRow; goals: Goal[]; done: () => void }) {
  const [p, setP] = useState({ theme: plan.theme ?? "", vision: plan.vision ?? "", habits_build: plan.habits_build ?? "", habits_drop: plan.habits_drop ?? "" });
  const [goals, setGoals] = useState<Goal[]>(initial.length ? initial : [blankGoal(0)]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const setG = (i: number, patch: Partial<Goal>) => setGoals((x) => x.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  async function save() {
    setErr("");
    const keep = goals.filter((g) => g.title.trim());
    if (keep.length > 5) { setErr("Keep it to five goals at most: fewer goals, done well."); return; }
    setBusy(true);
    const { error } = await supabase.from("plans").update({ theme: p.theme.trim() || null, vision: p.vision.trim() || null, habits_build: p.habits_build.trim() || null, habits_drop: p.habits_drop.trim() || null, updated_at: new Date().toISOString() }).eq("id", plan.id);
    if (error) { setErr(error.message); setBusy(false); return; }
    const gone = initial.filter((g) => !keep.some((k) => k.id === g.id)).map((g) => g.id!);
    if (gone.length) await supabase.from("plan_goals").delete().in("id", gone);
    for (const [i, g] of keep.entries()) {
      const row = { plan_id: plan.id, area: g.area || null, title: g.title.trim(), success: g.success?.trim() || null, q1: g.q1?.trim() || null, q2: g.q2?.trim() || null, q3: g.q3?.trim() || null, q4: g.q4?.trim() || null, first_actions: g.first_actions?.trim() || null, progress: g.progress, sort: i };
      const { error: e } = g.id ? await supabase.from("plan_goals").update(row).eq("id", g.id) : await supabase.from("plan_goals").insert(row);
      if (e) { setErr(e.message); setBusy(false); return; }
    }
    setBusy(false); done();
  }
  return (
    <section className="view planedit">
      <button className="linkbtn" onClick={done}>← Back without saving</button>
      <h1>My {YEAR} plan</h1>
      <label className="field">Theme or word for {YEAR}<input value={p.theme} onChange={(e) => setP({ ...p, theme: e.target.value })} placeholder="e.g. Focus, Year of Excellence, Build" maxLength={80} /></label>
      <label className="field">Where do you want to be by December {YEAR}?<textarea value={p.vision} onChange={(e) => setP({ ...p, vision: e.target.value })} placeholder="A few sentences: who you want to become and what you want to have achieved" /></label>
      <h2>Goals <small className="muted">(3–5)</small></h2>
      {goals.map((g, i) => (
        <div key={g.id ?? `n${i}`} className="card goaledit">
          <div className="row" style={{ justifyContent: "space-between" }}><b>Goal {i + 1}</b>
            {goals.length > 1 && <button className="linkbtn" onClick={() => setGoals((x) => x.filter((_, j) => j !== i))}>Remove</button>}</div>
          <label className="field">Area<select value={g.area ?? ""} onChange={(e) => setG(i, { area: e.target.value || null })}><option value="">Choose…</option>{AREAS.map((a) => <option key={a}>{a}</option>)}</select></label>
          <label className="field">The goal<input value={g.title} onChange={(e) => setG(i, { title: e.target.value })} placeholder="e.g. Finish the year with a CGPA of 3.5" maxLength={140} /></label>
          <label className="field">What does success look like?<input value={g.success ?? ""} onChange={(e) => setG(i, { success: e.target.value })} placeholder="How you'll know you've done it" /></label>
          <div className="grid2">{QUARTERS.map(([k, label]) => <label key={k} className="field">{label}<input value={(g[k] as string) ?? ""} onChange={(e) => setG(i, { [k]: e.target.value } as Partial<Goal>)} /></label>)}</div>
          <label className="field">First actions (this month)<textarea value={g.first_actions ?? ""} onChange={(e) => setG(i, { first_actions: e.target.value })} /></label>
        </div>
      ))}
      {goals.length < 5 && <button className="btn ghost sm" onClick={() => setGoals((x) => [...x, blankGoal(x.length)])}>+ Add a goal</button>}
      <h2>Habits</h2>
      <label className="field">Habits to build<textarea value={p.habits_build} onChange={(e) => setP({ ...p, habits_build: e.target.value })} placeholder="e.g. Read 20 pages a day, pray every morning, save GH₵ 50 a month" /></label>
      <label className="field">Habits to drop<textarea value={p.habits_drop} onChange={(e) => setP({ ...p, habits_drop: e.target.value })} placeholder="e.g. Scrolling after midnight" /></label>
      {err && <p className="err">{err}</p>}
      <button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save my plan"}</button>
    </section>
  );
}

/** A one-page (or more) PDF of the plan, to print or keep. */
export async function downloadPlan(plan: PlanRow, goals: Goal[], name?: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 18; let y = 22;
  const line = (text: string, size = 11, style: "normal" | "bold" | "italic" = "normal", color: [number, number, number] = [43, 52, 64]) => {
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color);
    for (const l of doc.splitTextToSize(text, W - 2 * M)) { if (y > 280) { doc.addPage(); y = 20; } doc.text(l, M, y); y += size * 0.45 + 1.2; }
  };
  line(`MY PLAN FOR ${plan.year}`, 10, "bold", [201, 162, 39]);
  line(plan.theme || `Plan ${plan.year}`, 22, "bold", [30, 63, 120]); y += 2;
  if (name) line(name, 11, "italic");
  if (plan.vision) { y += 3; line(plan.vision, 11); }
  goals.forEach((g, i) => {
    y += 5; line(`${i + 1}. ${g.title}${g.area ? `  (${g.area})` : ""}`, 13, "bold", [30, 63, 120]);
    if (g.success) line(`Success looks like: ${g.success}`, 10.5, "italic");
    QUARTERS.forEach(([k, label]) => { if (g[k]) line(`${label}: ${g[k]}`, 10.5); });
    if (g.first_actions) line(`First actions: ${g.first_actions}`, 10.5);
    line(`Progress: ${g.progress}%`, 10, "bold");
  });
  if (plan.habits_build) { y += 5; line("Habits to build", 12, "bold", [30, 63, 120]); line(plan.habits_build); }
  if (plan.habits_drop) { y += 3; line("Habits to drop", 12, "bold", [30, 63, 120]); line(plan.habits_drop); }
  y += 6; line("BCIL Foundation · Plan 2027 · Grooming Generational Leaders", 9, "italic", [120, 128, 140]);
  doc.save(`My ${plan.year} plan.pdf`);
}
