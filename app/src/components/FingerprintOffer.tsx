import { useEffect, useState } from "react";
import { addPasskey, myPasskeys, passkeySupported } from "../lib/passkey";

// After someone signs in, offer once to turn on fingerprint / Face ID sign-in for next time.
export default function FingerprintOffer() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let off = false;
    (async () => {
      try { if (localStorage.getItem("bcil.passkey") || Date.now() - Number(localStorage.getItem("bcil.passkey.later") || 0) < 30 * 864e5) return; } catch { return; }
      if (!(await passkeySupported())) return;
      if ((await myPasskeys()).length) { try { localStorage.setItem("bcil.passkey", "1"); } catch { /* */ } return; }
      if (!off) setShow(true);
    })();
    return () => { off = true; };
  }, []);
  if (!show) return null;
  const later = () => { try { localStorage.setItem("bcil.passkey.later", String(Date.now())); } catch { /* */ } setShow(false); };
  return (
    <div className="nudge fpoffer">
      <span className="fpicon" aria-hidden="true">👆</span>
      <div className="grow">
        <b>Sign in faster next time</b>
        <small className="muted">Use your fingerprint or face instead of typing your password.</small>
        {msg && <small className="err">{msg}</small>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary sm" disabled={busy} onClick={async () => { setBusy(true); const e = await addPasskey(); setBusy(false); if (e) setMsg(e); else setShow(false); }}>Turn on</button>
        <button className="btn ghost sm" onClick={later}>Not now</button>
      </div>
    </div>
  );
}
