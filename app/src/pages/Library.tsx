import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Link, useSearchParams } from "react-router-dom";
import AddAudioTalk, { PROGRAMS } from "../components/AddAudioTalk";
import { clock } from "../lib/recorder";

type Talk = { id: string; youtube_id: string | null; title: string; program: string | null; published_on: string | null; kind: string; audio_url: string | null; description: string | null; duration_seconds: number | null; live_session_id: string | null; status: string; trim_start: number | null; trim_end: number | null };
type Comment = { id: number; user_id: string; body: string; created_at: string; profiles?: { full_name: string } | null };

export default function Library() {
  const { session, isStaff } = useAuth();
  const me = session!.user.id;
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [speed, setSpeed] = useState(1);
  const player = useRef<HTMLAudioElement | null>(null);
  const [talks, setTalks] = useState<Talk[]>([]);
  const [filter, setFilter] = useState("All");
  const [type, setType] = useState<"all" | "video" | "audio" | "live">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Talk | null>(null);
  const [likes, setLikes] = useState(0);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState("");

  const loadTalks = () => supabase.from("talks").select("id, youtube_id, title, program, published_on, kind, audio_url, description, duration_seconds, live_session_id, status, trim_start, trim_end")
    .order("published_on", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false })
    .then(({ data }) => {
      const list = (data ?? []) as Talk[];
      setTalks(list);
      // open a talk directly from a shared link (?talk=...)
      const id = params.get("talk");
      const t = id && list.find((x) => x.id === id);
      if (t) loadTalk(t);
    });
  useEffect(() => { loadTalks(); }, []);

  async function loadTalk(t: Talk) {
    setOpen(t); setSpeed(1);
    if (params.get("talk") !== t.id) setParams({ talk: t.id }, { replace: true });
    if (t.kind === "audio" && "mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: "BCIL Foundation", album: t.program ?? "BCIL Live",
        artwork: [{ src: `${import.meta.env.BASE_URL}icon-512.png`, sizes: "512x512", type: "image/png" }] });
    }
    const [{ count }, { data: mine }, { data: sv }, { data: cs }] = await Promise.all([
      supabase.from("talk_likes").select("*", { count: "exact", head: true }).eq("talk_id", t.id),
      supabase.from("talk_likes").select("talk_id").eq("talk_id", t.id).eq("user_id", me).maybeSingle(),
      supabase.from("talk_saves").select("talk_id").eq("talk_id", t.id).eq("user_id", me).maybeSingle(),
      supabase.from("talk_comments").select("id, user_id, body, created_at, profiles(full_name)").eq("talk_id", t.id).order("created_at", { ascending: false }),
    ]);
    setLikes(count ?? 0); setLiked(!!mine); setSaved(!!sv); setComments((cs ?? []) as unknown as Comment[]);
  }
  async function toggleLike() {
    if (!open) return;
    if (liked) await supabase.from("talk_likes").delete().eq("talk_id", open.id).eq("user_id", me);
    else await supabase.from("talk_likes").insert({ talk_id: open.id, user_id: me });
    setLiked(!liked); setLikes((n) => n + (liked ? -1 : 1));
  }
  async function toggleSave() {
    if (!open) return;
    if (saved) await supabase.from("talk_saves").delete().eq("talk_id", open.id).eq("user_id", me);
    else await supabase.from("talk_saves").insert({ talk_id: open.id, user_id: me });
    setSaved(!saved);
  }
  async function share() {
    if (!open) return;
    const url = open.youtube_id ? `https://youtu.be/${open.youtube_id}` : `${location.origin}${import.meta.env.BASE_URL}library?talk=${open.id}`;
    if (navigator.share) await navigator.share({ title: open.title, url }).catch(() => {});
    else { await navigator.clipboard.writeText(url); alert("Link copied"); }
  }
  async function comment(e: React.FormEvent) {
    e.preventDefault();
    if (!open || !text.trim()) return;
    const { data } = await supabase.from("talk_comments").insert({ talk_id: open.id, user_id: me, body: text.trim() })
      .select("id, user_id, body, created_at, profiles(full_name)").single();
    if (data) setComments((c) => [data as unknown as Comment, ...c]);
    setText("");
  }
  async function report(c: Comment) {
    await supabase.from("reports").insert({ reporter: me, target_type: "comment", target_id: String(c.id) });
    alert("Thanks. A moderator will review this comment.");
  }

  if (open) return (
    <section className="view">
      <button className="linkbtn" onClick={() => { setOpen(null); setParams({}, { replace: true }); }}>← Library</button>
      {open.youtube_id && (
        <div className="video"><iframe src={`https://www.youtube-nocookie.com/embed/${open.youtube_id}?rel=0`} title={open.title}
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>
      )}
      {open.kind === "audio" && open.audio_url && (
        <div className="audiocard">
          <div className="audioart"><img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" /><span>{open.live_session_id ? "Live session recording" : "Audio talk"}</span></div>
          <audio controls preload="metadata" src={open.audio_url + (open.trim_start || open.trim_end ? `#t=${open.trim_start ?? 0}${open.trim_end ? "," + open.trim_end : ""}` : "")} style={{ width: "100%" }}
            ref={(el) => { player.current = el; if (el) el.playbackRate = speed; }}
            onPlay={(e) => { const a = e.currentTarget; if (open.trim_start && a.currentTime < open.trim_start) a.currentTime = open.trim_start; }}
            onTimeUpdate={(e) => { const a = e.currentTarget; if (open.trim_end && a.currentTime >= open.trim_end) { a.pause(); a.currentTime = open.trim_start ?? 0; } }} />
          <div className="row" style={{ gap: 6 }}><small className="muted">Speed</small>
            {[1, 1.25, 1.5, 2].map((v) => <button key={v} className="chip" aria-pressed={speed === v} onClick={() => setSpeed(v)}>{v}×</button>)}
          </div>
        </div>
      )}
      {isStaff && open.kind === "audio" && <TalkEditor talk={open} player={player}
        onChange={(t) => { setOpen(t); setTalks((list) => list.map((x) => (x.id === t.id ? t : x))); }}
        onDelete={() => { setTalks((list) => list.filter((x) => x.id !== open.id)); setOpen(null); setParams({}, { replace: true }); }} />}
      <h1>{open.title}{open.status === "draft" && <span className="pill" style={{ marginLeft: 10, verticalAlign: "middle" }}>Draft</span>}</h1>
      {open.description && <p>{open.description}</p>}
      <p className="muted">{open.program ?? (open.kind === "audio" ? "Audio talk" : "Talk")}{playLength(open) ? ` · ${clock(playLength(open)!)}` : ""}{open.published_on ? ` · ${new Date(open.published_on + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}</p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn ghost" onClick={toggleLike} aria-pressed={liked}>{liked ? "♥" : "♡"} {likes}</button>
        <button className="btn ghost" onClick={toggleSave}>{saved ? "Saved" : "Save for later"}</button>
        <button className="btn ghost" onClick={share}>Share</button>
      </div>
      <h2>Comments <span className="muted">{comments.length}</span></h2>
      <form className="composer card" onSubmit={comment}><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment" aria-label="Write a comment" /><button className="btn primary">Post</button></form>
      <div className="list">{comments.map((c) => (
        <div key={c.id}><div className="grow"><b>{c.user_id === me ? "You" : c.profiles?.full_name}</b> <small className="muted">{new Date(c.created_at).toLocaleDateString("en-GB")}</small><p>{c.body}</p></div>
          {c.user_id !== me && <button className="linkbtn" onClick={() => report(c)}>Report</button>}</div>
      ))}</div>
    </section>
  );

  const programs = ["All", ...new Set(talks.filter((t) => t.status !== "draft" && t.program).map((t) => t.program as string))];
  const drafts = talks.filter((t) => t.status === "draft");
  const ofType = (t: Talk) => type === "all" || (type === "video" && t.kind !== "audio") || (type === "audio" && t.kind === "audio" && !t.live_session_id) || (type === "live" && !!t.live_session_id);
  const shown = talks.filter((t) => t.status !== "draft" && ofType(t) && (filter === "All" || t.program === filter) && (t.title + " " + (t.program ?? "") + " " + (t.description ?? "")).toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="view">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h1>Library</h1>
        {isStaff && <button className="btn primary" onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "🎙 Record or upload audio"}</button>}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search talks" aria-label="Search talks" style={{ maxWidth: 260 }} />
      </div>
      <Link to="/reading" className="card row readlink"><span style={{ fontSize: 28 }}>📚</span><div className="grow"><b>Reading room</b><br /><small className="muted">Books and guides for mentorship. Read them in the app.</small></div><span aria-hidden>›</span></Link>
      {adding && <AddAudioTalk onSaved={() => { setAdding(false); loadTalks(); }} />}
      {isStaff && drafts.length > 0 && <>
        <h2>Drafts <span className="muted">· only hosts can see these</span></h2>
        <div className="list">{drafts.map((t) => (
          <button key={t.id} onClick={() => loadTalk(t)}>
            <span className="pill rec" style={{ animation: "none" }}>Draft</span>
            <div className="grow"><b>{t.title}</b><br /><small className="muted">{t.live_session_id ? "Live recording" : "Audio"}{t.program ? ` · ${t.program}` : ""}{playLength(t) ? ` · ${clock(playLength(t)!)}` : ""}</small></div>
            <span className="btn ghost">Review</span>
          </button>))}</div>
      </>}
      <div className="seg" role="tablist" aria-label="Type">
        {([["all", "All"], ["video", "▶ Videos"], ["audio", "🎧 Audio"], ["live", "● Live recordings"]] as const).map(([k, label]) =>
          <button key={k} role="tab" aria-selected={type === k} onClick={() => setType(k)}>{label}</button>)}
      </div>
      <div className="chips">{programs.map((p) => <button key={p} className="chip" aria-pressed={p === filter} onClick={() => setFilter(p)}>{p}</button>)}</div>
      <div className="grid3">
        {shown.map((t) => (
          <button key={t.id} className="tile" onClick={() => loadTalk(t)}>
            {t.youtube_id ? <img src={`https://i.ytimg.com/vi/${t.youtube_id}/hqdefault.jpg`} alt="" loading="lazy" />
              : <div className="art audio"><span className="badge">{t.live_session_id ? "● Live recording" : "🎧 Audio"}</span><span className="t">{t.title}</span>{playLength(t) ? <span className="dur">{clock(playLength(t)!)}</span> : null}</div>}
            <b>{t.title}</b>{t.program && <small className="muted">{t.program}</small>}
          </button>
        ))}
      </div>
      {!shown.length && <div className="empty"><b>No talks yet</b>Hosts can add YouTube talks from Admin, or record and upload audio here.</div>}
    </section>
  );
}

