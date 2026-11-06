// Review a document and comment on it, like comments in Google Docs.
// PDFs, pictures and Word files open inside the app; tap a spot (or select text in a Word file) to pin a comment there.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import Avatar from "../components/Avatar";
import { openPdf, renderPage, type OpenPdf } from "../lib/pdf";
import { useLive, type Session } from "../lib/LiveContext";
import type { ICameraVideoTrack, ILocalVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";

type DocRow = { id: number; owner_id: string | null; path: string; name: string; context: string; ref_id: number | null; created_at: string };
type Comment = { id: number; document_id: number; user_id: string; parent_id: number | null; page: number | null; x: number | null; y: number | null; quote: string | null;
  body: string; resolved: boolean; created_at: string; profiles?: { full_name: string; avatar_url: string | null } | null };
type Draft = { page: number | null; x: number | null; y: number | null; quote: string | null };

const kindOf = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "pdf" ? "pdf" : /^(jpe?g|png|webp|gif|heic)$/.test(ext) ? "image" : ext === "docx" ? "docx" : "other";
};
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const BACK: Record<string, [string, string]> = { meeting: ["/meet", "Meet Solomon"], mentorship: ["/mentorship", "Mentorship"], form: ["/admin?tab=Forms", "Forms"] };

export default function Doc() {
  const { id } = useParams();
  const { session, isStaff, profile } = useAuth();
  const L = useLive();
  const me = session!.user.id;
  const nav = useNavigate();
  const [doc, setDoc] = useState<DocRow | null>(null);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [pinMode, setPinMode] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  // reviewing together on a call
  const [other, setOther] = useState<{ id: string; name: string } | null>(null);
  const [docCall, setDocCall] = useState<Session | null>(null);
  const [calling, setCalling] = useState(false);
  const canCall = isStaff || profile?.role === "mentor";
  const topic = `/doc/${id}`;
  const inCall = L.joined && L.live?.topic === topic;

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("documents").select("*").eq("id", Number(id)).maybeSingle();
      if (error || !data) { setErr("This document isn't available, or you don't have access to it."); return; }
      setDoc(data as DocRow);
      const s = await supabase.storage.from("form-files").createSignedUrl((data as DocRow).path, 3600);
      if (s.error || !s.data) setErr("Could not open the file. Try again in a moment."); else setUrl(s.data.signedUrl);
    })();
    const load = () => supabase.from("doc_comments").select("*, profiles(full_name, avatar_url)").eq("document_id", Number(id)).order("created_at")
      .then(({ data }) => setComments((data ?? []) as unknown as Comment[]));
    load();
    const ch = supabase.channel(`doc:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "doc_comments", filter: `document_id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  // who to call: the mentorship partner, or the person who sent the document
  useEffect(() => {
    if (!doc) return;
    (async () => {
      let oid: string | null = null;
      if (doc.context === "mentorship" && doc.ref_id) {
        const { data } = await supabase.from("mentorships").select("mentor_id, mentee_id").eq("id", doc.ref_id).maybeSingle();
        if (data) oid = data.mentor_id === me ? data.mentee_id : data.mentor_id;
      } else if (doc.owner_id && doc.owner_id !== me) oid = doc.owner_id;
      if (!oid) return;
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", oid).maybeSingle();
      setOther({ id: oid, name: p?.full_name ?? "them" });
    })();
  }, [doc?.id]);
  // is there a call about this document right now?
  useEffect(() => {
    const look = () => supabase.from("live_sessions").select("*").eq("status", "live").eq("topic", topic).order("starts_at", { ascending: false }).limit(1)
      .then(({ data }) => setDocCall(((data ?? [])[0] as Session) ?? null));
    look();
    const t = window.setInterval(look, 10000);
    return () => window.clearInterval(t);
  }, [topic]);
  async function startCall(kind: "audio" | "video") {
    if (!doc || !other || calling) return;
    setCalling(true);
    const { data: roomId, error } = await supabase.rpc("start_dm", { other: other.id });
    if (error || !roomId) { setErr("Could not start the call."); setCalling(false); return; }
    await L.goLiveNow({ title: `Reviewing ${doc.name}`.slice(0, 90), topic, kind, record: false, cam: kind === "video", roomId: roomId as string, dm: true });
    setCalling(false);
  }
  async function joinCall() {
    if (!docCall) return;
    setCalling(true);
    L.setLive(docCall);
    await L.join(docCall, { cam: false });
    setCalling(false);
  }

  const threads = useMemo(() => comments.filter((c) => !c.parent_id), [comments]);
  const number = useMemo(() => Object.fromEntries(threads.filter((t) => t.x != null).map((t, i) => [t.id, i + 1])), [threads]);
  const shown = threads.filter((t) => showResolved || !t.resolved);
  const resolvedCount = threads.filter((t) => t.resolved).length;

  function startComment() {
    // a Word file: if text is selected, pin the comment to it
    const sel = window.getSelection();
    const quote = sel && !sel.isCollapsed ? sel.toString().trim().slice(0, 300) : "";
    if (quote && sel!.rangeCount) {
      const range = sel!.getRangeAt(0);
      const pageEl = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest<HTMLElement>(".docpage");
      if (pageEl) {
        const box = pageEl.getBoundingClientRect(), r = range.getBoundingClientRect();
        setDraft({ page: Number(pageEl.dataset.page) || null, x: clamp((r.left - box.left) / box.width), y: clamp((r.top - box.top) / box.height), quote });
        sel!.removeAllRanges(); return;
      }
    }
    setPinMode((v) => !v);
  }
  function placePin(e: React.MouseEvent<HTMLDivElement>, page: number | null) {
    if (!pinMode) return;
    const box = e.currentTarget.getBoundingClientRect();
    setDraft({ page, x: clamp((e.clientX - box.left) / box.width), y: clamp((e.clientY - box.top) / box.height), quote: null });
    setPinMode(false);
  }
  async function save(d: Draft | null, body: string, parent?: number) {
    if (!doc || !body.trim()) return false;
    setBusy(true);
    const { error } = await supabase.from("doc_comments").insert({ document_id: doc.id, user_id: me, body: body.trim(), parent_id: parent ?? null,
      ...(d ? { page: d.page, x: d.x, y: d.y, quote: d.quote } : {}) });
    setBusy(false);
    if (error) { setErr("Comment not saved. Check your connection and try again."); return false; }
    return true;
  }
  async function resolve(c: Comment) {
    setComments((cur) => cur.map((x) => (x.id === c.id ? { ...x, resolved: !c.resolved } : x)));
    await supabase.from("doc_comments").update({ resolved: !c.resolved }).eq("id", c.id);
  }
  async function remove(c: Comment) {
    if (!window.confirm("Delete this comment?")) return;
    setComments((cur) => cur.filter((x) => x.id !== c.id && x.parent_id !== c.id));
    await supabase.from("doc_comments").delete().eq("id", c.id);
  }
  function focusThread(tid: number) {
    setActive(tid);
    document.getElementById(`thread-${tid}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function focusPin(tid: number) {
    setActive(tid);
    document.getElementById(`pin-${tid}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  if (err && !doc) return <section className="view"><h1>Document</h1><p className="err">{err}</p><button className="btn ghost" onClick={() => nav(-1)}>← Back</button></section>;
  if (!doc) return <section className="view"><p className="muted">Opening…</p></section>;
  const kind = kindOf(doc.name || doc.path);
  const back = BACK[doc.context] ?? ["/", "Home"];
  const pins = (page: number | null) => threads.filter((t) => t.x != null && t.y != null && (t.page ?? null) === page && (showResolved || !t.resolved));
  const pinLayer = (page: number | null) => <>
    {pins(page).map((t) => (
      <button key={t.id} id={`pin-${t.id}`} className={`docpin${active === t.id ? " on" : ""}${t.resolved ? " done" : ""}`} style={{ left: `${t.x! * 100}%`, top: `${t.y! * 100}%` }}
        onClick={(e) => { e.stopPropagation(); focusThread(t.id); }} aria-label={`Comment ${number[t.id]}`}>{number[t.id]}</button>
    ))}
    {draft && draft.x != null && (draft.page ?? null) === page && <span className="docpin draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y! * 100}%` }}>＋</span>}
  </>;

  return (
    <section className="view docview">
      <div className="dochead">
        {isStaff && doc.context === "meeting" && doc.owner_id !== me
          ? <Link className="linkbtn" to="/admin?tab=Meetings">← Meetings</Link>
          : <Link className="linkbtn" to={back[0]}>← {back[1]}</Link>}
        <h1 className="docname">{doc.name}</h1>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {kind !== "other" && <button className={`btn sm ${pinMode ? "primary" : "ghost"}`} onClick={startComment}>{pinMode ? "Tap the document…" : "＋ Comment"}</button>}
          {url && <a className="btn ghost sm" href={url} target="_blank" rel="noopener">⬇ Download</a>}
          {canCall && other && !inCall && !docCall && !L.joined && <>
            <button className="btn ghost sm" disabled={calling} onClick={() => startCall("audio")} title={`Voice call ${other.name} to review this together`}>📞 Call</button>
            <button className="btn ghost sm" disabled={calling} onClick={() => startCall("video")} title={`Video call ${other.name} to review this together`}>🎥 Video</button>
          </>}
        </div>
      </div>
      {pinMode && <p className="docnote">Tap the spot you want to comment on.{kind === "docx" ? " In a Word file you can also select some text first, then tap ＋ Comment." : ""} <button className="linkbtn" onClick={() => setPinMode(false)}>Cancel</button></p>}
      {err && <p className="err">{err}</p>}
      {docCall && !inCall && <div className="docnote callnote">📞 There's a call about this document right now.
        <button className="btn primary sm" disabled={calling || L.joined} onClick={joinCall}>{calling ? "Joining…" : "Join the call"}</button>
        {L.joined && <small> Leave your other session first.</small>}</div>}
      {inCall && <CallDock />}

      <div className="docwrap">
        <div className={`docpages${pinMode ? " pinning" : ""}`}>
          {!url ? <p className="muted">Loading the file…</p>
            : kind === "pdf" ? <PdfPages url={url} onPage={(n) => ({ onClick: (e: React.MouseEvent<HTMLDivElement>) => placePin(e, n), layer: pinLayer(n) })} />
            : kind === "image" ? <div className="docpage" data-page="" onClick={(e) => placePin(e, null)}><img src={url} alt={doc.name} />{pinLayer(null)}</div>
            : kind === "docx" ? <DocxPage url={url} onClick={(e) => placePin(e, null)} layer={pinLayer(null)} />
            : <div className="card"><p>This type of file can't be shown in the app. Download it to read it, and leave your feedback as comments here.</p></div>}
        </div>

        <aside className="docside">
          <h2>Comments <small className="muted">{threads.length - resolvedCount} open</small></h2>
          <GeneralBox busy={busy} onSend={(b) => save(null, b)} />
          {resolvedCount > 0 && <button className="linkbtn" onClick={() => setShowResolved((v) => !v)}>{showResolved ? "Hide" : "Show"} resolved ({resolvedCount})</button>}
          {shown.length === 0 && <p className="muted small">No comments yet. Tap ＋ Comment, then tap the spot on the document.</p>}
          {shown.map((t) => (
            <Thread key={t.id} t={t} n={number[t.id]} replies={comments.filter((c) => c.parent_id === t.id)} me={me} isStaff={isStaff} active={active === t.id}
              onFocus={() => (t.x != null ? focusPin(t.id) : setActive(t.id))} onReply={(b) => save(null, b, t.id)} onResolve={() => resolve(t)} onDelete={remove} busy={busy} />
          ))}
        </aside>
      </div>

      {draft && <>
        <div className="sheet-back" onClick={() => { setDraft(null); setText(""); }} />
        <div className="sheet" role="dialog" aria-label="New comment">
          <b>New comment{draft.page ? ` · page ${draft.page}` : ""}</b>
          {draft.quote && <blockquote className="docquote">“{draft.quote}”</blockquote>}
          <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your feedback…" aria-label="Comment" />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" disabled={busy || !text.trim()} onClick={async () => { if (await save(draft, text)) { setDraft(null); setText(""); } }}>{busy ? "Saving…" : "Comment"}</button>
            <button className="btn ghost" onClick={() => { setDraft(null); setText(""); }}>Cancel</button>
          </div>
        </div>
      </>}
    </section>
  );
}

const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v));

function GeneralBox({ onSend, busy }: { onSend: (b: string) => Promise<boolean>; busy: boolean }) {
  const [t, setT] = useState("");
  return (
    <form className="docgeneral" onSubmit={async (e) => { e.preventDefault(); if (await onSend(t)) setT(""); }}>
      <input value={t} onChange={(e) => setT(e.target.value)} placeholder="Comment on the whole document" aria-label="General comment" />
      <button className="btn primary sm" disabled={busy || !t.trim()}>Send</button>
    </form>
  );
}

function Thread({ t, n, replies, me, isStaff, active, onFocus, onReply, onResolve, onDelete, busy }: {
  t: Comment; n?: number; replies: Comment[]; me: string; isStaff: boolean; active: boolean; busy: boolean;
  onFocus: () => void; onReply: (b: string) => Promise<boolean>; onResolve: () => void; onDelete: (c: Comment) => void;
}) {
  const [reply, setReply] = useState("");
  const [open, setOpen] = useState(false);
  const line = (c: Comment) => (
    <div className="docc" key={c.id}>
      <Avatar name={c.profiles?.full_name} url={c.profiles?.avatar_url} size={28} />
      <div className="grow"><b>{c.user_id === me ? "You" : c.profiles?.full_name ?? "Member"}</b> <small className="muted">{when(c.created_at)}</small>
        <p className="prewrap">{c.body}</p></div>
      {(c.user_id === me || isStaff) && <button className="linkbtn" onClick={() => onDelete(c)} aria-label="Delete comment">✕</button>}
    </div>
  );
  return (
    <div id={`thread-${t.id}`} className={`docthread${active ? " on" : ""}${t.resolved ? " done" : ""}`} onClick={onFocus}>
      <div className="row" style={{ gap: 6, alignItems: "center" }}>
        {n ? <span className="docpin static">{n}</span> : <span className="pill">General</span>}
        {t.page ? <small className="muted">Page {t.page}</small> : null}
        <span className="grow" />
        <button className="linkbtn" onClick={(e) => { e.stopPropagation(); onResolve(); }}>{t.resolved ? "↺ Reopen" : "✓ Resolve"}</button>
      </div>
      {t.quote && <blockquote className="docquote">“{t.quote}”</blockquote>}
      {line(t)}
      {replies.map(line)}
      {!t.resolved && (open
        ? <form className="docgeneral" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); if (await onReply(reply)) { setReply(""); setOpen(false); } }}>
            <input autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply" aria-label="Reply" />
            <button className="btn primary sm" disabled={busy || !reply.trim()}>Reply</button></form>
        : <button className="linkbtn" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>Reply</button>)}
    </div>
  );
}

