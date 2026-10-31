import { useState } from "react";
import { supabase } from "../lib/supabase";

// Sign in with a Ghana phone number and a 6-digit SMS code (Supabase phone auth),
// or with Google. Turn on the providers in Supabase > Authentication > Providers.
export default function SignIn() {
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
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
  async function sendEmail() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError("Enter a valid email address."); return; }
    setBusy(true); setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL, data: { full_name: name.trim() } },
    });
    setBusy(false);
    if (error) setError(error.message); else setEmailSent(true);
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
        <div className="brand"><img src={`${import.meta.env.BASE_URL}logo-wordmark.webp`} alt="BCIL Foundation" /><b>Live</b></div>
        <h1>Welcome</h1>
        <p className="muted">Live sessions, talks, daily quotes and the BCIL community.</p>
        <div className="chips">
          <button className="chip" aria-pressed={mode === "email"} onClick={() => setMode("email")}>Email</button>
          <button className="chip" aria-pressed={mode === "phone"} onClick={() => setMode("phone")}>Phone</button>
        </div>
        {mode === "email" ? (emailSent ? <>
          <p><b>Check your email.</b> We sent a sign-in link to {email}. Open it on this device to continue.</p>
          <button className="btn ghost" onClick={() => setEmailSent(false)}>Use a different email</button>
        </> : <>
          <label className="field">Your name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          <label className="field">Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@example.com" /></label>
          <button className="btn primary" disabled={busy} onClick={sendEmail}>Email me a sign-in link</button>
        </>) : !sent ? <>
          <label className="field">Your name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          <label className="field">Phone number<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="024 123 4567" /></label>
          <button className="btn primary" disabled={busy} onClick={sendCode}>Send me a code</button>
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
