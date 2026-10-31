import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Gift = { id: number; amount_pesewas: number; purpose: string; method: string; status: string; created_at: string };
const PURPOSES = ["General support", "FCB 2027", "Laptop for a student", "Refreshments for students", "Volunteer T-shirts & certificates", "Academic Mentorship"];
const cedis = (p: number) => `GH₵ ${(p / 100).toLocaleString("en-GH")}`;

export default function Give() {
  const [amount, setAmount] = useState("100");
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [network, setNetwork] = useState("mtn");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [gifts, setGifts] = useState<Gift[]>([]);

  const load = () => supabase.from("gifts").select("*").order("created_at", { ascending: false }).limit(20).then(({ data }) => setGifts((data ?? []) as Gift[]));
  useEffect(() => {
    load();
    // when Paystack confirms, the webhook marks the gift paid and the list refreshes
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  async function give(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setMsg("");
    const { data, error } = await supabase.functions.invoke("give", { body: { amount_cedis: Number(amount), purpose, network, phone } });
    setBusy(false);
    if (error || data?.error) { setError(data?.error ?? "Payment could not start. Try again."); return; }
    setMsg(data.message || "Check your phone and enter your Mobile Money PIN to approve.");
    load();
  }

  return (
    <section className="view">
      <h1>Give</h1>
      <p className="muted">FCB 2027 needs GH₵ 47,000 to serve about 1,000 students. GH₵ 20 covers one student's refreshment; GH₵ 5,000 buys a laptop for a student.</p>
      <form className="card" onSubmit={give}>
        <label className="field">Amount (GH₵)<input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" /></label>
        <label className="field">What is it for?<select value={purpose} onChange={(e) => setPurpose(e.target.value)}>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label className="field">Network<select value={network} onChange={(e) => setNetwork(e.target.value)}><option value="mtn">MTN MoMo</option><option value="telecel">Telecel Cash</option><option value="at">AT Money</option></select></label>
        <label className="field">Mobile Money number<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="024 123 4567" /></label>
        <p className="err" role="alert">{error}</p>
        {msg && <p className="ok" role="status">{msg}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "Starting…" : `Give GH₵ ${amount || 0}`}</button>
      </form>
      <h2>My giving</h2>
      {gifts.length ? <div className="list">{gifts.map((g) => (
        <div key={g.id}><div className="grow"><b>{cedis(g.amount_pesewas)}</b> · {g.purpose}<br /><small className="muted">{new Date(g.created_at).toLocaleDateString("en-GB")}</small></div><span className={`pill ${g.status}`}>{g.status}</span></div>
      ))}</div> : <div className="empty"><b>No gifts yet</b></div>}
    </section>
  );
}