// every page of a PDF, each with its own comment pins
function PdfPages({ url, onPage }: { url: string; onPage: (n: number) => { onClick: (e: React.MouseEvent<HTMLDivElement>) => void; layer: React.ReactNode } }) {
  const box = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<OpenPdf | null>(null);
  const [width, setWidth] = useState(0);
  const [err, setErr] = useState("");
  useEffect(() => {
    let p: OpenPdf | null = null, gone = false;
    openPdf(url).then((x) => { if (gone) x.close(); else { p = x; setPdf(x); } }).catch(() => setErr("Could not show this PDF. Use Download to open it."));
    return () => { gone = true; p?.close(); };
  }, [url]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => setWidth((w) => { const nw = Math.min(860, Math.floor(el.clientWidth)); return Math.abs(nw - w) > 40 ? nw : w; });
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="pdfpages">
      {err && <p className="err">{err}</p>}
      {!pdf && !err && <p className="muted">Loading the PDF…</p>}
      {pdf && width > 0 && Array.from({ length: pdf.doc.numPages }, (_, i) => i + 1).map((n) => {
        const pg = onPage(n);
        return <PdfPage key={`${n}-${width}`} pdf={pdf} n={n} width={width} onClick={pg.onClick} layer={pg.layer} />;
      })}
    </div>
  );
}
function PdfPage({ pdf, n, width, onClick, layer }: { pdf: OpenPdf; n: number; width: number; onClick: (e: React.MouseEvent<HTMLDivElement>) => void; layer: React.ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // draw pages only when they come near the screen, so long documents open fast
    let done = false;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !done && canvas.current) { done = true; renderPage(pdf.doc, n, canvas.current, width).catch(() => {}); io.disconnect(); }
    }, { rootMargin: "800px" });
    if (holder.current) io.observe(holder.current);
    return () => io.disconnect();
  }, [pdf, n, width]);
  return (
    <div ref={holder} className="docpage" data-page={n} onClick={onClick} style={{ width, minHeight: Math.round(width * 1.3) }}>
      <canvas ref={canvas} />
      <span className="docpageno">{n}</span>
      {layer}
    </div>
  );
}

