import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { PAYMENTS_ENABLED, TEST_NOTE, paymentsOn, startPayment } from "../lib/pay";
import { useAuth } from "../lib/auth";

type Gift = { id: number; amount_pesewas: number; purpose: string; kind: string; status: string; created_at: string };
const PURPOSES = ["Where it's needed most", "Finding Campus Balance 2027", "Laptop for a student", "Refreshments for students", "Academic Mentorship", "Campus Sync", "Keys to Success"];
const AMOUNTS = [10, 20, 50, 100, 200, 500];
// Until Paystack is live, people can send Mobile Money straight to this number.
export const MOMO: { number: string; network: string; name: string } | null = null;
const cedis = (p: number) => `GH₵ ${(p / 100).toLocaleString("en-GH")}`;
const STATUS: Record<string, string> = { paid: "Received", pending: "Waiting", failed: "Not completed", recorded: "Recorded" };

// Give any amount to BCIL Foundation (Mobile Money or card through Paystack). 100% goes to BCIL.
export default function Give() {
  const { isStaff } = useAuth();
  const canPay = paymentsOn(isStaff);
  const [amount, setAmount] = useState("50");
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [gifts, setGifts] = useState<Gift[]>([]);

  const load = () => supabase.from("gifts").select("id, amount_pesewas, purpose, kind, status, created_at").order("created_at", { ascending: false }).limit(30)
    .then(({ data }) => setGifts((data ?? []) as Gift[]));
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  const go = async () => {
    setBusy(true); setError(""); setMsg("");
    try {
      await startPayment({ kind: "donation", amount_cedis: Number(amount), purpose });
      setMsg("Finish on the Paystack page (Mobile Money or card). Your gift shows below as Received once it's paid. Thank you!");
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!(Number(amount) >= 1)) { setError("Enter an amount of at least GH₵ 1."); return; }
    go();
  };
  const total = gifts.filter((g) => g.status === "paid").reduce((n, g) => n + g.amount_pesewas, 0);

  return (
    <section className="view">
      <h1>Give to BCIL Foundation</h1>
      <p className="muted">Your gift helps students through Finding Campus Balance, mentorship, Campus Sync and more. 100% goes to BCIL Foundation. GH₵ 20 covers one student's refreshment at FCB, and GH₵ 5,000 buys a laptop for a student.</p>
      {canPay && !PAYMENTS_ENABLED && <p className="testnote">{TEST_NOTE}</p>}
      {MOMO && <MomoCard />}
      {!canPay ? (
        !MOMO && <div className="card"><b>Giving in the app opens soon.</b><p className="muted">We're finishing setup with our payment provider. Thank you for wanting to help!</p></div>
      ) : (
        <form className="card stack" onSubmit={submit}>
          <div className="chips">{AMOUNTS.map((a) => <button type="button" key={a} className="chip" aria-pressed={amount === String(a)} onClick={() => setAmount(String(a))}>GH₵ {a}</button>)}</div>
          <label className="field">Amount (GH₵)<input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" /></label>
          <label className="field">What is it for?<select value={purpose} onChange={(e) => setPurpose(e.target.value)}>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</select></label>
          {error && <p className="err" role="alert">{error}</p>}
          {msg && <p className="ok" role="status">{msg}</p>}
          <button className="btn primary" disabled={busy}>{busy ? "Opening Paystack…" : `Give GH₵ ${amount || 0}`}</button>
          <small className="muted">Mobile Money (MTN, Telecel, AT) or card, on Paystack's secure page.</small>
        </form>
      )}
      <h2>My giving {total > 0 && <span className="muted">· {cedis(total)} in total, thank you!</span>}</h2>
      {gifts.length ? <div className="list">{gifts.map((g) => (
        <div key={g.id}><div className="grow"><b>{cedis(g.amount_pesewas)}</b> · {g.purpose}<br /><small className="muted">{new Date(g.created_at).toLocaleDateString("en-GB")}</small></div><span className={`pill ${g.status}`}>{STATUS[g.status] ?? g.status}</span></div>
      ))}</div> : <div className="empty"><b>No gifts yet</b></div>}
    </section>
  );
}

function MomoCard() {
  const [copied, setCopied] = useState(false);
  if (!MOMO) return null;
  const copy = () => navigator.clipboard?.writeText(MOMO.number.replace(/\s/g, "")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  return (
    <div className="card momo">
      <small className="muted">Send by Mobile Money</small>
      <div className="momo-row"><b className="momo-num">{MOMO.number}</b><button type="button" className="btn small" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button></div>
      <div><b>{MOMO.name}</b> · {MOMO.network}</div>
      <small className="muted">Use reference “BCIL” so we know it's a gift. Thank you!</small>
    </div>
  );
}