const playLength = (t: Talk) => {
  const end = t.trim_end ?? t.duration_seconds;
  return end ? Math.max(0, end - (t.trim_start ?? 0)) : null;
};
const toSecs = (v: string) => {
  const parts = v.trim().split(":").map(Number);
  if (!v.trim() || parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

// Hosts: edit details, trim the start/end, publish or unpublish, delete
function TalkEditor({ talk, player, onChange, onDelete }: { talk: Talk; player: React.MutableRefObject<HTMLAudioElement | null>; onChange: (t: Talk) => void; onDelete: () => void }) {
  const [f, setF] = useState({ title: talk.title, program: talk.program ?? "", description: talk.description ?? "", published_on: talk.published_on ?? "",
    start: talk.trim_start ? clock(talk.trim_start) : "", end: talk.trim_end ? clock(talk.trim_end) : "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [openEd, setOpenEd] = useState(talk.status === "draft");
  useEffect(() => { setF({ title: talk.title, program: talk.program ?? "", description: talk.description ?? "", published_on: talk.published_on ?? "",
    start: talk.trim_start ? clock(talk.trim_start) : "", end: talk.trim_end ? clock(talk.trim_end) : "" }); }, [talk.id]);

  async function save(status?: string) {
    const start = toSecs(f.start), end = toSecs(f.end);
    if (f.start && start === null) { setMsg("Start must look like 1:30 (minutes:seconds)."); return; }
    if (f.end && end === null) { setMsg("End must look like 45:10 (minutes:seconds)."); return; }
    if (start !== null && end !== null && end <= start) { setMsg("The end must be after the start."); return; }
    if (!f.title.trim()) { setMsg("Add a title."); return; }
    setBusy(true); setMsg("");
    const patch = { title: f.title.trim(), program: f.program.trim() || null, description: f.description.trim() || null, published_on: f.published_on || null,
      trim_start: start || null, trim_end: end || null, ...(status ? { status } : {}) };
    const { error } = await supabase.from("talks").update(patch).eq("id", talk.id);
    setBusy(false);
    if (error) { setMsg("Could not save: " + error.message); return; }
    onChange({ ...talk, ...patch });
    setMsg(status === "published" ? "Published. Everyone can now see it in the Library." : status === "draft" ? "Moved back to drafts." : "Saved.");
  }
  async function remove() {
    if (!window.confirm(`Delete “${talk.title}” permanently? This cannot be undone.`)) return;
    const { error } = await supabase.from("talks").delete().eq("id", talk.id);
    if (error) { setMsg("Could not delete: " + error.message); return; }
    onDelete();
  }
  const here = () => clock(Math.floor(player.current?.currentTime ?? 0));

  return (
    <div className="card editor">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>{talk.status === "draft" ? "Review this draft" : "Edit talk"}</h3>
        <button className="linkbtn" onClick={() => setOpenEd((o) => !o)}>{openEd ? "Hide" : "Edit"}</button>
      </div>
      {openEd && <>
        <label className="field">Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <div className="grid2">
          <label className="field">Programme or type (optional)<input list="programs" value={f.program} onChange={(e) => setF({ ...f, program: e.target.value })} /><datalist id="programs">{PROGRAMS.map((p) => <option key={p} value={p} />)}</datalist></label>
          <label className="field">Date<input type="date" value={f.published_on} onChange={(e) => setF({ ...f, published_on: e.target.value })} /></label>
        </div>
        <label className="field">Description<textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ minHeight: 70 }} /></label>
        <div className="trim">
          <b>Trim</b><small className="muted">Cut the waiting time at the start or chatter at the end. Play the audio above, then tap “Use current time”.</small>
          <div className="grid2">
            <label className="field">Start at<span className="pwrow"><input value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} placeholder="0:00" inputMode="numeric" />
              <button type="button" className="chip" onClick={() => setF({ ...f, start: here() })}>Use current time</button></span></label>
            <label className="field">End at<span className="pwrow"><input value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} placeholder={talk.duration_seconds ? clock(talk.duration_seconds) : "end"} inputMode="numeric" />
              <button type="button" className="chip" onClick={() => setF({ ...f, end: here() })}>Use current time</button></span></label>
          </div>
        </div>
        <p className="muted" role="status">{msg}</p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {talk.status === "draft"
            ? <button className="btn primary" disabled={busy} onClick={() => save("published")}>Save &amp; publish</button>
            : <button className="btn ghost" disabled={busy} onClick={() => save("draft")}>Unpublish</button>}
          <button className="btn ghost" disabled={busy} onClick={() => save()}>Save changes</button>
          <button className="btn ghost" style={{ color: "var(--live)" }} disabled={busy} onClick={remove}>Delete</button>
        </div>
      </>}
    </div>
  );
}
