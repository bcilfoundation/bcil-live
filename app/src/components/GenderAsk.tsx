import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

const SNOOZE = "bcil.gender.later";
type G = "male" | "female" | "prefer_not";

// A one-time question on Home, after the tour and the birthday question. "Not now" asks again in 14 days.
export default function GenderAsk() {
  const { session, profile, refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [g, setG] = useState<G | "">("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");

  useEffect(() => {
    if (!profile || profile.is_org || profile.gender !== null) return;   // undefined = database not updated yet
    try { if (Date.now() - Number(localStorage.getItem(SNOOZE) || 0) < 14 * 864e5) return; } catch { /* ignore */ }
    let gone = false;
    const w = window as unknown as { __tourOn?: boolean; __bdayOpen?: boolean };
    const show = () => {
      if (gone) return;
      if (w.__tourOn) { window.addEventListener("bcil-tour-end", () => setTimeout(show, 3500), { once: true }); return; }
      if (w.__bdayOpen) { window.addEventListener("bcil-bday-closed", () => setTimeout(show, 800), { once: true }); return; }
      setOpen(true);
    };
    let toured = !!profile.toured_at;
    try { toured = toured || !!localStorage.getItem("bcil.toured"); } catch { /* */ }
    const t = setTimeout(() => { if (toured) show(); else window.addEventListener("bcil-tour-end", () => setTimeout(show, 3500), { once: true }); }, 3000);
    return () => { gone = true; clearTimeout(t); };
  }, [profile?.id, profile?.gender]);

  function later() { try { localStorage.setItem(SNOOZE, String(Date.now())); } catch { /* ignore */ } setOpen(false); }
  async function save() {
    if (!g) { setErr("Choose one of the options."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.from("profile_private").upsert({ user_id: session!.user.id, gender: g, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) { setErr("Could not save. Check your connection and try again."); return; }
    setOpen(false); refreshProfile();
  }
  if (!open) return null;
  const opts: [G, string][] = [["male", "Male"], ["female", "Female"], ["prefer_not", "Prefer not to say"]];
  return (
    <div className="sheet-back" role="dialog" aria-modal="true" aria-labelledby="gender-h" onClick={later}>
      <div className="sheet bdaysheet" onClick={(e) => e.stopPropagation()}>
        <h2 id="gender-h">One more thing about you</h2>
        <p className="muted">What is your gender? Only you and BCIL staff can see this. It helps us send you the right messages and programmes.</p>
        <div className="bday-opts" role="radiogroup" aria-label="Gender">
          {opts.map(([k, t]) => (
            <label key={k} className={`bday-opt${g === k ? " on" : ""}`}>
              <input type="radio" name="gender" checked={g === k} onChange={() => setG(k)} />
              <span><b>{t}</b></span>
            </label>
          ))}
        </div>
        {err && <p className="err">{err}</p>}
        <button className="btn primary block" onClick={save} disabled={busy || !g}>{busy ? "Saving…" : "Save"}</button>
        <button className="btn ghost block" onClick={later}>Not now</button>
      </div>
    </div>
  );
}
