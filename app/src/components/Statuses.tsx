import { useCallback, useEffect, useRef, useState } from "react";
import Tick from "./Tick";
import { initials, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { uploadPhoto } from "../lib/media";

// Statuses: a photo or a coloured text card that disappears after 24 hours.
// A row of circles (yours first), a full-screen viewer, and a sheet to post one.

type FeedRow = { user_id: string; full_name: string; avatar_url: string | null; count: number; latest: string; unseen: number };
type Status = { id: number; user_id: string; kind: "photo" | "text"; media_url: string | null; body: string | null; bg: string | null; created_at: string };
const REACTS = ["❤️", "😂", "😮", "😢", "🔥", "👏", "🙏"];
const BGS = ["#1e3f78", "#0f766e", "#7c2d12", "#6d28d9", "#b8862b", "#be123c", "#111827"];
const ago = (iso: string) => { const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };

export default function Statuses() {
  const { session, profile } = useAuth();
  const me = session?.user.id;
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [view, setView] = useState<number | null>(null);   // index into feed
  const [compose, setCompose] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc("status_feed");
    setFeed((data as FeedRow[] | null) ?? []);
  }, []);
  useEffect(() => { if (me) load(); }, [me, load]);
  useEffect(() => {
    if (!me) return;
    const ch = supabase.channel("statuses").on("postgres_changes", { event: "*", schema: "public", table: "statuses" }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me, load]);
  if (!me) return null;
  const mine = feed.find((f) => f.user_id === me);
  const others = feed.filter((f) => f.user_id !== me);
  const myName = profile?.full_name ?? "";
  return (
    <>
      <div className="strow" role="list" aria-label="Statuses">
        <div className="stitem" role="listitem">
          <button className="stcirc mine" onClick={() => (mine ? setView(feed.indexOf(mine)) : setCompose(true))} aria-label={mine ? "View your status" : "Add a status"}>
            <span className={`string${mine ? " seen" : " dashed"}`}>
              {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span className="stini">{initials(myName)}</span>}
            </span>
          </button>
          <button className="stplus" onClick={() => setCompose(true)} aria-label="Add a status">+</button>
          <small>{mine ? "Your status" : "Add status"}</small>
        </div>
        {others.map((f) => (
          <div className="stitem" role="listitem" key={f.user_id}>
            <button className="stcirc" onClick={() => setView(feed.indexOf(f))} aria-label={`View ${f.full_name}'s status`}>
              <span className={`string${f.unseen ? "" : " seen"}`}>
                {f.avatar_url ? <img src={f.avatar_url} alt="" /> : <span className="stini">{initials(f.full_name)}</span>}
              </span>
            </button>
            <small>{f.full_name.split(" ")[0]}</small>
          </div>
        ))}
      </div>
      {compose && <Composer me={me} onClose={() => setCompose(false)} onPosted={() => { setCompose(false); load(); }} />}
      {view !== null && feed[view] && (
        <Viewer key={feed[view].user_id} row={feed[view]} me={me}
          onNext={() => (view + 1 < feed.length ? setView(view + 1) : (setView(null), load()))}
          onPrev={() => view > 0 && setView(view - 1)}
          onClose={() => { setView(null); load(); }} onAdd={() => { setView(null); setCompose(true); }} />
      )}
    </>
  );
}

function Composer({ me, onClose, onPosted }: { me: string; onClose: () => void; onPosted: () => void }) {
  const [mode, setMode] = useState<"text" | "photo">("text");
  const [body, setBody] = useState("");
  const [bg, setBg] = useState(BGS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  function choose(f?: File | null) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setErr("Please choose a photo."); return; }
    setErr(""); setFile(f); setPreview(URL.createObjectURL(f)); setMode("photo");
  }
  async function post() {
    setBusy(true); setErr("");
    try {
      if (mode === "photo") {
        if (!file) throw new Error("Choose a photo first.");
        const url = await uploadPhoto(me, file, 1440);
        const { error } = await supabase.from("statuses").insert({ user_id: me, kind: "photo", media_url: url, body: body.trim() || null });
        if (error) throw error;
      } else {
        if (!body.trim()) throw new Error("Write something first.");
        const { error } = await supabase.from("statuses").insert({ user_id: me, kind: "text", body: body.trim(), bg });
        if (error) throw error;
      }
      onPosted();
    } catch (e) { setErr((e as Error).message || "Could not post. Try again."); setBusy(false); }
  }
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet stcompose" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add a status">
        <div className="row" style={{ justifyContent: "space-between" }}><h3>Add a status</h3><button className="iconbtn sm" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="seg">
          <button aria-selected={mode === "text"} onClick={() => setMode("text")}>Aa Text</button>
          <button aria-selected={mode === "photo"} onClick={() => (file ? setMode("photo") : pick.current?.click())}>📷 Photo</button>
        </div>
        <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => choose(e.target.files?.[0])} />
        {mode === "text" ? (
          <>
            <div className="stcard-prev" style={{ background: bg }}>
              <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, 700))} placeholder="Type a status" autoFocus aria-label="Status text" />
            </div>
            <div className="stbgs">{BGS.map((c) => <button key={c} style={{ background: c }} className={c === bg ? "on" : ""} onClick={() => setBg(c)} aria-label="Background colour" />)}</div>
          </>
        ) : (
          <>
            {preview && <img className="stphoto-prev" src={preview} alt="" />}
            <button className="linkbtn" onClick={() => pick.current?.click()}>Choose a different photo</button>
            <input value={body} onChange={(e) => setBody(e.target.value.slice(0, 300))} placeholder="Add a caption (optional)" aria-label="Caption" />
          </>
        )}
        <small className="muted">Members can see it for 24 hours. You can delete it any time.</small>
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={busy} onClick={post}>{busy ? "Posting…" : "Post status"}</button>
      </div>
    </div>
  );
}

