import { useState } from "react";
import { supabase } from "../lib/supabase";

// Sign in with a Ghana phone number and a 6-digit SMS code (Supabase phone auth),
// or with Google. Turn on the providers in Supabase > Authentication > Providers.
export default function SignIn() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const e164 = () => {
    const d = phone.replace(/\D/g, "");
    return d.startsWith("233") ? `+${d}` : `+233${d.replace(/^0/, "")}`;
  };

  async function sendCode() {
    if (!/^0?\d{9}$/.test(phone.replace(/\D/g, "").replace(/^233/, ""))) { setError("Enter a Ghana number, for example 024 123 4567."); return; }
    setBusy(true); setError("");
    const { error } = await supabase.auth.signInWithOtp({ phone: e164(), options: { data: { full_name: name.trim() } } });
    setBusy(false);
    if (error) setError(error.message); else setSent(true);
  }
  async function verify() {
    setBusy(true); setError("");
    const { error } = await supabase.auth.verifyOtp({ phone: e164(), token: code.trim(), type: "sms" });
    setBusy(false);
    if (error) setError("That code did not work. Check the SMS and try again.");
  }

  return (
    <div className="center">
      <div className="card signin">
        <div className="brand"><span className="mark">BCIL</span><b>BCIL<span>Live</span></b></div>
        <h1>Welcome</h1>
        <p className="muted">Live sessions, talks, daily quotes and the BCIL community.</p>
        {!sent ? <>
          <label className="field">Your name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          <label className="field">Phone number<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="024 123 4567" /></label>
          <button className="btn primary" disabled={busy} onClick={sendCode}>Send me a code</button>
          <button className="btn ghost" onClick={() => supabase.auth.signInWithOAuth({ provider: "google" })}>Continue with Google</button>
        </> : <>
          <label className="field">Code sent to {phone}<input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} /></label>
          <button className="btn primary" disabled={busy} onClick={verify}>Sign in</button>
          <button className="btn ghost" onClick={() => setSent(false)}>Use a different number</button>
        </>}
        <p className="err" role="alert">{error}</p>
      </div>
    </div>
  );
}
