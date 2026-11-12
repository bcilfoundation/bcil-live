import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const SNOOZE = "bcil.bday.later";
type Choice = "celebrate" | "private" | "none";

// A one-time question on Home: "When is your birthday?" (day and month only). "Not now" asks again in 30 days.
export default function BirthdayAsk() {
  const { session } = useAuth();
  const me = session!.user.id;
  const [open, setOpen] = useState(false);
  const [m, setM] = useState(""); const [d, setD] = useState("");
  const [choice, setChoice] = useState<Choice | "">("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");

  useEffect(() => {
    try { if (Date.now() - Number(localStorage.getItem(SNOOZE) || 0) < 30 * 864e5) return; } catch { /* ignore */ }
    supabase.from("profiles").select("birthday_month, birthday_choice").eq("id", me).single().then(({ data, error }) => {
      if (error || !data) return;   // database not updated yet: don't ask
      const r = data as { birthday_month: number | null; birthday_choice: string | null };
      if (!r.birthday_month && !r.birthday_choice) setTimeout(() => setOpen(true), 1200);
    });
  }, [me]);

  function later() { try { localStorage.setItem(SNOOZE, String(Date.now())); } catch { /* ignore */ } setOpen(false); }
  async function save() {
    if (!choice) { setErr("Choose one of the options."); return; }
    if (choice !== "none" && (!m || !d)) { setErr("Choose the month and the day."); return; }
    setBusy(true); setErr("");
    const row = choice === "none"
      ? { birthday_choice: "none", birthday_month: null, birthday_day: null, show_birthday: false }
      : { birthday_choice: choice, birthday_month: Number(m), birthday_day: Number(d), show_birthday: choice === "celebrate" };
    const { error } = await supabase.from("profiles").update(row).eq("id", me);
    setBusy(false);
    if (error) { setErr("Could not save. Check your connection and try again."); return; }
    setOpen(false);
  }
  if (!open) return null;
  const max = m ? DAYS_IN[Number(m) - 1] : 31;
  const opts: [Choice, string, string][] = [
    ["celebrate", "Celebrate me with BCIL", "Your name and photo appear on Home on your birthday so the BCIL family can wish you well, and you get a birthday wish from us."],
    ["private", "Just a wish from BCIL", "We'll send you a birthday wish. Nothing is shown to others."],
    ["none", "Please don't", "Nobody is told. We keep no date."],
  ];
  return (
    <div className="sheet-back" role="dialog" aria-modal="true" aria-labelledby="bday-h" onClick={later}>
      <div className="sheet bdaysheet" onClick={(e) => e.stopPropagation()}>
        <h2 id="bday-h">🎂 When is your birthday?</h2>
        <p className="muted">Only the day and the month, never the year.</p>
        {choice !== "none" && <div className="row" style={{ gap: 10 }}>
          <select aria-label="Month" value={m} onChange={(e) => { setM(e.target.value); if (d && Number(d) > DAYS_IN[Number(e.target.value) - 1]) setD(""); }}>
            <option value="">Month</option>{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select>
          <select aria-label="Day" value={d} onChange={(e) => setD(e.target.value)}>
            <option value="">Day</option>{Array.from({ length: max }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select>
        </div>}
        <div className="bday-opts" role="radiogroup" aria-label="How should we celebrate you?">
          {opts.map(([k, t, sub]) => (
            <label key={k} className={`bday-opt${choice === k ? " on" : ""}`}>
              <input type="radio" name="bday" checked={choice === k} onChange={() => setChoice(k)} />
              <span><b>{t}</b><small>{sub}</small></span>
            </label>
          ))}
        </div>
        {err && <p className="err">{err}</p>}
        <button className="btn primary block" onClick={save} disabled={busy || !choice}>{busy ? "Saving…" : "Save"}</button>
        <button className="btn ghost block" onClick={later}>Not now</button>
      </div>
    </div>
  );
}
