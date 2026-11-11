import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ICameraVideoTrack, ILocalVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import { initials, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { uploadPhoto } from "../lib/media";
import { CAM_BGS, photoToBg, type CamBg } from "../lib/camBackground";
import { PAID_GIFTS, PAYMENTS_ENABLED, TEST_NOTE, paymentsOn, startPayment } from "../lib/pay";
import { useLive, agoraUid, REACTIONS, GIFTS, type Line } from "../lib/LiveContext";
import PersonSheet from "../components/PersonSheet";

// Room backgrounds the host can pick (or upload a photo)
export const BACKGROUNDS: { id: string; label: string; css: string }[] = [
  { id: "navy", label: "BCIL navy", css: "linear-gradient(160deg,#1e3f78 0%,#0b1d38 70%)" },
  { id: "night", label: "Night", css: "linear-gradient(160deg,#1b1b2f 0%,#08080f 75%)" },
  { id: "sunset", label: "Sunset", css: "linear-gradient(160deg,#7b2d43 0%,#2b1030 70%)" },
  { id: "forest", label: "Forest", css: "linear-gradient(160deg,#1e5a46 0%,#071d17 75%)" },
  { id: "gold", label: "Gold", css: "linear-gradient(160deg,#7a5a12 0%,#24190a 75%)" },
  { id: "purple", label: "Purple", css: "linear-gradient(160deg,#4b2a83 0%,#140a2b 75%)" },
];
const bgCss = (bg?: string | null) => {
  if (!bg) return BACKGROUNDS[0].css;
  const preset = BACKGROUNDS.find((b) => b.id === bg);
  if (preset) return preset.css;
  return `linear-gradient(rgba(5,10,25,.55),rgba(5,10,25,.85)), url("${bg}") center/cover`;
};
const SLOTS = 9;          // call-in spots shown at first
export const MAX_STAGE = 20; // most people who can talk at once (besides the host); more spots appear as people come on

export default function Live() {
  const L = useLive();
  const { session } = useAuth();
  const { live, isStaff, me, joined, speaker, muted, busy, people, talking, requests, chat, error, notice } = L;
  const location = useLocation();
  const navigate = useNavigate();
  const autostart = useRef(Boolean((location.state as { autostart?: boolean } | null)?.autostart));
  // arriving from a group's "Go live": a session only for that group
  const group = (location.state as { group?: { id: string; name: string; dm?: boolean } } | null)?.group ?? null;
  const dm = !!group?.dm;   // a live call with one person, started from a direct message
  const canStart = isStaff || !!group;
  const [title, setTitle] = useState(dm ? `Call with ${group!.name}` : "");
  const [topic, setTopic] = useState("");
  const [kind, setKind] = useState<"audio" | "video">(dm ? "video" : "audio");
  const [record, setRecord] = useState(!dm);
  const [startCam, setStartCam] = useState(true);
  const [priv, setPriv] = useState(false);
  const [review, setReview] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [text, setText] = useState("");
  const [asQuestion, setAsQuestion] = useState(false);
  const [sheet, setSheet] = useState<"" | "people" | "gifts" | "host" | "bg" | "cambg">("");
  const [filter, setFilter] = useState<"all" | "questions">("all");
  const [replyTo, setReplyTo] = useState<Line | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  useEffect(() => { if (!joined) setEntering(false); }, [joined, live?.id]);
  const chatEnd = useRef<HTMLDivElement>(null);

  // Opening a private session link (/live?join=CODE)
  const joinCode = new URLSearchParams(location.search).get("join");
  useEffect(() => {
    if (!joinCode) return;
    L.joinWithCode(joinCode).then(() => navigate("/live", { replace: true }));
  }, [joinCode]);

  // Arriving from Admin "Go live": start hosting straight away
  useEffect(() => {
    if (autostart.current && live && isStaff && !joined) {
      autostart.current = false;
      navigate(".", { replace: true, state: null });
      L.join(live);
    }
  }, [live?.id, isStaff]);
  useEffect(() => { if (joined) chatEnd.current?.scrollIntoView({ block: "end" }); }, [chat.length, joined]);
  // tell the host when someone raises a hand
  const raised = people.filter((p) => p.hand && p.id !== me);
  const seenHands = useRef<Set<string>>(new Set());
  useEffect(() => {
    const amHostNow = live?.host_id === me;
    for (const p of raised) if (!seenHands.current.has(p.id) && amHostNow) L.setNotice(`✋ ${p.name} raised their hand`);
    seenHands.current = new Set(raised.map((p) => p.id));
  }, [raised.map((p) => p.id).join(",")]);

  // ---------- nothing live ----------
  // starting a call from a DM while another session is on: still show the start form
  const startingOwn = !!group && !!live && live.room_id !== group.id && live.host_id !== me && !joined;
  if (!live || startingOwn) return (
    <section className="view">
      <h1>Live</h1>
      {canStart ? (
        <form className="pod-golive" onSubmit={(e) => { e.preventDefault(); if (title.trim().length < 3) { setFormErr("Add a title so people know what the session is about."); document.getElementById("golive-title")?.focus(); return; } setFormErr(""); setReview(true); }}>
          <div className="row"><img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" /><div><b>{dm ? `Live with ${group!.name}` : "Start a live session"}</b><p>{dm ? "A private call for just the two of you. You can both talk, use your cameras and share your screen." : "Go live now. Everyone with the app can listen and call in."}</p></div></div>
          <label className="golive-lab" htmlFor="golive-title">Title <span className="req">required</span></label>
          <input id="golive-title" value={title} onChange={(e) => { setTitle(e.target.value); setFormErr(""); }} placeholder="e.g. Mentorship hour: planning your semester" aria-label="Session title" aria-required="true" maxLength={90} />
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (optional)" aria-label="Topic" />
          <div className="kindpick" role="radiogroup" aria-label="Session type">
            <button type="button" role="radio" aria-checked={kind === "audio"} className={kind === "audio" ? "on" : ""} onClick={() => setKind("audio")}>🎙 Audio<small>Like a podcast</small></button>
            <button type="button" role="radio" aria-checked={kind === "video"} className={kind === "video" ? "on" : ""} onClick={() => setKind("video")}>🎥 Video<small>Like Zoom: everyone can turn their camera on</small></button>
          </div>
          {dm ? <p className="groupnote">📞 Only <b>{group!.name}</b> can see and join it. They get a notification now and can talk straight away.</p> : group ? <p className="groupnote">👥 For <b>{group.name}</b> only: members of the group are notified and can join. No one else sees it.</p> : <>
          <div className="kindpick" role="radiogroup" aria-label="Who can join">
            <button type="button" role="radio" aria-checked={!priv} className={!priv ? "on" : ""} onClick={() => setPriv(false)}>🌍 Public<small>Everyone is notified</small></button>
            <button type="button" role="radio" aria-checked={priv} className={priv ? "on" : ""} onClick={() => setPriv(true)}>🔒 Private<small>Only people with the link</small></button>
          </div>
          {priv && <p className="muted small" style={{ margin: 0 }}>No notification goes out and it won't show on Home. After you go live, tap ⤴ Invite to send the private link.</p>}
          </>}
          {kind === "video" && <label className="pod-recopt"><input type="checkbox" checked={startCam} onChange={(e) => setStartCam(e.target.checked)} /> Start with my camera on</label>}
          {!dm && <p className="muted small" style={{ margin: "4px 0" }}>{kind === "video" ? "🎥 Video: everyone joins muted and can unmute to talk. You can mute anyone." : "🎙 Audio: people tap Call in when they want to talk, and you bring them on air."}</p>}
          {isStaff && <label className="pod-recopt"><input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} /> Record this session (saved as a draft in the Library{kind === "video" ? "; audio only" : ""})</label>}
          {formErr && <p className="err" role="alert" style={{ margin: 0 }}>{formErr}</p>}
          <button className="btn pod-golive-btn" disabled={busy}>Review and go live →</button>
        </form>
      ) : (
        <div className="pod-empty">
          <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" />
          <div><b>Nothing is live right now</b><p className="muted">When BCIL goes live, it shows up here and you'll hear it straight away.</p></div>
        </div>
      )}
      {error && <p className="err" role="alert">{error}</p>}
      <h2>Coming up</h2>
      <div className="list">
        {L.upcoming.length ? L.upcoming.map((s) => (
          <div key={s.id}><div className="grow"><b>{s.title}</b><br /><small className="muted">{new Date(s.starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></div>
            {isStaff ? <button className="btn primary" onClick={() => { if (window.confirm(`Go live now with “${s.title}”?\n\nEveryone with the app will be notified.`)) L.startScheduled(s); }}>● Go live</button>
              : <button className="btn primary" onClick={() => L.remind(s)}>Remind me</button>}</div>
        )) : <div className="muted">No sessions scheduled yet.</div>}
      </div>
      {notice && <p className="ok">{notice}</p>}
      {review && <>
        <div className="sheet-back" onClick={() => setReview(false)} />
        <div className="sheet golive-review" role="dialog" aria-label="Check before going live">
          <h3 style={{ margin: 0 }}>Ready to go live?</h3>
          <div className="gl-rows">
            <div><span>Title</span><b>{title.trim()}</b></div>
            {topic.trim() && <div><span>Topic</span><b>{topic.trim()}</b></div>}
            <div><span>Type</span><b>{kind === "video" ? `🎥 Video${startCam ? " · your camera starts on" : " · camera off at first"}` : "🎙 Audio"}</b></div>
            <div><span>Who can join</span><b>{dm ? `📞 Only ${group!.name}. They're notified now.` : group ? `👥 Only members of ${group.name}. They're notified now.` : priv ? "🔒 Private: only people you send the link to. No notification." : "🌍 Public: everyone with the app is notified now."}</b></div>
            <div className={record && isStaff ? "rec" : ""}><span>Recording</span><b>{record && isStaff ? "● ON: the session will be recorded and saved as a draft in the Library. Everyone in the room sees a REC badge." : "Off: nothing will be recorded."}</b></div>
          </div>
          {record && isStaff && <p className="gl-warn">Make sure speakers are happy to be recorded. You can stop the recording any time from ⚙ Host tools.</p>}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn primary" disabled={busy} onClick={async () => {
              if (await L.goLiveNow({ title, topic, kind, record: record && isStaff, cam: startCam, private: priv, roomId: group?.id, dm, openMic: dm || kind === "video" })) { setTitle(""); setTopic(""); setPriv(false); navigate(".", { replace: true, state: null }); }
              setReview(false);
            }}>{busy ? "Starting…" : "● Go live now"}</button>
            <button className="btn ghost" disabled={busy} onClick={() => setReview(false)}>← Go back and edit</button>
          </div>
        </div>
      </>}
    </section>
  );

  // ---------- something is live, but you haven't joined: a simple card, the room opens when you join ----------
  const amHost = live.host_id === me;
  if (!joined && !amHost && !entering) return (
    <section className="view">
      <h1>Live</h1>
      <div className="livecard" style={{ background: bgCss(live.background) }}>
        <div className="row"><span className="pill live">● LIVE</span>{live.is_private && <span className="pill privpill">🔒 Private</span>}<span className="lc-kind">{live.kind === "video" ? "🎥 Video" : "🎙 Audio"} · {L.elapsed}</span></div>
        <b className="lc-title">{live.title}</b>
        <small>{live.topic && !live.topic.startsWith("/doc/") ? `${live.topic} · ` : ""}Hosted by {L.hostName}{people.length ? ` · ${people.length} in the room` : ""}</small>
        <button className="btn lc-join" disabled={busy} onClick={() => { if (live.kind === "video") setEntering(true); else { setEntering(true); L.join(); } }}>
          {busy ? "Connecting…" : live.kind === "video" ? "Join the session" : "🎧 Join and listen"}</button>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {L.upcoming.length > 0 && <>
        <h2>Coming up</h2>
        <div className="list">{L.upcoming.map((s) => (
          <div key={s.id}><div className="grow"><b>{s.title}</b><br /><small className="muted">{new Date(s.starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></div>
            {!isStaff && <button className="btn primary" onClick={() => L.remind(s)}>Remind me</button>}</div>
        ))}</div>
      </>}
    </section>
  );

  // ---------- the live room ----------
  const onStage = requests.filter((r) => r.status === "on_air");
  const waiting = requests.filter((r) => r.status === "waiting");
  // listeners who switched their camera on (video sessions work like Zoom)
  const stageUids = new Set([live?.host_id, ...onStage.map((r) => r.user_id)].filter(Boolean).map((id) => String(agoraUid(id as string))));
  const guestCams = Object.entries(L.remoteVideo).filter(([uid]) => !stageUids.has(uid))
    .map(([uid, track]) => ({ uid, track, name: people.find((p) => String(agoraUid(p.id)) === uid)?.name ?? "Guest" }));
  const meGuestCam = (L.camOn || L.sharing) && !amHost && !onStage.some((r) => r.user_id === me);
  // my own picture: the shared screen while sharing, otherwise the camera
  const myVideo = L.sharing ? L.screen.current : L.camOn ? L.cam.current : null;
  const isScreen = (userId?: string | null) => !!userId && (userId === me ? L.sharing : !!people.find((p) => p.id === userId)?.screen);
  const sharer = people.find((p) => p.screen && p.id !== me);
  const tiles = 1 + onStage.length + guestCams.length + (meGuestCam ? 1 : 0);
  const hands = people.filter((p) => p.hand && p.id !== me).sort((a, b) => (a.hand ?? 0) - (b.hand ?? 0));
  const listeners = people.filter((p) => !onStage.some((r) => r.user_id === p.id) && p.role !== "host");
  const isTalking = (userId: string) => talking.has(agoraUid(userId));
  const mine = L.mine;
  const myQueue = waiting.findIndex((r) => r.user_id === me);
  const pinned = chat.find((c) => c.id === live.pinned_chat_id);
  const shown = filter === "questions" ? chat.filter((c) => c.kind === "question") : chat;
  const questions = chat.filter((c) => c.kind === "question").length;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const t = text; setText("");
    const r = replyTo; setReplyTo(null);
    await L.sendChat(t, asQuestion ? "question" : "chat", r?.id);
    setAsQuestion(false);
  }

  return (
    <section className="liveroom" style={{ background: bgCss(live.background) }}>
      {/* top bar */}
      <div className="room-top">
        <div className="room-title">
          <span className="pill live">● LIVE</span>
          {live.is_private && <span className="pill privpill" title="Private: only people with the link can join">🔒</span>}
          <b>{live.title}</b>
        </div>
        <div className="room-meta">
          {live.kind === "video" && <span className="pill soon">🎥</span>}
          {(L.recording || live.recording) && <span className="pill rec" title="Being recorded">● REC</span>}
          <span>{L.elapsed}</span>
          <button className="room-pillbtn" onClick={L.share} aria-label={live.is_private ? "Copy the private invite link" : "Share"}>{live.is_private ? "🔒 Invite" : "⤴ Share"}</button>
          {amHost && joined && <button className="room-pillbtn" onClick={() => setSheet("host")} aria-label="Host tools">⚙</button>}
          {joined && <button className="room-pillbtn leave" onClick={L.leaveRoom}>Leave</button>}
        </div>
      </div>
      {live.topic && <p className="room-topic">{live.topic.startsWith("/doc/") ? <Link to={live.topic}>📄 Open the document you are reviewing</Link> : live.topic} · Hosted by {L.hostName}</p>}

      {!joined && live.kind === "video" ? (
        <PreJoin openBg={() => setSheet("cambg")} label={amHost ? "Continue hosting" : "Join the session"} />
      ) : !joined ? (
        <button className="room-tap" onClick={() => L.join()} disabled={busy}>{busy ? "Connecting…" : amHost ? "▶ Continue hosting" : "🎧 Tap to listen"}</button>
      ) : L.needTap ? (
        <button className="room-tap" onClick={L.tapToHear}>🔊 Tap to hear the room</button>
      ) : null}

      {isStaff && !amHost && joined && !people.some((p) => p.id === live.host_id) && (
        <div className="room-takeover">The host has left the room. <button className="chip" onClick={L.takeOver}>Take over as host</button></div>
      )}
      {/* stage: host + call-in spots */}
      {live.kind === "video" ? (
        <div className={`vgrid n${Math.min(tiles, 4)}${tiles > 4 ? " many" : ""}`}>
          <VideoTile name={amHost ? "You" : L.hostName} label="Host" talking={live.host_id ? isTalking(live.host_id) : false}
            track={amHost ? myVideo : (live.host_id ? L.remoteVideo[String(agoraUid(live.host_id))] ?? null : null)} mirror={amHost && !L.sharing} screen={isScreen(live.host_id)} />
          {onStage.map((r) => (
            <VideoTile key={r.id} name={r.user_id === me ? "You" : r.profiles?.full_name ?? "Caller"} label={r.muted_by_host ? "Muted" : "Caller"} talking={isTalking(r.user_id)} muted={r.muted_by_host}
              track={r.user_id === me ? myVideo : L.remoteVideo[String(agoraUid(r.user_id))] ?? null} mirror={r.user_id === me && !L.sharing} screen={isScreen(r.user_id)}>
              {amHost && <div className="vctl"><button className="chip" onClick={() => L.hostMute(r.id, !r.muted_by_host)}>{r.muted_by_host ? "Unmute" : "Mute"}</button><button className="chip" onClick={() => L.setStatus(r.id, "done")}>End</button></div>}
            </VideoTile>
          ))}
          {meGuestCam && <VideoTile name="You" label={L.sharing ? "Sharing screen" : "Camera on"} talking={false} track={myVideo} mirror={!L.sharing} screen={L.sharing} />}
          {guestCams.map((g) => { const p = people.find((x) => String(agoraUid(x.id)) === g.uid); return <VideoTile key={g.uid} name={g.name} label={p?.screen ? "Sharing screen" : "Guest"} talking={false} track={g.track} screen={!!p?.screen} />; })}
        </div>
      ) : (
        <div className="slots">
          <div className={`slot host${live.host_id && isTalking(live.host_id) ? " talking" : ""}`}>
            <div className="ava">{initials(amHost ? (session?.user ? L.myName : L.hostName) : L.hostName)}</div>
            <b>{amHost ? "You" : L.hostName.split(" ")[0]}</b><span className="tag">HOST</span>
          </div>
          {Array.from({ length: Math.min(MAX_STAGE, Math.max(SLOTS, onStage.length + 1)) }).map((_, i) => {
            const r = onStage[i];
            if (r) return (
              <div key={r.id} className={`slot${isTalking(r.user_id) ? " talking" : ""}`}>
                <div className="ava">{initials(r.profiles?.full_name ?? "")}{r.muted_by_host && <span className="mutedot">🔇</span>}</div>
                <b>{r.user_id === me ? "You" : (r.profiles?.full_name ?? "Caller").split(" ")[0]}</b>
                {amHost && <span className="slotctl"><button onClick={() => L.hostMute(r.id, !r.muted_by_host)}>{r.muted_by_host ? "Unmute" : "Mute"}</button><button onClick={() => L.setStatus(r.id, "done")}>End</button></span>}
              </div>
            );
            return (
              <button key={`e${i}`} className="slot empty" onClick={() => !amHost && !mine && L.requestCall()} disabled={amHost || !!mine || !joined}>
                <div className="ava">＋</div><b>#{i + 1} Call in</b>
              </button>
            );
          })}
        </div>
      )}

      {/* action row */}
      <div className="room-actions">
        {speaker ? (
          <button onClick={L.toggleMute} disabled={muted && !!mine?.muted_by_host} className={muted ? "on" : ""}>
            <span>{muted ? "🔇" : "🎙"}</span>{muted && mine?.muted_by_host ? "Muted by host" : muted ? "Unmute" : "Mute"}</button>
        ) : mine?.status === "waiting" ? (
          <button onClick={() => L.setStatus(mine.id, "cancelled")} className="on"><span>✋</span>#{myQueue + 1} in line · Cancel</button>
        ) : (
          <button onClick={L.requestCall} disabled={!joined}><span>📞</span>Call in</button>
        )}
        {amHost
          ? <button onClick={() => setSheet("people")} className={hands.length ? "on" : ""}><span>✋</span>Hands <em>{hands.length || ""}</em></button>
          : <button onClick={L.toggleHand} className={L.handUp ? "on" : ""} disabled={!joined}><span>✋</span>{L.handUp ? "Lower hand" : "Raise hand"}</button>}
        <button onClick={() => setSheet("people")}><span>👥</span>People <em>{Math.max(people.length, joined ? 1 : 0)}</em></button>
        <button onClick={() => setSheet("gifts")} disabled={!joined}><span>🎁</span>Gifts</button>
        {joined && live.kind === "video" && !L.sharing && <button onClick={L.toggleCam} className={L.camOn ? "on" : ""}><span>📷</span>{L.camOn ? "Cam off" : "Cam on"}</button>}
        {joined && live.kind === "video" && L.canShare && (speaker || L.canVideo) && (!sharer || L.sharing) && <button onClick={L.toggleShare} className={L.sharing ? "on" : ""}><span>🖥</span>{L.sharing ? "Stop sharing" : "Share screen"}</button>}
        {L.camOn && live.kind === "video" && <button onClick={() => setSheet("cambg")} className={L.camBg.type !== "none" ? "on" : ""}><span>🖼</span>Background</button>}
      </div>

      {pinned && (
        <div className="room-pin"><span>📌</span><div className="grow"><b>{pinned.profiles?.full_name ?? "Member"}</b> {pinned.body}</div>
          {amHost && <button onClick={() => L.pinComment(null)} aria-label="Unpin">✕</button>}</div>
      )}

      {/* comments */}
      <div className="room-chat">
        {(amHost || questions > 0) && (
          <div className="room-filter">
            <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All comments</button>
            <button className={filter === "questions" ? "on" : ""} onClick={() => setFilter("questions")}>❓ Questions {questions ? `(${questions})` : ""}</button>
          </div>
        )}
        {shown.map((c) => <ChatLine key={c.id} c={c} me={me} canPin={amHost} pinned={c.id === live.pinned_chat_id} onPin={() => L.pinComment(c.id)}
          quoted={c.reply_to ? chat.find((x) => x.id === c.reply_to) ?? null : null}
          onReply={() => { setReplyTo(c); document.getElementById("room-input")?.focus(); }} onPerson={() => setPerson(c.user_id)} />)}
        {!shown.length && <p className="room-empty">{filter === "questions" ? "No questions yet." : "Say hello 👋"}</p>}
        <div ref={chatEnd} />
      </div>

      {/* reactions, gifts and floating emojis */}
      <div className="pod-floats" aria-hidden="true">{L.floats.map((f) => <span key={f.id} style={{ left: `${f.left}%` }}>{f.emoji}</span>)}</div>
      <div className="giftlayer" aria-live="polite">{L.giftShow.map((g) => <div key={g.id} className="giftpop"><span>{g.emoji}</span><b>{g.from}</b> sent a {g.name}</div>)}</div>

      {(error || notice) && <p className={error ? "room-msg err" : "room-msg"} role="status" onClick={() => { L.setError(""); L.setNotice(""); }}>{error || notice}</p>}

      <form className="room-compose" onSubmit={send}>
        <div className="room-reacts">{REACTIONS.map((r) => <button type="button" key={r} onClick={() => L.react(r)} disabled={!joined} aria-label={`React ${r}`}>{r}{r === "❤️" && L.likes > 0 ? <small>{L.likes}</small> : null}</button>)}</div>
        {replyTo && <div className="room-replybar"><span className="grow">↩ Replying to <b>{replyTo.user_id === me ? "yourself" : replyTo.profiles?.full_name ?? "Member"}</b>: {replyTo.body}</span>
          <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">✕</button></div>}
        <div className="room-inputrow">
          <button type="button" className={`qtoggle${asQuestion ? " on" : ""}`} onClick={() => setAsQuestion((q) => !q)} aria-pressed={asQuestion} title="Send as a question for the host">❓</button>
          <input id="room-input" value={text} onChange={(e) => setText(e.target.value)} disabled={live.chat_locked && !isStaff}
            placeholder={live.chat_locked && !isStaff ? "The host has locked the chat" : asQuestion ? "Ask the host a question…" : "Chat…"} aria-label="Comment" />
          <button className="send" disabled={!text.trim()}>Send</button>
        </div>
      </form>

      {/* sheets */}
      {sheet && <div className="sheet-back" onClick={() => setSheet("")} />}
      {sheet === "people" && (
        <div className="sheet"><h3>In the room · {Math.max(people.length, 1)}</h3>
          {hands.length > 0 && <p className="muted small">✋ {hands.length} raised hand{hands.length > 1 ? "s" : ""}, in the order they were raised</p>}
          <div className="sheet-list">{[...people].sort((a, b) => (a.role === "host" ? -1 : b.role === "host" ? 1 : 0) || ((a.hand || 9e15) - (b.hand || 9e15))).map((p) => (
            <div key={p.id} className="row"><button className="plainbtn row" style={{ gap: 10, flex: 1, minWidth: 0 }} onClick={() => setPerson(p.id)}><div className="ava sm">{initials(p.name)}</div><span className="grow" style={{ textAlign: "left" }}>{p.hand ? "✋ " : ""}{p.id === me ? "You" : p.name}</span></button>{p.role === "host" && <span className="tag">HOST</span>}
              {amHost && !!p.hand && p.id !== me && <button className="chip" onClick={() => L.lowerHand(p.id)}>Lower</button>}
              {amHost && p.id !== me && p.staff && <button className="chip" onClick={() => { setSheet(""); L.makeHost(p.id); }}>Make host</button>}</div>
          ))}{!listeners.length && people.length <= 1 && <p className="muted">Share the link so others can join.</p>}</div>
          <button className="btn primary" onClick={L.share}>{live.is_private ? "🔒 Send the private link" : "Invite people"}</button>
        </div>
      )}
      {sheet === "gifts" && (
        <GiftSheet close={() => setSheet("")} />
      )}
      {sheet === "host" && (
        <HostTools waiting={waiting} onStageCount={onStage.length} openBackground={() => setSheet("bg")} close={() => setSheet("")} />
      )}
      {sheet === "bg" && <BackgroundPicker close={() => setSheet("")} />}
      {sheet === "cambg" && <CamBgPicker close={() => setSheet("")} />}
      {person && <PersonSheet userId={person} close={() => setPerson(null)} />}
    </section>
  );
}

function ChatLine({ c, me, canPin, pinned, onPin, quoted, onReply, onPerson }: { c: Line; me: string; canPin: boolean; pinned: boolean; onPin: () => void; quoted: Line | null; onReply: () => void; onPerson: () => void }) {
  const name = c.user_id === me ? "You" : c.profiles?.full_name ?? "Member";
  const sx = useRef<{ x: number; y: number } | null>(null);
  return (
    <div className={`cline ${c.kind ?? "chat"}`}
      onTouchStart={(e) => { sx.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={(e) => { const s0 = sx.current; sx.current = null; if (s0 && c.kind !== "gift" && e.changedTouches[0].clientX - s0.x > 60 && Math.abs(e.changedTouches[0].clientY - s0.y) < 40) onReply(); }}>
      <button className="plainbtn" onClick={onPerson} aria-label={`See ${name}'s profile`}><div className="ava sm">{initials(name === "You" ? "Me" : name)}</div></button>
      <div className="grow">
        {c.reply_to && <div className="cquote">↩ <b>{quoted ? (quoted.user_id === me ? "You" : quoted.profiles?.full_name ?? "Member") : "Reply"}</b> {quoted ? quoted.body : "earlier comment"}</div>}
        <button className="plainbtn cname" onClick={onPerson}>{name}</button> {c.kind === "question" && <span className="qbadge">❓ Question</span>} <span>{c.body}</span>
        {c.kind !== "gift" && <button className="creply" onClick={onReply} aria-label={`Reply to ${name}`}>Reply</button>}
      </div>
      {canPin && c.kind !== "gift" && <button className="pinbtn" onClick={onPin} aria-label="Pin">{pinned ? "📌" : "Pin"}</button>}
    </div>
  );
}

function HostTools({ waiting, onStageCount, openBackground, close }: { waiting: ReturnType<typeof useLive>["requests"]; onStageCount: number; openBackground: () => void; close: () => void }) {
  const L = useLive();
  const live = L.live!;
  return (
    <div className="sheet tall">
      <div className="row" style={{ justifyContent: "space-between" }}><h3>Host tools</h3><button className="linkbtn" onClick={close}>Done</button></div>
      <h4>Call-in queue <span className="pill soon">{waiting.length} waiting</span></h4>
      <div className="sheet-list">
        {waiting.map((r) => (
          <div key={r.id} className="row"><div className="ava sm">{initials(r.profiles?.full_name ?? "")}</div>
            <div className="grow"><b>{r.profiles?.full_name}</b><br /><small className="muted">{r.topic ?? "No topic"}</small></div>
            <button className="btn primary" disabled={onStageCount >= MAX_STAGE} title={onStageCount >= MAX_STAGE ? `Up to ${MAX_STAGE} people can talk at once. End someone's turn first.` : undefined} onClick={() => L.setStatus(r.id, "on_air")}>Bring on</button>
            <button className="btn ghost" aria-label="Decline" onClick={() => L.setStatus(r.id, "declined")}>✕</button></div>
        ))}
        {onStageCount >= MAX_STAGE && <p className="muted">The stage is full ({MAX_STAGE} people talking). End someone's turn to bring on the next person.</p>}
        {!waiting.length && <p className="muted">No one is waiting. Listeners tap a “Call in” spot to join the queue.</p>}
      </div>
      <div className="toolgrid">
        {onStageCount > 0 && <button onClick={L.muteAll}>🔇<span>Mute all callers</span></button>}
        <button onClick={L.toggleLock}>{live.chat_locked ? "🔓" : "🔒"}<span>{live.chat_locked ? "Unlock chat" : "Lock chat"}</span></button>
        <button onClick={openBackground}>🖼<span>Room background</span></button>
        {L.speaker && (L.recording
          ? <button onClick={L.saveRecording} disabled={L.savingRec}>■<span>Stop &amp; save recording</span></button>
          : <button onClick={L.startRecording} disabled={L.savingRec}>⏺<span>{L.savingRec ? "Saving…" : "Record"}</span></button>)}
        {L.camOn && live.kind === "video" && <button onClick={L.flipCam}>🔄<span>Switch camera</span></button>}
        <button className="danger" onClick={L.endSession}>⏹<span>End session</span></button>
      </div>
      {L.speaker && (
        <div className="musicbox">
          <div className="row" style={{ justifyContent: "space-between" }}><h4>🎵 Background music</h4>{L.musicName && <span className={`pill ${L.musicPlaying ? "live" : ""}`}>{L.musicPlaying ? "Playing" : "Paused"}</span>}</div>
          {L.musicName && <>
            <div className="row" style={{ gap: 8 }}><b className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{L.musicName}</b>
              <button className="btn ghost" onClick={L.pauseMusic}>{L.musicPlaying ? "Pause" : "Play"}</button><button className="btn ghost" onClick={L.stopMusic}>Stop</button></div>
            <label className="field">Volume {L.musicVol}%<input type="range" min={0} max={100} value={L.musicVol} onChange={(e) => L.setVolume(Number(e.target.value))} /></label>
          </>}
          <MusicLibrary />
          <div className="row" style={{ flexWrap: "wrap" }}>
            <label className="btn ghost sm filebtn">{L.musicBusy ? "Loading…" : "Play a file from this device"}
              <input type="file" accept="audio/*" onChange={(e) => { L.startMusic(e.target.files?.[0]); e.target.value = ""; }} hidden /></label>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={L.musicLoop} onChange={(e) => L.setMusicLoop(e.target.checked)} style={{ width: 18, height: 18 }} /> Repeat</label>
          </div>
          <small className="muted">Use headphones so the music doesn't echo into your microphone.</small>
        </div>
      )}
    </div>
  );
}

function BackgroundPicker({ close }: { close: () => void }) {
  const L = useLive();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  async function upload(f?: File) {
    if (!f) return;
    setBusy(true);
    try { await L.setBackground(await uploadPhoto(session!.user.id, f, 1600)); close(); }
    catch (e) { L.setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="sheet"><div className="row" style={{ justifyContent: "space-between" }}><h3>Room background</h3><button className="linkbtn" onClick={close}>Done</button></div>
      <div className="bggrid">
        {BACKGROUNDS.map((b) => (
          <button key={b.id} className={(L.live?.background ?? "navy") === b.id ? "on" : ""} style={{ background: b.css }} onClick={() => { L.setBackground(b.id === "navy" ? null : b.id); }}>{b.label}</button>
        ))}
        <label className="bgupload">{busy ? "Uploading…" : "📷 Use a photo"}<input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} /></label>
      </div>
    </div>
  );
}

// One person's video on stage; shows their initials when the camera is off
function VideoTile({ track, name, label, talking, muted, mirror, screen, children }: {
  track: ICameraVideoTrack | ILocalVideoTrack | IRemoteVideoTrack | null; name: string; label: string; talking?: boolean; muted?: boolean; mirror?: boolean; screen?: boolean; children?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!track || !el) return;
    track.play(el, { fit: screen ? "contain" : "cover", ...(mirror ? { mirror: true } : {}) });
    // only stop if the video is still playing here: when the same camera moves to another tile
    // (preview -> room), stopping it would blank your own view while others still see you
    return () => { if (el.querySelector("video")) track.stop(); };
  }, [track, mirror, screen]);
  return (
    <div className={`vtile${talking ? " talking" : ""}${screen ? " vscreen" : ""}`}>
      <div className="vvideo" ref={box} />
      {!track && <div className="vnocam"><div className="ava">{initials(name === "You" ? "Me" : name)}</div></div>}
      <div className="vname">{muted ? "🔇 " : ""}{name} · <small>{label}</small></div>
      {children}
    </div>
  );
}

// Pick a background behind your face on camera: blur, a colour, an FCB photo, or your own photo
function CamBgPicker({ close }: { close: () => void }) {
  const L = useLive();
  const [busy, setBusy] = useState("");
  const pick = async (bg: CamBg) => { setBusy(bg.id); const ok = await L.setCamBg(bg); setBusy(""); if (ok) close(); };
  const preview = (b: CamBg): React.CSSProperties =>
    b.type === "color" ? { background: b.color } : b.type === "img" ? { backgroundImage: `url(${b.src})` } : {};
  const all = L.camBg.id === "custom" ? [...CAM_BGS, L.camBg] : CAM_BGS;
  return (
    <div className="sheet tall"><h3>Camera background</h3>
      <p className="muted small">Only your camera changes. It may take a few seconds the first time.</p>
      <div className="cambg-grid">
        {all.map((b) => (
          <button key={b.id} className={`cambg ${L.camBg.id === b.id ? "on" : ""} ${b.type}`} style={preview(b)} onClick={() => pick(b)} disabled={!!busy}>
            <span>{busy === b.id ? "…" : b.type === "none" ? "🚫" : b.type === "blur" ? (b.blur === 3 ? "◎" : "○") : ""}</span><b>{b.label}</b>
          </button>
        ))}
        <label className="cambg upload">
          <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) pick(await photoToBg(f)); }} />
          <span>＋</span><b>My photo</b>
        </label>
      </div>
      <button className="btn ghost" onClick={close}>Done</button>
    </div>
  );
}

// Before joining a video session: choose camera on or off (with a preview and background), like Zoom's waiting screen
function PreJoin({ openBg, label }: { openBg: () => void; label: string }) {
  const L = useLive();
  useEffect(() => () => L.stopPreview(), []);
  return (
    <div className="prejoin">
      <div className="prejoin-view">
        {L.previewOn && L.cam.current
          ? <VideoTile track={L.cam.current} name="You" label="Preview" mirror />
          : <div className="prejoin-off"><div className="ava">{initials(L.myName)}</div><small>Camera is off</small></div>}
      </div>
      <div className="prejoin-ctl">
        <button className={L.previewOn ? "on" : ""} onClick={() => (L.previewOn ? L.stopPreview() : L.startPreview())}>
          <span>📷</span>{L.previewOn ? "Camera on" : "Camera off"}</button>
        {L.previewOn && <button onClick={openBg}><span>🖼</span>Background</button>}
      </div>
      <p className="muted small">{L.previewOn ? "People will see you when you join." : "You can turn your camera on later."} Your microphone stays off until you call in.</p>
      <button className="btn primary prejoin-go" disabled={L.busy} onClick={() => L.join(undefined, { cam: L.previewOn })}>
        {L.busy ? "Joining…" : `${label}${L.previewOn ? " with camera" : ""}`}</button>
    </div>
  );
}

// Gifts: free ones for everyone, and (once giving is on) paid gifts where 100% goes to BCIL Foundation
function GiftSheet({ close }: { close: () => void }) {
  const L = useLive();
  const canPay = paymentsOn(L.isStaff);
  const [tab, setTab] = useState<"free" | "support">(canPay ? "support" : "free");
  const [busy, setBusy] = useState("");
  const pay = async (g: (typeof PAID_GIFTS)[number]) => {
    setBusy(g.code);
    try {
      await startPayment({ kind: "live_gift", gift_code: g.code, session_id: L.live!.id });
      L.setNotice("Finish paying on the Paystack page. Your gift appears in the room as soon as it's paid. Thank you!");
      close();
    } catch (e) { L.setError((e as Error).message); }
    finally { setBusy(""); }
  };
  return (
    <div className="sheet"><h3>Send a gift</h3>
      {canPay && (
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === "support"} onClick={() => setTab("support")}>💛 Support BCIL</button>
          <button role="tab" aria-selected={tab === "free"} onClick={() => setTab("free")}>Free gifts</button>
        </div>
      )}
      {tab === "free" ? <>
        <p className="muted">Free gifts show up big for everyone and highlight your comment.</p>
        <div className="giftgrid">{GIFTS.map((g) => <button key={g.name} onClick={() => { L.sendGift(g); close(); }}><span>{g.emoji}</span>{g.name}</button>)}</div>
      </> : <>
        {!PAYMENTS_ENABLED && <p className="testnote">{TEST_NOTE}</p>}
        <p className="muted">100% goes to BCIL Foundation's programmes. Pay with Mobile Money or card. Your gift shows in the room for everyone (the amount is never shown).</p>
        <div className="giftgrid paid">{PAID_GIFTS.map((g) => (
          <button key={g.code} onClick={() => pay(g)} disabled={!!busy}><span>{g.emoji}</span>{g.name}<em>{busy === g.code ? "…" : `GH₵ ${g.cedis}`}</em></button>
        ))}</div>
        <p className="muted small">Want to donate a different amount? Use <a href={`${import.meta.env.BASE_URL}donate`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>Donate</a> in the menu.</p>
      </>}
    </div>
  );
}

// BCIL's saved background music: upload songs once, then play them in any session
type Song = { id: number; name: string; path: string };
const songCache = new Map<string, File>();
function MusicLibrary() {
  const L = useLive();
  const { isStaff } = useAuth();
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const load = () => supabase.from("live_music").select("id, name, path").order("name").then(({ data, error }) => setSongs(error ? [] : (data ?? []) as Song[]));
  useEffect(() => { load(); }, []);
  async function play(s: Song) {
    setErr(""); setBusy(`play-${s.id}`);
    try {
      let f = songCache.get(s.path);
      if (!f) {
        const { data, error } = await supabase.storage.from("live-music").download(s.path);
        if (error || !data) throw new Error();
        f = new File([data], s.name, { type: data.type || "audio/mpeg" });
        songCache.set(s.path, f);
      }
      await L.startMusic(f);
    } catch { setErr("Could not load that song. Check your connection and try again."); }
    finally { setBusy(""); }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setErr(""); setBusy("upload");
    let failed = 0;
    for (const file of Array.from(files)) {
      if (file.size > 30 * 1024 * 1024) { failed++; continue; }
      const path = `${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
      const up = await supabase.storage.from("live-music").upload(path, file, { contentType: file.type || "audio/mpeg" });
      if (up.error) { failed++; continue; }
      const { error } = await supabase.from("live_music").insert({ name: file.name.replace(/\.[^.]+$/, "").slice(0, 120), path });
      if (error) { failed++; await supabase.storage.from("live-music").remove([path]); continue; }
      songCache.set(path, file);
    }
    setBusy(""); load();
    if (failed) setErr(`${failed} file${failed > 1 ? "s" : ""} could not be uploaded. Use MP3, M4A or WAV files under 30 MB.`);
  }
  async function remove(s: Song) {
    if (!window.confirm(`Remove "${s.name}" from BCIL's music?`)) return;
    setSongs((cur) => cur?.filter((x) => x.id !== s.id) ?? cur);
    await supabase.from("live_music").delete().eq("id", s.id);
    await supabase.storage.from("live-music").remove([s.path]);
  }
  return (
    <div className="musiclib">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <b>Saved music</b>
        {isStaff && <label className="btn primary sm filebtn">{busy === "upload" ? "Uploading…" : "＋ Upload songs"}
          <input type="file" accept="audio/*" multiple hidden disabled={busy === "upload"} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} /></label>}
      </div>
      {songs === null ? <small className="muted">Loading…</small>
        : songs.length === 0 ? <small className="muted">{isStaff ? "Upload your background songs once and they stay here for every session." : "No saved music yet."}</small>
        : <ul className="songs">{songs.map((s) => (
          <li key={s.id} className={L.musicName === s.name ? "on" : ""}>
            <button className="songplay" disabled={!!busy || L.musicBusy} onClick={() => play(s)} aria-label={`Play ${s.name}`}>{busy === `play-${s.id}` ? "…" : L.musicName === s.name && L.musicPlaying ? "♪" : "▶"}</button>
            <span className="grow">{s.name}</span>
            {isStaff && <button className="linkbtn" onClick={() => remove(s)} aria-label={`Remove ${s.name}`}>✕</button>}
          </li>))}</ul>}
      {err && <small className="err">{err}</small>}
    </div>
  );
}
