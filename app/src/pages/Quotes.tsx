import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { enablePush, pushEnabled, pushSupported } from "../lib/push";
import { isNative } from "../lib/native";

type Quote = { id: number; show_on: string; theme: string | null; body: string; author: string; reflection: string | null };
const dayName = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
// Bites change at midnight Ghana time (GMT), the same moment members see the new one. Admins can read scheduled
// bites too, so every query stops at today: admins see exactly what members see, and plan ahead in Admin → Daily Bite.
export const biteDay = () => new Date().toISOString().slice(0, 10);
const today = biteDay;

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
    supabase.from("quotes").select("*").lte("show_on", biteDay()).order("show_on", { ascending: false }).limit(8)
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
  // comment and share counts for the bites on screen
  const [counts, setCounts] = useState<Record<number, { s: number; c: number }>>({});
  const [openC, setOpenC] = useState<number | null>(null);
  useEffect(() => {
    if (!ids.length) return;
    supabase.from("quotes").select("id, quote_shares(count), quote_comments(count)").in("id", ids).then(({ data, error }) => {
      if (error) return;
      const m: Record<number, { s: number; c: number }> = {};
      for (const r of (data ?? []) as { id: number; quote_shares: { count: number }[]; quote_comments: { count: number }[] }[]) m[r.id] = { s: r.quote_shares?.[0]?.count ?? 0, c: r.quote_comments?.[0]?.count ?? 0 };
      setCounts(m);
    });
  }, [ids.join(",")]);
  const bump = (id: number) => setCounts((m) => ({ ...m, [id]: { c: m[id]?.c ?? 0, s: (m[id]?.s ?? 0) + 1 } }));
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
    const { data } = d > biteDay() ? { data: null } : await supabase.from("quotes").select("*").eq("show_on", d).maybeSingle();
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
          <button className="likebtn" onClick={() => setOpenC((o) => (o === x.id ? null : x.id))} aria-expanded={openC === x.id} aria-label="Comments">💬 {counts[x.id]?.c || ""}</button>
          <button className={big ? "btn primary sm" : "btn ghost sm"} onClick={async () => { if (await shareBite(x)) bump(x.id); }}>Share{counts[x.id]?.s ? ` · ${counts[x.id].s}` : ""}</button>
        </div>
        {(big || openC === x.id) && <BiteComments quoteId={x.id} me={me} open={openC === x.id || !!big} onCount={(n) => setCounts((m) => ({ ...m, [x.id]: { s: m[x.id]?.s ?? 0, c: n } }))} />}
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

/** Share a Daily Bite as its branded image (card), with a short line of text. Returns true when it was shared. */
export async function shareBite(x: { id?: number; body: string; author: string; show_on?: string; reflection?: string | null }) {
  const link = `${location.origin}${import.meta.env.BASE_URL}`;
  const text = `BCIL Foundation · Daily Bite\n${link}\n#BCILFoundation #DailyBite #GroomingGenerationalLeaders`;
  const plain = `“${x.body}” — ${x.author}\n\n${text}`;
  const record = () => { if (x.id) supabase.from("quote_shares").insert({ quote_id: x.id }).then(() => {}, () => {}); };
  let blob: Blob | null = null;
  try {
    const { quoteBlob } = await import("../lib/quoteCard");
    blob = await quoteBlob({ body: x.body, author: x.author, show_on: x.show_on ?? new Date().toISOString().slice(0, 10), reflection: x.reflection });
  } catch { /* fall back to text */ }
  // 1. the Android app: save the card and open the phone's share sheet (WhatsApp, Instagram, Facebook…)
  if (blob && isNative) {
    try {
      const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
      const data = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(blob!); });
      const f = await Filesystem.writeFile({ path: `bcil-daily-bite-${x.show_on ?? "today"}.png`, data, directory: Directory.Cache });
      await Share.share({ files: [f.uri], text, dialogTitle: "Share the Daily Bite" });
      record(); return true;
    } catch (e) {
      if (/cancel/i.test(String((e as Error)?.message ?? e))) return false;
      /* older app without the share feature: fall through */
    }
  }
  // 2. phone browsers: share the card as a picture
  if (blob) {
    const file = new File([blob], "BCIL Daily Bite.png", { type: "image/png" });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); record(); return true; }
    } catch (e) { if ((e as Error)?.name === "AbortError") return false; }
    // 3. computers: save the card and copy the text, ready to attach to a post
    if (!isNative) {
      const { saveBlob } = await import("../lib/quoteCard");
      saveBlob(blob, `BCIL Daily Bite ${x.show_on ?? ""}.png`.trim());
      await navigator.clipboard?.writeText(text).catch(() => {});
      alert("The Daily Bite card is saved to your downloads, and the text is copied. Attach the picture to your post.");
      record(); return true;
    }
  }
  // 4. last resort: the words
  try {
    if (navigator.share) { await navigator.share({ text: plain }); record(); return true; }
    await navigator.clipboard.writeText(plain); alert("Copied. Paste it on WhatsApp or your status."); record(); return true;
  } catch { return false; }
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
        <small className="muted">{iosBrowser ? "On iPhone: tap Share → Add to Home Screen, open BCIL Foundation from your home screen, then come back here." : "A notification every morning at 6:00 am, no need to open the app."}</small></div>
      {!iosBrowser && <button className="btn small primary" disabled={busy} onClick={push ? () => setQuotes(true) : turnOn}>{busy ? "…" : "Turn on"}</button>}
      {msg && <p className="muted" role="status" style={{ width: "100%", margin: 0 }}>{msg}</p>}
    </div>
  );
}

type BComment = { id: number; user_id: string; body: string; created_at: string; profiles: { full_name: string; avatar_url: string | null } | null };
// comments under a Daily Bite
function BiteComments({ quoteId, me, open, onCount }: { quoteId: number; me: string; open: boolean; onCount: (n: number) => void }) {
  const { isStaff } = useAuth();
  const [list, setList] = useState<BComment[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const load = () => supabase.from("quote_comments").select("id, user_id, body, created_at, profiles(full_name, avatar_url)").eq("quote_id", quoteId).order("created_at")
    .then(({ data, error }) => { if (!error) { setList((data ?? []) as unknown as BComment[]); onCount((data ?? []).length); } else setList([]); });
  useEffect(() => {
    if (!open) return;
    load();
    const ch = supabase.channel(`bite-comments:${quoteId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "quote_comments", filter: `quote_id=eq.${quoteId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [quoteId, open]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("quote_comments").insert({ quote_id: quoteId, body: text.trim().slice(0, 1000) });
    setBusy(false);
    if (!error) { setText(""); load(); }
  }
  if (!open) return null;
  const shown = list && !all && list.length > 4 ? list.slice(-4) : list;
  return (
    <div className="bitecomments">
      {list && list.length > 4 && !all && <button className="linkbtn" onClick={() => setAll(true)}>See all {list.length} comments</button>}
      {shown?.map((c) => (
        <div key={c.id} className="bitecomment">
          <b>{c.user_id === me ? "You" : c.profiles?.full_name ?? "Member"}</b> <span className="prewrap">{c.body}</span>
          <small className="muted"> · {new Date(c.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small>
          {(c.user_id === me || isStaff) && <button className="linkbtn" aria-label="Delete comment" onClick={async () => { await supabase.from("quote_comments").delete().eq("id", c.id); load(); }}>✕</button>}
        </div>
      ))}
      <form className="row bitecommentform" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What does this bite mean to you?" aria-label="Write a comment" maxLength={1000} />
        <button className="btn primary sm" disabled={busy || !text.trim()}>Post</button>
      </form>
    </div>
  );
}