function Viewer({ row, me, onNext, onPrev, onClose, onAdd }: { row: FeedRow; me: string; onNext: () => void; onPrev: () => void; onClose: () => void; onAdd: () => void }) {
  const { isStaff } = useAuth();
  const [items, setItems] = useState<Status[] | null>(null);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [pct, setPct] = useState(0);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [viewers, setViewers] = useState<{ name: string; at: string; emoji?: string }[] | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [burst, setBurst] = useState<string | null>(null);
  const [tally, setTally] = useState<Record<string, number>>({});
  const isMine = row.user_id === me;
  useEffect(() => {
    supabase.from("statuses").select("id,user_id,kind,media_url,body,bg,created_at").eq("user_id", row.user_id)
      .is("removed_at", null).gt("expires_at", new Date().toISOString()).order("created_at").then(({ data }) => {
        const list = (data as Status[] | null) ?? [];
        setItems(list);
        if (!list.length) onClose();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.user_id]);
  const cur = items?.[i];
  // mark as seen
  useEffect(() => {
    if (cur && !isMine) supabase.from("status_views").insert({ status_id: cur.id, viewer_id: me }).then(() => {});
    setPct(0); setViewers(null); setMine(null); setTally({});
    if (cur && !isMine) supabase.from("status_reactions").select("emoji").eq("status_id", cur.id).eq("user_id", me).maybeSingle()
      .then(({ data }) => setMine((data as { emoji: string } | null)?.emoji ?? null));
    if (cur && isMine) supabase.from("status_reactions").select("emoji").eq("status_id", cur.id).then(({ data }) => {
      const t: Record<string, number> = {};
      for (const r of (data ?? []) as { emoji: string }[]) t[r.emoji] = (t[r.emoji] ?? 0) + 1;
      setTally(t);
    });
  }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // timer: photos 6s, text 7s
  useEffect(() => {
    if (!cur || paused || viewers || reply) return;
    const total = cur.kind === "text" ? 7000 : 6000;
    const t = setInterval(() => setPct((p) => {
      const n = p + 100 / (total / 100);
      if (n >= 100) { clearInterval(t); setTimeout(() => (items && i + 1 < items.length ? setI(i + 1) : onNext()), 0); return 100; }
      return n;
    }), 100);
    return () => clearInterval(t);
  }, [cur, paused, viewers, reply, i, items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") next(); if (e.key === "ArrowLeft") prev(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });
  const next = () => (items && i + 1 < items.length ? setI(i + 1) : onNext());
  const prev = () => (i > 0 ? setI(i - 1) : onPrev());
  async function seenBy() {
    if (!cur) return;
    const [{ data }, { data: rx }] = await Promise.all([
      supabase.from("status_views").select("viewer_id, seen_at, profiles:viewer_id(full_name)").eq("status_id", cur.id).order("seen_at", { ascending: false }),
      supabase.from("status_reactions").select("user_id, emoji").eq("status_id", cur.id)]);
    const em = new Map(((rx ?? []) as { user_id: string; emoji: string }[]).map((r) => [r.user_id, r.emoji]));
    setViewers(((data ?? []) as unknown as { viewer_id: string; seen_at: string; profiles: { full_name: string } | null }[])
      .map((v) => ({ name: v.profiles?.full_name ?? "Member", at: v.seen_at, emoji: em.get(v.viewer_id) }))
      .sort((a, b) => (b.emoji ? 1 : 0) - (a.emoji ? 1 : 0)));
  }
  async function react(e: string) {
    if (!cur) return;
    const off = mine === e;
    setMine(off ? null : e);
    if (!off) { setBurst(e); setTimeout(() => setBurst(null), 900); }
    const r = off ? await supabase.from("status_reactions").delete().eq("status_id", cur.id).eq("user_id", me)
      : await supabase.from("status_reactions").upsert({ status_id: cur.id, user_id: me, emoji: e }, { onConflict: "status_id,user_id" });
    if (r.error) { setMine(mine); setNote("Could not react. Try again."); }
  }
  async function del() {
    if (!cur || !window.confirm("Delete this status?")) return;
    await supabase.from("statuses").delete().eq("id", cur.id);
    const rest = (items ?? []).filter((x) => x.id !== cur.id);
    if (!rest.length) onClose(); else { setItems(rest); setI(Math.min(i, rest.length - 1)); }
  }
  async function remove() {
    if (!cur || !window.confirm("Remove this status for everyone?")) return;
    await supabase.rpc("remove_status", { p_status: cur.id });
    onClose();
  }
  async function report() {
    if (!cur) return;
    const why = window.prompt("What's wrong with this status? (optional)");
    if (why === null) return;
    await supabase.rpc("report_status", { p_status: cur.id, p_reason: why || null });
    setNote("Thanks. The BCIL team will look at it."); setTimeout(onNext, 1200);
  }
  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!cur || !reply.trim()) return;
    const { data: roomId, error } = await supabase.rpc("start_dm", { other: row.user_id });
    if (error || !roomId) { setNote(/friend/i.test(error?.message ?? "") ? `Add ${row.full_name.split(" ")[0]} as a friend to reply.` : "Could not send the reply."); return; }
    const quote = cur.kind === "text" ? (cur.body ?? "").slice(0, 60) : "📷 Photo" + (cur.body ? `: ${cur.body.slice(0, 50)}` : "");
    const r = await supabase.from("messages").insert({ room_id: roomId, user_id: me, body: `↩ Replying to your status “${quote}”\n${reply.trim()}` });
    if (r.error) { setNote("Could not send the reply."); return; }
    setReply(""); setNote("Reply sent."); setTimeout(() => setNote(""), 1500);
  }
  if (!items || !cur) return <div className="stview" />;
  return (
    <div className="stview" role="dialog" aria-label={`${row.full_name}'s status`}>
      <div className="stbars">{items.map((s, k) => <span key={s.id}><i style={{ width: `${k < i ? 100 : k === i ? pct : 0}%` }} /></span>)}</div>
      <div className="sthead">
        <span className="stava">{row.avatar_url ? <img src={row.avatar_url} alt="" /> : initials(row.full_name)}</span>
        <div><b>{isMine ? "You" : row.full_name}{!isMine && <Tick id={row.user_id} size={14} />}</b><small>{ago(cur.created_at)}</small></div>
        <span style={{ flex: 1 }} />
        {isMine ? <button className="sthbtn" onClick={del} aria-label="Delete status">🗑</button>
          : <button className="sthbtn" onClick={report} aria-label="Report status">⚑</button>}
        {!isMine && isStaff && <button className="sthbtn" onClick={remove} aria-label="Remove status for everyone">⛔</button>}
        <button className="sthbtn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="stbody" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}>
        {cur.kind === "photo"
          ? <figure className="stfig"><img src={cur.media_url ?? ""} alt={cur.body ?? "Status photo"} />{cur.body && <figcaption>{cur.body}</figcaption>}</figure>
          : <div className="sttext" style={{ background: cur.bg ?? BGS[0] }}><p>{cur.body}</p></div>}
        <button className="sttap left" onClick={prev} aria-label="Previous" />
        <button className="sttap right" onClick={next} aria-label="Next" />
      </div>
      {burst && <span className="stburst" aria-hidden="true">{burst}</span>}
      {note && <p className="stnote">{note}</p>}
      {!isMine && (
        <div className="streacts" role="group" aria-label="React to this status">
          {REACTS.map((e) => <button key={e} className={mine === e ? "on" : ""} aria-pressed={mine === e} onClick={() => react(e)} aria-label={e === "❤️" ? "Like" : `React ${e}`}>{e}</button>)}
        </div>
      )}
      {isMine && Object.keys(tally).length > 0 && <div className="sttally">{Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([e, n]) => <span key={e}>{e} {n}</span>)}</div>}
      {isMine ? (
        <div className="stfoot">
          <button className="chip" onClick={seenBy}>👁 Seen by</button>
          <button className="chip" onClick={onAdd}>+ Add another</button>
        </div>
      ) : (
        <form className="stfoot" onSubmit={sendReply}>
          <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Reply to ${row.full_name.split(" ")[0]}`} aria-label="Reply" />
          <button className="btn primary sm" disabled={!reply.trim()}>Send</button>
        </form>
      )}
      {viewers && (
        <div className="sheet-back" onClick={() => setViewers(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Seen by {viewers.length}</h3>
            {viewers.length ? viewers.map((v, k) => <div key={k} className="row" style={{ justifyContent: "space-between", padding: "6px 0", gap: 8 }}><span className="grow">{v.name}</span>{v.emoji && <span style={{ fontSize: "1.2rem" }}>{v.emoji}</span>}<small className="muted">{ago(v.at)}</small></div>)
              : <p className="muted">No one has seen it yet.</p>}
            <button className="btn" onClick={() => setViewers(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

