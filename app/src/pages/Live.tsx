import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ICameraVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import { initials } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { uploadPhoto } from "../lib/media";
import { useLive, agoraUid, REACTIONS, GIFTS, type Line } from "../lib/LiveContext";

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
const SLOTS = 9;

export default function Live() {
  const L = useLive();
  const { session } = useAuth();
  const { live, isStaff, me, joined, speaker, muted, busy, people, talking, requests, chat, error, notice } = L;
  const location = useLocation();
  const navigate = useNavigate();
  const autostart = useRef(Boolean((location.state as { autostart?: boolean } | null)?.autostart));
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [kind, setKind] = useState<"audio" | "video">("audio");
  const [record, setRecord] = useState(true);
  const [text, setText] = useState("");
  const [asQuestion, setAsQuestion] = useState(false);
  const [sheet, setSheet] = useState<"" | "people" | "gifts" | "host" | "bg">("");
  const [filter, setFilter] = useState<"all" | "questions">("all");
  const chatEnd = useRef<HTMLDivElement>(null);

  // Arriving from Admin "Go live": start hosting straight away
  useEffect(() => {
    if (autostart.current && live && isStaff && !joined) {
      autostart.current = false;
      navigate(".", { replace: true, state: null });
      L.join(live);
    }
  }, [live?.id, isStaff]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "end" }); }, [chat.length]);

  // ---------- nothing live ----------
  if (!live) return (
    <section className="view">
      <h1>Live</h1>
      {isStaff ? (
        <form className="pod-golive" onSubmit={async (e) => { e.preventDefault(); if (await L.goLiveNow({ title, topic, kind, record })) { setTitle(""); setTopic(""); } }}>
          <div className="row"><img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" /><div><b>Start a live session</b><p>Go live now. Everyone with the app can listen and call in.</p></div></div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Mentorship hour: planning your semester" aria-label="Session title" />
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (optional)" aria-label="Topic" />
          <div className="kindpick" role="radiogroup" aria-label="Session type">
            <button type="button" role="radio" aria-checked={kind === "audio"} className={kind === "audio" ? "on" : ""} onClick={() => setKind("audio")}>🎙 Audio<small>Like a podcast</small></button>
            <button type="button" role="radio" aria-checked={kind === "video"} className={kind === "video" ? "on" : ""} onClick={() => setKind("video")}>🎥 Video<small>Like Zoom</small></button>
          </div>
          <label className="pod-recopt"><input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} /> Record this session (saved as a draft in the Library{kind === "video" ? "; audio only" : ""})</label>
          <button className="btn pod-golive-btn" disabled={busy}>{busy ? "Starting…" : "● Go live now"}</button>
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
            {isStaff ? <button className="btn primary" onClick={() => L.startScheduled(s)}>● Go live</button>
              : <button className="btn primary" onClick={() => L.remind(s)}>Remind me</button>}</div>
        )) : <div className="muted">No sessions scheduled yet.</div>}
      </div>
      {notice && <p className="ok">{notice}</p>}
    </section>
  );

  // ---------- the live room ----------
  const onStage = requests.filter((r) => r.status === "on_air");
  const waiting = requests.filter((r) => r.status === "waiting");
  const listeners = people.filter((p) => !onStage.some((r) => r.user_id === p.id) && p.role !== "host");
  const isTalking = (userId: string) => talking.has(agoraUid(userId));
  const amHost = live.host_id === me;
  const mine = L.mine;
  const myQueue = waiting.findIndex((r) => r.user_id === me);
  const pinned = chat.find((c) => c.id === live.pinned_chat_id);
  const shown = filter === "questions" ? chat.filter((c) => c.kind === "question") : chat;
  const questions = chat.filter((c) => c.kind === "question").length;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const t = text; setText("");
    await L.sendChat(t, asQuestion ? "question" : "chat");
    setAsQuestion(false);
  }

  return (
    <section className="room" style={{ background: bgCss(live.background) }}>
      {/* top bar */}
      <div className="room-top">
        <div className="room-title">
          <span className="pill live">● LIVE</span>
          <b>{live.title}</b>
        </div>
        <div className="room-meta">
          {live.kind === "video" && <span className="pill soon">🎥</span>}
          {(L.recording || live.recording) && <span className="pill rec" title="Being recorded">● REC</span>}
          <span>{L.elapsed}</span>
          <button className="room-icon" onClick={L.share} aria-label="Share">⤴</button>
          {(amHost || isStaff) && joined && <button className="room-icon" onClick={() => setSheet("host")} aria-label="Host tools">⚙</button>}
        </div>
      </div>
      {live.topic && <p className="room-topic">{live.topic} · Hosted by {L.hostName}</p>}

      {!joined ? (
        <button className="room-tap" onClick={() => L.join()} disabled={busy}>{busy ? "Connecting…" : isStaff ? (amHost ? "▶ Continue hosting" : "▶ Join (you'll be on the mic)") : "🎧 Tap to listen"}</button>
      ) : L.needTap ? (
        <button className="room-tap" onClick={L.tapToHear}>🔊 Tap to hear the room</button>
      ) : null}

      {/* stage: host + call-in spots */}
      {live.kind === "video" ? (
        <div className={`vgrid n${Math.min(onStage.length + 1, 4)}`}>
          <VideoTile name={amHost ? "You" : L.hostName} label="Host" talking={live.host_id ? isTalking(live.host_id) : false}
            track={amHost ? (L.camOn ? L.cam.current : null) : (live.host_id ? L.remoteVideo[String(agoraUid(live.host_id))] ?? null : null)} mirror={amHost} />
          {onStage.map((r) => (
            <VideoTile key={r.id} name={r.user_id === me ? "You" : r.profiles?.full_name ?? "Caller"} label={r.muted_by_host ? "Muted" : "Caller"} talking={isTalking(r.user_id)} muted={r.muted_by_host}
              track={r.user_id === me ? (L.camOn ? L.cam.current : null) : L.remoteVideo[String(agoraUid(r.user_id))] ?? null} mirror={r.user_id === me}>
              {isStaff && <div className="vctl"><button className="chip" onClick={() => L.hostMute(r.id, !r.muted_by_host)}>{r.muted_by_host ? "Unmute" : "Mute"}</button><button className="chip" onClick={() => L.setStatus(r.id, "done")}>End</button></div>}
            </VideoTile>
          ))}
        </div>
      ) : (
        <div className="slots">
          <div className={`slot host${live.host_id && isTalking(live.host_id) ? " talking" : ""}`}>
            <div className="ava">{initials(amHost ? (session?.user ? L.myName : L.hostName) : L.hostName)}</div>
            <b>{amHost ? "You" : L.hostName.split(" ")[0]}</b><span className="tag">HOST</span>
          </div>
          {Array.from({ length: SLOTS }).map((_, i) => {
            const r = onStage[i];
            if (r) return (
              <div key={r.id} className={`slot${isTalking(r.user_id) ? " talking" : ""}`}>
                <div className="ava">{initials(r.profiles?.full_name ?? "")}{r.muted_by_host && <span className="mutedot">🔇</span>}</div>
                <b>{r.user_id === me ? "You" : (r.profiles?.full_name ?? "Caller").split(" ")[0]}</b>
                {isStaff && <span className="slotctl"><button onClick={() => L.hostMute(r.id, !r.muted_by_host)}>{r.muted_by_host ? "Unmute" : "Mute"}</button><button onClick={() => L.setStatus(r.id, "done")}>End</button></span>}
              </div>
            );
            return (
              <button key={`e${i}`} className="slot empty" onClick={() => !isStaff && !mine && L.requestCall()} disabled={isStaff || !!mine || !joined}>
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
        <button onClick={() => { setAsQuestion(true); document.getElementById("room-input")?.focus(); }}><span>✋</span>Raise hand</button>
        <button onClick={() => setSheet("people")}><span>👥</span>People <em>{Math.max(people.length, joined ? 1 : 0)}</em></button>
        <button onClick={() => setSheet("gifts")} disabled={!joined}><span>🎁</span>Gifts</button>
        {speaker && live.kind === "video" && <button onClick={L.toggleCam}><span>📷</span>{L.camOn ? "Cam off" : "Cam on"}</button>}
      </div>

      {pinned && (
        <div className="room-pin"><span>📌</span><div className="grow"><b>{pinned.profiles?.full_name ?? "Member"}</b> {pinned.body}</div>
          {isStaff && <button onClick={() => L.pinComment(null)} aria-label="Unpin">✕</button>}</div>
      )}

      {/* comments */}
      <div className="room-chat">
        {(isStaff || questions > 0) && (
          <div className="room-filter">
            <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All comments</button>
            <button className={filter === "questions" ? "on" : ""} onClick={() => setFilter("questions")}>❓ Questions {questions ? `(${questions})` : ""}</button>
          </div>
        )}
        {shown.map((c) => <ChatLine key={c.id} c={c} me={me} canPin={isStaff} pinned={c.id === live.pinned_chat_id} onPin={() => L.pinComment(c.id)} />)}
        {!shown.length && <p className="room-empty">{filter === "questions" ? "No questions yet." : "Say hello 👋"}</p>}
        <div ref={chatEnd} />
      </div>

      {/* reactions, gifts and floating emojis */}
      <div className="pod-floats" aria-hidden="true">{L.floats.map((f) => <span key={f.id} style={{ left: `${f.left}%` }}>{f.emoji}</span>)}</div>
      <div className="giftlayer" aria-live="polite">{L.giftShow.map((g) => <div key={g.id} className="giftpop"><span>{g.emoji}</span><b>{g.from}</b> sent a {g.name}</div>)}</div>

      {(error || notice) && <p className={error ? "room-msg err" : "room-msg"} role="status" onClick={() => { L.setError(""); L.setNotice(""); }}>{error || notice}</p>}

      <form className="room-compose" onSubmit={send}>
        <div className="room-reacts">{REACTIONS.map((r) => <button type="button" key={r} onClick={() => L.react(r)} disabled={!joined} aria-label={`React ${r}`}>{r}{r === "❤️" && L.likes > 0 ? <small>{L.likes}</small> : null}</button>)}</div>
        <div className="room-inputrow">
          <button type="button" className={`qtoggle${asQuestion ? " on" : ""}`} onClick={() => setAsQuestion((q) => !q)} aria-pressed={asQuestion} title="Send as a question for the host">❓</button>
          <input id="room-input" value={text} onChange={(e) => setText(e.target.value)} disabled={live.chat_locked && !isStaff}
            placeholder={live.chat_locked && !isStaff ? "The host has locked the chat" : asQuestion ? "Ask the host a question…" : "Chat…"} aria-label="Comment" />
          <button className="send" disabled={!text.trim()}>Send</button>
        </div>
        {joined && <button type="button" className="room-leave" onClick={L.leaveRoom}>Leave</button>}
      </form>

      {/* sheets */}
      {sheet && <div className="sheet-back" onClick={() => setSheet("")} />}
      {sheet === "people" && (
        <div className="sheet"><h3>In the room · {Math.max(people.length, 1)}</h3>
          <div className="sheet-list">{[...people].sort((a, b) => (a.role === "host" ? -1 : b.role === "host" ? 1 : 0)).map((p) => (
            <div key={p.id} className="row"><div className="ava sm">{initials(p.name)}</div><span className="grow">{p.id === me ? "You" : p.name}</span>{p.role === "host" && <span className="tag">HOST</span>}</div>
          ))}{!listeners.length && people.length <= 1 && <p className="muted">Share the link so others can join.</p>}</div>
          <button className="btn primary" onClick={L.share}>Invite people</button>
        </div>
      )}
      {sheet === "gifts" && (
        <div className="sheet"><h3>Send a gift to the host</h3>
          <p className="muted">Gifts show up big for everyone and highlight your comment.</p>
          <div className="giftgrid">{GIFTS.map((g) => <button key={g.name} onClick={() => { L.sendGift(g); setSheet(""); }}><span>{g.emoji}</span>{g.name}</button>)}</div>
        </div>
      )}
      {sheet === "host" && (
        <HostTools waiting={waiting} onStageCount={onStage.length} openBackground={() => setSheet("bg")} close={() => setSheet("")} />
      )}
      {sheet === "bg" && <BackgroundPicker close={() => setSheet("")} />}
    </section>
  );
}

function ChatLine({ c, me, canPin, pinned, onPin }: { c: Line; me: string; canPin: boolean; pinned: boolean; onPin: () => void }) {
  const name = c.user_id === me ? "You" : c.profiles?.full_name ?? "Member";
  return (
    <div className={`cline ${c.kind ?? "chat"}`}>
      <div className="ava sm">{initials(name === "You" ? "Me" : name)}</div>
      <div className="grow"><b>{name}</b> {c.kind === "question" && <span className="qbadge">❓ Question</span>} <span>{c.body}</span></div>
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
            <button className="btn primary" onClick={() => L.setStatus(r.id, "on_air")}>Bring on</button>
            <button className="btn ghost" aria-label="Decline" onClick={() => L.setStatus(r.id, "declined")}>✕</button></div>
        ))}
        {!waiting.length && <p className="muted">No one is waiting. Listeners tap a “Call in” spot to join the queue.</p>}
      </div>
      <div className="toolgrid">
        {onStageCount > 0 && <button onClick={L.muteAll}>🔇<span>Mute all callers</span></button>}
        <button onClick={L.toggleLock}>{live.chat_locked ? "🔓" : "🔒"}<span>{live.chat_locked ? "Unlock chat" : "Lock chat"}</span></button>
        <button onClick={openBackground}>🖼<span>Room background</span></button>
        {L.speaker && (L.recording
          ? <button onClick={L.saveRecording} disabled={L.savingRec}>■<span>Stop &amp; save recording</span></button>
          : <button onClick={L.startRecording} disabled={L.savingRec}>⏺<span>{L.savingRec ? "Saving…" : "Record"}</span></button>)}
        {L.speaker && live.kind === "video" && <button onClick={L.flipCam}>🔄<span>Switch camera</span></button>}
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
          <div className="row" style={{ flexWrap: "wrap" }}>
            <label className="btn primary filebtn">{L.musicBusy ? "Loading…" : L.musicName ? "Choose another song" : "Choose a song"}
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
function VideoTile({ track, name, label, talking, muted, mirror, children }: {
  track: ICameraVideoTrack | IRemoteVideoTrack | null; name: string; label: string; talking?: boolean; muted?: boolean; mirror?: boolean; children?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!track || !box.current) return;
    track.play(box.current, { fit: "cover", ...(mirror ? { mirror: true } : {}) });
    return () => { track.stop(); };
  }, [track, mirror]);
  return (
    <div className={`vtile${talking ? " talking" : ""}`}>
      <div className="vvideo" ref={box} />
      {!track && <div className="vnocam"><div className="ava">{initials(name === "You" ? "Me" : name)}</div></div>}
      <div className="vname">{muted ? "🔇 " : ""}{name} · <small>{label}</small></div>
      {children}
    </div>
  );
}
