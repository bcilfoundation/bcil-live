import { visibleGifts } from "./Give";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import Icon from "../components/Icon";
import { MOMO, PURPOSES } from "./Give";

// My giving: every gift you've made, and a way to record one you already sent by Mobile Money, bank or cash.
type Gift = { id: number; amount_pesewas: number; purpose: string; method: string; status: string; note: string | null; created_at: string };
const cedis = (p: number) => `GH₵ ${(p / 100).toLocaleString("en-GH", { maximumFractionDigits: 2 })}`;
const STATUS: Record<string, string> = { paid: "Received", pending: "Waiting", failed: "Not completed", recorded: "Recorded" };
const METHODS: [string, string][] = [["mobile_money", "Mobile Money"], ["bank_transfer", "Bank transfer"], ["cash", "Cash"]];

export default function MyGiving() {
  const { session } = useAuth();
  const nav = useNavigate();
  const me = session!.user.id;
  const [gifts, setGifts] = useState<Gift[] | null>(null);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [method, setMethod] = useState("mobile_money");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => supabase.from("gifts").select("id, amount_pesewas, purpose, method, status, note, created_at").eq("user_id", me)
    .order("created_at", { ascending: false }).limit(200).then(({ data }) => setGifts((data ?? []) as Gift[]));
  useEffect(() => { load(); }, []);
  async function record(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const n = Number(amount);
    if (!n || n < 1) { setMsg({ ok: false, text: "Enter the amount you sent (at least GH₵ 1)." }); return; }
    setBusy(true);
    const { error } = await supabase.from("gifts").insert({ user_id: me, amount_pesewas: Math.round(n * 100), purpose, method, status: "recorded", note: note.trim() || null });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: "Could not record it. Try again." }); return; }
    setAmount(""); setNote(""); setMsg({ ok: true, text: "Recorded. Thank you for supporting BCIL Foundation!" }); load();
  }
  const year = new Date().getFullYear();
  const counted = (gifts ?? []).filter((g) => g.status === "paid" || g.status === "recorded");
  const thisYear = counted.filter((g) => new Date(g.created_at).getFullYear() === year).reduce((s, g) => s + g.amount_pesewas, 0);
  const allTime = counted.reduce((s, g) => s + g.amount_pesewas, 0);
  return (
    <section className="view giving">
      <button className="backbtn" onClick={() => nav("/settings")} aria-label="Back to settings"><Icon name="back" size={20} /></button>
      <h1>My giving</h1>
      <div className="givestats">
        <div className="card"><small className="muted">This year</small><b>{cedis(thisYear)}</b></div>
        <div className="card"><small className="muted">All time</small><b>{cedis(allTime)}</b></div>
      </div>
      <div className="card">
        <h3>How to give</h3>
        {MOMO ? <p>Send by <b>{MOMO.network}</b> to <b>{MOMO.number}</b> ({MOMO.name}), reference “BCIL”. You can also give on the <button className="linkbtn" onClick={() => nav("/donate")}>Donate</button> page. For a bank transfer, contact us at <a href="mailto:info@bcilfoundation.org">info@bcilfoundation.org</a>.</p>
          : <p>Contact us at <a href="mailto:info@bcilfoundation.org">info@bcilfoundation.org</a> for how to give.</p>}
      </div>
      <form className="card recordgift" onSubmit={record}>
        <h3>Record a gift you already sent</h3>
        <p className="muted small">So it shows in your giving history. This doesn't take any money.</p>
        <label className="field">Amount<div className="amtbox"><span>GH₵</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" aria-label="Amount in cedis" /></div></label>
        <span className="field">What is it for?</span>
        <div className="choicegrid">{PURPOSES.map((p) => <button type="button" key={p} className={`choicebtn${purpose === p ? " on" : ""}`} aria-pressed={purpose === p} onClick={() => setPurpose(p)}>{p}</button>)}</div>
        <span className="field">How you sent it</span>
        <div className="choicegrid three">{METHODS.map(([k, l]) => <button type="button" key={k} className={`choicebtn${method === k ? " on" : ""}`} aria-pressed={method === k} onClick={() => setMethod(k)}>{l}</button>)}</div>
        <label className="field">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="For example the transaction ID" /></label>
        {msg && <p className={msg.ok ? "ok" : "err"}>{msg.text}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Record gift"}</button>
      </form>
      <h3 className="setsub">History</h3>
      <div className="card setlist">
        {gifts === null ? <p className="muted pad">Loading…</p> : visibleGifts(gifts).length === 0 ? <p className="muted pad small">Your gifts will show here.</p> : visibleGifts(gifts).map((g) => (
          <div key={g.id} className="setrow"><span className="grow"><b>{cedis(g.amount_pesewas)}</b> · {g.purpose}
            <small className="muted">{new Date(g.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {METHODS.find((m) => m[0] === g.method)?.[1] ?? (g.method === "card" ? "Card" : g.method)}{g.note ? ` · ${g.note}` : ""}</small></span>
            <span className={`pill ${g.status}`}>{STATUS[g.status] ?? g.status}</span></div>))}
      </div>
    </section>
  );
}
