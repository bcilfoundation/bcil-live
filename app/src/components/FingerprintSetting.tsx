import { useEffect, useState } from "react";
import { addPasskey, myPasskeys, passkeySupported, removePasskey } from "../lib/passkey";

// More page: turn fingerprint / Face ID sign-in on or off for this account.
export default function FingerprintSetting() {
  const [ok, setOk] = useState(false);
  const [keys, setKeys] = useState<{ id: string; name?: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = async () => setKeys(await myPasskeys());
  useEffect(() => { passkeySupported().then((s) => { setOk(s); if (s) load(); }); }, []);
  if (!ok) return null;
  return (
    <div className="card fpset">
      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
        <div className="grow"><b>👆 Fingerprint sign-in</b>
          <small className="muted" style={{ display: "block" }}>{keys.length ? `On for ${keys.map((k) => k.name || "a device").join(", ")}` : "Sign in with your fingerprint or face instead of a password."}</small></div>
        <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); setMsg((await addPasskey()) ?? ""); await load(); setBusy(false); }}>{keys.length ? "Add this device" : "Turn on"}</button>
      </div>
      {keys.map((k) => (
        <div key={k.id} className="row" style={{ justifyContent: "space-between" }}>
          <small>{k.name || "Device"}</small>
          <button className="linkbtn" onClick={async () => { if (!window.confirm("Turn off fingerprint sign-in for this device?")) return; await removePasskey(k.id); load(); }}>Remove</button>
        </div>
      ))}
      {msg && <small className="err">{msg}</small>}
    </div>
  );
}
