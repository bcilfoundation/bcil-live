import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { paymentsOn, startPayment } from "../lib/pay";
import { useAuth } from "../lib/auth";

// A small, polite ask to support BCIL Foundation, shown right after someone finishes something.
// Each person sees it at most once a week (any place counts), and "Not now" hides it for a week.
const KEY = "bcil-donate-prompt";
const WEEK = 7 * 24 * 3600 * 1000;
const seenRecently = (k: string) => { try { return Date.now() - Number(localStorage.getItem(k) || 0) < WEEK; } catch { return false; } };
const markSeen = (k: string) => { try { localStorage.setItem(k, String(Date.now())); } catch { /* storage off: show again next time */ } };

const COPY: Record<string, [string, string]> = {
  meet: ["Activities like this are free", "Supporters keep it that way. A gift of any size helps the next student."],
  feedback: ["Glad this helped?", "Feedback and activities like this are free because supporters give. Help the next person get the same."],
  plan: ["Your plan is saved", "BCIL Foundation keeps activities like this free with help from supporters. A gift of any size helps."],
  form: ["Thank you for signing up", "BCIL Foundation's programmes are possible because supporters give. Would you like to help?"],
  home: ["Support BCIL Foundation", "Help students through Finding Campus Balance, mentorship, Campus Sync and more. 100% goes to BCIL Foundation."],
};

// Home has its own weekly "Not now", so it doesn't use up the after-an-activity ask
export default function DonatePrompt({ where, purpose = "Where it's needed most", always = false }: { where: keyof typeof COPY; purpose?: string; always?: boolean }) {
  const key = where === "home" ? KEY + "-home" : KEY;
  const { isStaff } = useAuth();
  const nav = useNavigate();
  const [show] = useState(() => always || !seenRecently(key));
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { if (show && !always && where !== "home") markSeen(key); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show || hidden) return null;
  const [title, body] = COPY[where];
  const canPay = paymentsOn(isStaff);
  async function give() {
    setBusy(true); setMsg("");
    try { await startPayment({ kind: "donation", amount_cedis: 20, purpose }); setMsg("Finish on the Paystack page. Thank you!"); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="card donateprompt" role="note">
      <span className="donateprompt-ico" aria-hidden="true">💛</span>
      <div className="grow">
        <b>{title}</b>
        <p className="muted">{body}</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {canPay && <button className="btn primary sm" disabled={busy} onClick={give}>{busy ? "Opening Paystack…" : "Give GH₵ 20"}</button>}
          <button className="btn ghost sm" onClick={() => nav("/donate")}>{canPay ? "Other amount" : "Ways to give"}</button>
          {!always && <button className="linkbtn" onClick={() => { markSeen(key); setHidden(true); }}>Not now</button>}
        </div>
        {msg && <small className="muted">{msg}</small>}
      </div>
    </div>
  );
}
