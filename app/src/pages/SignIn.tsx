import { useState } from "react";
import { supabase } from "../lib/supabase";

// Sign in / create an account with email and password (works in any country).
// New accounts confirm their email with a 6-digit code; forgotten passwords are reset with a code too.
type Step = "signin" | "signup" | "confirm" | "forgot" | "reset" | "code" | "code-verify";

export default function SignIn() {
  const [step, setStep] = useState<Step>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const go = (s: Step) => { setStep(s); setError(""); setInfo(""); setCode(""); };
  const validEmail = () => /^\S+@\S+\.\S+$/.test(email.trim());
  async function task(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(friendly((e as Error).message)); } finally { setBusy(false); }
  }

  const signIn = (e: React.FormEvent) => { e.preventDefault(); task(async () => {
    if (!validEmail()) throw new Error("Enter a valid email address.");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }); };

  const signUp = (e: React.FormEvent) => { e.preventDefault(); task(async () => {
    if (name.trim().length < 2) throw new Error("Enter your full name.");
    if (!validEmail()) throw new Error("Enter a valid email address.");
    if (password.length < 8) throw new Error("Choose a password with at least 8 characters.");
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { full_name: name.trim() }, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    if (error) throw error;
    if (data.user && data.user.identities?.length === 0) throw new Error("An account with this email already exists. Sign in instead, or reset your password.");
    if (!data.session) { setStep("confirm"); setInfo(`We sent a 6-digit code to ${email.trim()}. Enter it to finish creating your account.`); }
  }); };

  const confirm = (e: React.FormEvent) => { e.preventDefault(); task(async () => {
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "signup" });
    if (error) throw new Error("That code did not work. Check the email, or tap “Send a new code”.");
  }); };

  const resendConfirm = () => task(async () => {
    const { error } = await supabase.auth.resend({ type: "signup", email: email.trim() });
    if (error) throw error;
    setInfo("A new code is on its way. Check your inbox and spam folder.");
  });

  const sendReset = (e: React.FormEvent) => { e.preventDefault(); task(async () => {
    if (!validEmail()) throw new Error("Enter the email address you signed up with.");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + import.meta.env.BASE_URL });
    if (error) throw error;
    setStep("reset"); setPassword(""); setInfo(`We sent a 6-digit code to ${email.trim()}. Enter it with your new password.`);
  }); };

  const doReset = (e: React.FormEvent) => { e.preventDefault(); task(async () => {
    if (password.length < 8) throw new Error("Choose a password with at least 8 characters.");
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "recovery" });
    if (error) throw new Error("That code did not work. Check the email, or request a new code.");
    const { error: e2 } = await supabase.auth.updateUser({ password });
    if (e2) throw e2;
  }); };

  const sendCode = (e: React.FormEvent) => { e.preventDefault(); task(async () => {
    if (!validEmail()) throw new Error("Enter a valid email address.");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
    if (error) throw error;
    setStep("code-verify"); setInfo(`We sent a 6-digit code to ${email.trim()}.`);
  }); };

  const verifyCode = (e: React.FormEvent) => { e.preventDefault(); task(async () => {
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) throw new Error("That code did not work. Check the email and try again.");
  }); };

  const emailField = <label className="field">Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@example.com" /></label>;
  const passwordField = (label: string, auto: string) => (
    <label className="field">{label}
      <span className="pwrow">
        <input value={password} onChange={(e) => setPassword(e.target.value)} type={show ? "text" : "password"} autoComplete={auto} minLength={auto === "new-password" ? 8 : undefined} />
        <button type="button" className="linkbtn" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>
      </span>
    </label>
  );
  const codeField = <label className="field">6-digit code<input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" /></label>;

  return (
    <div className="center">
      <div className="card signin">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}logo-wordmark.webp`} alt="BCIL Foundation" /><b>Live</b></div>
        <h1>{step === "signup" || step === "confirm" ? "Create your account" : step === "forgot" || step === "reset" ? "Reset your password" : "Welcome back"}</h1>
        <p className="muted">Live sessions, talks, daily quotes and the BCIL community.</p>

        {(step === "signin" || step === "signup") && (
          <div className="seg" role="tablist">
            <button type="button" role="tab" aria-selected={step === "signin"} onClick={() => go("signin")}>Sign in</button>
            <button type="button" role="tab" aria-selected={step === "signup"} onClick={() => go("signup")}>Create account</button>
          </div>
        )}
        {info && <p className="ok" role="status">{info}</p>}

        {step === "signin" && <form className="stack" onSubmit={signIn}>
          {emailField}{passwordField("Password", "current-password")}
          <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <button type="button" className="linkbtn" onClick={() => go("forgot")}>Forgot password?</button>
            <button type="button" className="linkbtn" onClick={() => go("code")}>Email me a sign-in code instead</button>
          </div>
        </form>}

        {step === "signup" && <form className="stack" onSubmit={signUp}>
          <label className="field">Full name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          {emailField}{passwordField("Choose a password (at least 8 characters)", "new-password")}
          <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        </form>}

        {step === "confirm" && <form className="stack" onSubmit={confirm}>
          {codeField}
          <button className="btn primary" disabled={busy || code.length < 6}>Confirm and continue</button>
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <button type="button" className="linkbtn" onClick={resendConfirm} disabled={busy}>Send a new code</button>
            <button type="button" className="linkbtn" onClick={() => go("signup")}>Use a different email</button>
          </div>
        </form>}

        {step === "forgot" && <form className="stack" onSubmit={sendReset}>
          <p className="muted">Enter your email and we'll send you a code to set a new password. If you used to sign in with a code, use this to create a password.</p>
          {emailField}
          <button className="btn primary" disabled={busy}>Send me a code</button>
          <button type="button" className="linkbtn" onClick={() => go("signin")}>← Back to sign in</button>
        </form>}

        {step === "reset" && <form className="stack" onSubmit={doReset}>
          {codeField}{passwordField("New password (at least 8 characters)", "new-password")}
          <button className="btn primary" disabled={busy || code.length < 6}>Save new password</button>
          <button type="button" className="linkbtn" onClick={() => go("forgot")}>Send a new code</button>
        </form>}

        {step === "code" && <form className="stack" onSubmit={sendCode}>
          <p className="muted">For existing accounts: we'll email you a one-time code instead of using a password.</p>
          {emailField}
          <button className="btn primary" disabled={busy}>Email me a code</button>
          <button type="button" className="linkbtn" onClick={() => go("signin")}>← Back to sign in</button>
        </form>}

        {step === "code-verify" && <form className="stack" onSubmit={verifyCode}>
          {codeField}
          <button className="btn primary" disabled={busy || code.length < 6}>Sign in</button>
          <button type="button" className="linkbtn" onClick={() => go("code")}>Use a different email</button>
        </form>}

        <p className="err" role="alert">{error}</p>
        <small className="muted">By continuing you agree to our <a href={`${import.meta.env.BASE_URL}privacy`} style={{ textDecoration: "underline" }}>privacy policy</a>.</small>
      </div>
    </div>
  );
}

function friendly(msg: string) {
  if (/invalid login credentials/i.test(msg)) return "Wrong email or password. Try again, or tap “Forgot password?”.";
  if (/email not confirmed/i.test(msg)) return "Please confirm your email first. Create the account again to get a new code.";
  if (/signups not allowed for otp|user not found/i.test(msg)) return "No account uses this email yet. Tap “Create account”.";
  if (/rate limit|too many/i.test(msg)) return "Too many attempts. Please wait a few minutes and try again.";
  if (/password should be|weak password/i.test(msg)) return "Choose a stronger password (at least 8 characters, mixing letters and numbers).";
  return msg;
}
