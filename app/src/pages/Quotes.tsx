import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { enablePush, pushEnabled, pushSupported } from "../lib/push";
import { isNative } from "../lib/native";

type Quote = { id: number; show_on: string; theme: string | null; body: string; author: string; reflection: string | null };
const dayName = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };

// Daily Bite: today's bite, the last 7 days, and any day by date. Like and share; no categories.
export default function Quotes() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [pick, setPick] = useState("");
  const [found, setFound] = useState<Quote | null | undefined>(undefined);
  const { session } = useAuth();
  const me = session!.user.id;
  const [likes, setLikes] = useState<Record<number, { n: number; mine: boolean }>>({});

  useEffect(() => {
    // the database only returns bites up to today, newest first
    supabase.from("quotes").select("*").order("show_on", { ascending: false }).limit(8)
      .then(({ data }) => setQuotes((data ?? []) as Quote[]));
  }, []);
  const ids = [...quotes.map((x) => x.id), ...(found ? [found.id] : [])];
  useEffect(() => {
    if (!ids.length) return;
    supabase.from("quote_likes").select("quote_id, user_id").in("quote_id", ids).then(({ data }) => {
      const m: Record<number, { n: number; mine: boolean }> = {};
      for (const r of data ?? []) { const c = (m[r.quote_id] ??= { n: 0, mine: false }); c.n++; if (r.user_id === me) c.mine = true; }
      setLikes(m);
    });
  }, [ids.join(",")]);
  const q = quotes[0];
  useEffect(() => { if (q) supabase.from("quote_reads").insert({ user_id: me, quote_id: q.id }).then(() => {}, () => {}); }, [q?.id]);
  async function toggleLike(id: number) {
    const cur = likes[id] ?? { n: 0, mine: false };
    setLikes((m) => ({ ...m, [id]: { n: cur.n + (cur.mine ? -1 : 1), mine: !cur.mine } }));
    const r = cur.mine ? await supabase.from("quote_likes").delete().eq("quote_id", id).eq("user_id", me)
      : await supabase.from("quote_likes").insert({ quote_id: id, user_id: me });
    if (r.error) setLikes((m) => ({ ...m, [id]: cur }));
  }
  async function findDay(d: string) {
    setPick(d); setFound(undefined);
    if (!d) return;
    const { data } = await supabase.from("quotes").select("*").eq("show_on", d).maybeSingle();
    setFound((data as Quote | null) ?? null);
  }
  const Bite = ({ x, big }: { x: Quote; big?: boolean }) => {
    const l = likes[x.id] ?? { n: 0, mine: false };
    return (
      <div className={big ? "quote" : "card bitecard"}>
        <span className="eyebrow">{big && x.show_on === today() ? "Today · " : ""}{dayName(x.show_on)}</span>
        {big ? <blockquote>“{x.body}”</blockquote> : <b>“{x.body}”</b>}
        <cite className={big ? "" : "muted small"}>— {x.author}</cite>
        {big && x.reflection && <p className="muted">Reflect: {x.reflection}</p>}
        <div className="row" style={{ gap: 8 }}>
          <button className={`likebtn${l.mine ? " on" : ""}`} onClick={() => toggleLike(x.id)} aria-pressed={l.mine} aria-label={l.mine ? "Unlike" : "Like"}>{l.mine ? "❤️" : "🤍"} {l.n || ""}</button>
          <button className={big ? "btn primary sm" : "btn ghost sm"} onClick={() => shareBite(x)}>Share</button>
        </div>
      </div>
    );
  };

  return (
    <section className="view">
      <h1>Daily Bite</h1>
      <QuoteAlerts me={me} />
      {q ? <Bite x={q} big /> : <div className="empty"><b>No bites yet</b>Admins add them from the Admin page.</div>}
      <div className="row bitefind">
        <label className="field grow">Find the bite for a day<input type="date" value={pick} max={today()} onChange={(e) => findDay(e.target.value)} /></label>
        {pick && <button className="linkbtn" onClick={() => findDay("")}>Clear</button>}
      </div>
      {pick && (found === undefined ? <p className="muted">Looking…</p> : found ? <Bite x={found} /> : <p className="muted">No bite was shared on {dayName(pick)}.</p>)}
      {quotes.length > 1 && <>
        <h2>This past week</h2>
        <div className="grid2">{quotes.slice(1).map((x) => <Bite key={x.id} x={x} />)}</div>
      </>}
    </section>
  );
}

export async function shareBite(x: { body: string; author: string }) {
  const text = `“${x.body}” — ${x.author}\n\nBCIL Foundation · Daily Bite\n${location.origin}${import.meta.env.BASE_URL}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); alert("Copied. Paste it on WhatsApp or your status."); }
  } catch { /* cancelled */ }
}

// "Get today's quote on your phone every morning" — turns on phone notifications and the quote setting
function QuoteAlerts({ me }: { me: string }) {
  const [push, setPush] = useState<boolean | null>(null);
  const [want, setWant] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushEnabled().then(setPush).catch(() => setPush(false));
    supabase.from("profiles").select("notify_quotes").eq("id", me).maybeSingle().then(({ data }) => { if (data) setWant(data.notify_quotes !== false); });
  }, [me]);
  if (push === null) return null;
  const iosBrowser = !isNative && /iPhone|iPad/.test(navigator.userAgent) && !pushSupported();
  const turnOn = async () => {
    setBusy(true); setMsg("");
    try {
      await enablePush(me);
      await supabase.from("profiles").update({ notify_quotes: true }).eq("id", me);
      setPush(true); setWant(true);
      try { localStorage.setItem("bcil-alerts", "push"); } catch { /* ignore */ }
      setMsg("Done! Today's bite will arrive on this phone every morning at 6:00 am.");
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };
  const setQuotes = async (on: boolean) => {
    setWant(on);
    const { error } = await supabase.from("profiles").update({ notify_quotes: on }).eq("id", me);
    if (error) setWant(!on);
  };
  if (push && want) return (
    <div className="quotealert on"><span>🔔 The Daily Bite comes to this phone every morning.</span>
      <button className="linkbtn" onClick={() => setQuotes(false)}>Turn off</button></div>
  );
  return (
    <div className="quotealert">
      <div className="grow"><b>Get the Daily Bite on your phone</b>
        <small className="muted">{iosBrowser ? "On iPhone: tap Share → Add to Home Screen, open BCIL Live from your home screen, then come back here." : "A notification every morning at 6:00 am, no need to open the app."}</small></div>
      {!iosBrowser && <button className="btn small primary" disabled={busy} onClick={push ? () => setQuotes(true) : turnOn}>{busy ? "…" : "Turn on"}</button>}
      {msg && <p className="muted" role="status" style={{ width: "100%", margin: 0 }}>{msg}</p>}
    </div>
  );
}