// a Word file turned into a page of text (pictures included)
function DocxPage({ url, onClick, layer }: { url: string; onClick: (e: React.MouseEvent<HTMLDivElement>) => void; layer: React.ReactNode }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const mammoth = (await import("mammoth")).default;
        const out = await mammoth.convertToHtml({ arrayBuffer: buf });
        setHtml(clean(out.value));
      } catch { setErr("Could not show this Word file. Use Download to open it."); }
    })();
  }, [url]);
  if (err) return <p className="err">{err}</p>;
  if (html === null) return <p className="muted">Loading the document…</p>;
  return (
    <div className="docpage docx" data-page="" onClick={onClick}>
      <div className="docxbody" dangerouslySetInnerHTML={{ __html: html || "<p><i>This document is empty.</i></p>" }} />
      {layer}
    </div>
  );
}
// keep only safe content from a Word file
function clean(html: string) {
  const d = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  d.querySelectorAll("script,style,iframe,object,embed,form,input,link,meta").forEach((e) => e.remove());
  d.querySelectorAll("*").forEach((e) => {
    for (const a of Array.from(e.attributes)) {
      const v = a.value.trim().toLowerCase();
      if (a.name.startsWith("on")) e.removeAttribute(a.name);
      else if ((a.name === "href" || a.name === "src") && !(/^(https?:|mailto:|#)/.test(v) || (a.name === "src" && v.startsWith("data:image/")))) e.removeAttribute(a.name);
    }
    if (e.tagName === "A") { e.setAttribute("target", "_blank"); e.setAttribute("rel", "noopener noreferrer"); }
  });
  return d.body.firstElementChild?.innerHTML ?? "";
}

// a small call window that stays on screen while you review the document together
function CallDock() {
  const L = useLive();
  const video = L.live?.kind === "video";
  const remote = Object.values(L.remoteVideo).filter(Boolean);
  const mine = L.sharing ? L.screen.current : L.camOn ? L.cam.current : null;
  const amHost = L.live?.host_id === L.me;
  const others = L.people.filter((p) => p.id !== L.me);
  return (
    <div className="calldock" role="region" aria-label="Call">
      {video && <div className="calldock-v">
        {remote.length ? remote.map((t, i) => <Tile key={i} track={t} />) : <div className="calltile empty">{others.length ? "Camera off" : "Waiting for them to join…"}</div>}
        {mine && <Tile track={mine} mirror={!L.sharing} small />}
      </div>}
      <small className="calldock-who">{others.length ? `On the call with ${others.map((p) => p.name).join(", ")}` : "Calling… they've been notified"}{L.sharing ? " · sharing your screen" : ""}</small>
      <div className="calldock-btns">
        <button className={`iconbtn${L.muted ? " on" : ""}`} onClick={L.toggleMute} aria-label={L.muted ? "Unmute" : "Mute"} title={L.muted ? "Unmute" : "Mute"}>{L.muted ? "🔇" : "🎙"}</button>
        {video && !L.sharing && <button className={`iconbtn${L.camOn ? "" : " on"}`} onClick={L.toggleCam} aria-label={L.camOn ? "Camera off" : "Camera on"} title="Camera">{L.camOn ? "📷" : "🚫"}</button>}
        {video && L.canShare && <button className={`iconbtn${L.sharing ? " on" : ""}`} onClick={L.toggleShare} aria-label={L.sharing ? "Stop sharing" : "Share screen"} title="Share screen">🖥</button>}
        <button className="iconbtn hang" onClick={() => (amHost ? L.endSession() : L.leaveRoom())} aria-label={amHost ? "End call" : "Leave call"} title={amHost ? "End call" : "Leave call"}>📵</button>
      </div>
    </div>
  );
}
function Tile({ track, mirror, small }: { track: ICameraVideoTrack | ILocalVideoTrack | IRemoteVideoTrack; mirror?: boolean; small?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    track.play(ref.current, { fit: "contain", ...(mirror ? { mirror: true } : {}) });
    return () => { track.stop(); };
  }, [track, mirror]);
  return <div ref={ref} className={`calltile${small ? " small" : ""}`} />;
}
