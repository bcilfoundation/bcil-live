import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

// A small, one-time card for people who signed up before we asked (or with Google): add your date of birth.
export default function DobPrompt() {
  const { session } = useAuth();
  const [need, setNeed] = useState(false);
  const [dob, setDob] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const key = `bcil.dob.later.${session?.user.id}`;
  useEffect(() => {
    if (!session) return;
    try { if (Number(localStorage.getItem(key) || 0) > Date.now()) return; } catch { /* storage blocked */ }
    supabase.from("private_profiles").select("user_id").eq("user_id", session.user.id).maybeSingle()
      .then(({ data, error }) => { if (!error && !data) setNeed(true); });
  }, [session?.user.id]);
  if (!need) return null;
  const save = async () => {
    setErr(""); setBusy(true);
    const { error } = await supabase.rpc("set_birth_date", { p_date: dob });
    setBusy(false);
    if (error) { setErr(error.message.replace(/^.*?: /, "")); return; }
    setNeed(false);
  };
  const later = () => { try { localStorage.setItem(key, String(Date.now() + 7 * 864e5)); } catch { /* ignore */ } setNeed(false); };
  return (
    <div className="card dobprompt">
      <b>🎂 Add your date of birth</b>
      <small className="muted">Kept private (only you and BCIL admins can see it). It helps us keep younger members safe.</small>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} max={new Date().toISOString().slice(0, 10)} aria-label="Date of birth" style={{ maxWidth: 200 }} />
        <button className="btn primary sm" disabled={!dob || busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        <button className="linkbtn" onClick={later}>Later</button>
      </div>
      {err && <small className="err">{err}</small>}
    </div>
  );
}
