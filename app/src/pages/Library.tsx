import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useSearchParams } from "react-router-dom";
import AddAudioTalk from "../components/AddAudioTalk";
import { clock } from "../lib/recorder";

type Talk = { id: string; youtube_id: string | null; title: string; program: string; published_on: string | null; kind: string; audio_url: string | null; description: string | null; duration_seconds: number | null; live_session_id: string | null };
type Comment = { id: number; user_id: string; body: string; created_at: string; profiles?: { full_name: string } | null };

export default function Library() {
  const { session, isStaff } = useAuth();
  const me = session!.user.id;
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [talks, setTalks] = useState<Talk[]>([]);
  const [filter, setFilter] = useState("All");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Talk | null>(null);
  const [likes, setLikes] = useState(0);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState("");

  const loadTalks = () => supabase.from("talks").select("id, youtube_id, title, program, published_on, kind, audio_url, description, duration_seconds, live_session_id")
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
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: "BCIL Foundation", album: t.program,
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
          <audio controls preload="metadata" src={open.audio_url} style={{ width: "100%" }}
            ref={(el) => { if (el) el.playbackRate = speed; }} />
          <div className="row" style={{ gap: 6 }}><small className="muted">Speed</small>
            {[1, 1.25, 1.5, 2].map((v) => <button key={v} className="chip" aria-pressed={speed === v} onClick={() => setSpeed(v)}>{v}×</button>)}
          </div>
        </div>
      )}
      <h1>{open.title}</h1>
      {open.description && <p>{open.description}</p>}
      <p className="muted">{open.program}{open.duration_seconds ? ` · ${clock(open.duration_seconds)}` : ""}{open.published_on ? ` · ${new Date(open.published_on + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}</p>
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

  const programs = ["All", ...new Set(talks.map((t) => t.program))];
  const shown = talks.filter((t) => (filter === "All" || t.program === filter) && (t.title + t.program).toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="view">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h1>Library</h1>
        {isStaff && <button className="btn primary" onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "🎙 Record or upload audio"}</button>}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search talks" aria-label="Search talks" style={{ maxWidth: 260 }} />
      </div>
      {adding && <AddAudioTalk onSaved={() => { setAdding(false); loadTalks(); }} />}
      <div className="chips">{programs.map((p) => <button key={p} className="chip" aria-pressed={p === filter} onClick={() => setFilter(p)}>{p}</button>)}</div>
      <div className="grid3">
        {shown.map((t) => (
          <button key={t.id} className="tile" onClick={() => loadTalk(t)}>
            {t.youtube_id ? <img src={`https://i.ytimg.com/vi/${t.youtube_id}/hqdefault.jpg`} alt="" loading="lazy" />
              : <div className="art audio"><span className="badge">{t.live_session_id ? "● Live recording" : "🎧 Audio"}</span><span className="t">{t.title}</span>{t.duration_seconds ? <span className="dur">{clock(t.duration_seconds)}</span> : null}</div>}
            <b>{t.title}</b><small className="muted">{t.program}</small>
          </button>
        ))}
      </div>
      {!shown.length && <div className="empty"><b>No talks yet</b>Hosts can add YouTube talks from Admin, or record and upload audio here.</div>}
    </section>
  );
}
