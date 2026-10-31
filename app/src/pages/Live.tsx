import { useEffect, useRef, useState } from "react";
import AgoraRTC, { type IAgoraRTCClient, type IMicrophoneAudioTrack } from "agora-rtc-sdk-ng";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, initials } from "../lib/supabase";
import { useAuth } from "../lib/auth";

type Session = { id: string; title: string; topic: string | null; starts_at: string; status: string; chat_locked: boolean; host_id: string | null };
type Req = { id: number; user_id: string; topic: string | null; status: string; muted_by_host: boolean; profiles?: { full_name: string } | null };
type Line = { id: number; user_id: string; body: string; profiles?: { full_name: string } | null };
type Person = { id: string; name: string; role: "host" | "listener" };
type Float = { id: number; emoji: string; left: number };

// Same numbering the server uses for Agora, so we can tell who is speaking
const agoraUid = (userId: string) => parseInt(userId.replace(/-/g, "").slice(0, 8), 16) >>> 1;
const REACTIONS = ["❤️", "👏", "🙏", "🔥"];

export default function Live() {
  const { session: auth, profile, isStaff } = useAuth();
  const me = auth!.user.id;
  const myName = profile?.full_name || "Member";
  const [live, setLive] = useState<Session | null>(null);
  const [hostName, setHostName] = useState("BCIL Foundation");
  const [upcoming, setUpcoming] = useState<Session[]>([]);
  const [joined, setJoined] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [talking, setTalking] = useState<Set<number>>(new Set());
  const [requests, setRequests] = useState<Req[]>([]);
  const [chat, setChat] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [floats, setFloats] = useState<Float[]>([]);
  const [likes, setLikes] = useState(0);
  const [elapsed, setElapsed] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const client = useRef<IAgoraRTCClient | null>(null);
  const mic = useRef<IMicrophoneAudioTrack | null>(null);
  const room = useRef<RealtimeChannel | null>(null);
  const joining = useRef(false);
  const speakerRef = useRef(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  // ---------- sessions ----------
  useEffect(() => {
    supabase.from("live_sessions").select("*").neq("status", "ended").order("starts_at").then(({ data }) => {
      const list = (data ?? []) as Session[];
      setLive(list.find((s) => s.status === "live") ?? null);
      setUpcoming(list.filter((s) => s.status === "scheduled"));
    });
    const ch = supabase.channel("live-sessions")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_sessions" }, (p) => {
        const s = p.new as Session;
        if (s.status === "live") setLive(s);
        else if (s.status === "ended") { setLive((cur) => (cur?.id === s.id ? null : cur)); leave(); }
      }).subscribe();
    return () => { supabase.removeChannel(ch); leave(); };
  }, []);

  useEffect(() => {
    if (!live?.host_id) return;
    supabase.from("profiles").select("full_name").eq("id", live.host_id).single().then(({ data }) => data?.full_name && setHostName(data.full_name));
  }, [live?.host_id]);

  // elapsed timer since the scheduled start
  useEffect(() => {
    if (!live) return;
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - Date.parse(live.starts_at)) / 1000));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      setElapsed(`${h ? h + ":" : ""}${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`);
    };
    tick(); const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [live?.id, live?.starts_at]);

  // ---------- call-in queue + comments (database, real time) ----------
  useEffect(() => {
    if (!live) return;
    const loadReqs = () => supabase.from("call_requests").select("id, user_id, topic, status, muted_by_host, profiles(full_name)")
      .eq("session_id", live.id).in("status", ["waiting", "on_air"]).order("created_at")
      .then(({ data }) => setRequests((data ?? []) as unknown as Req[]));
    loadReqs();
    supabase.from("live_chat").select("id, user_id, body, profiles(full_name)").eq("session_id", live.id)
      .order("created_at").limit(100).then(({ data }) => setChat((data ?? []) as unknown as Line[]));
    const ch = supabase.channel(`live-db:${live.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_requests", filter: `session_id=eq.${live.id}` }, () => loadReqs())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_chat", filter: `session_id=eq.${live.id}` }, async (p) => {
        const l = p.new as Line;
        const { data } = await supabase.from("profiles").select("full_name").eq("id", l.user_id).single();
        setChat((cur) => (cur.some((x) => x.id === l.id) ? cur : [...cur.slice(-99), { ...l, profiles: data }]));
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [live?.id]);

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "end" }); }, [chat.length]);

  // ---------- presence (who is in the room) + reactions ----------
  useEffect(() => {
    if (!live || !joined) return;
    const ch = supabase.channel(`room:${live.id}`, { config: { presence: { key: me } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ name: string; role: "host" | "listener" }>();
      setPeople(Object.entries(state).map(([id, metas]) => ({ id, name: metas[0]?.name ?? "Member", role: metas[0]?.role ?? "listener" })));
    })
      .on("broadcast", { event: "react" }, ({ payload }) => { showFloat(payload.emoji); if (payload.emoji === "❤️") setLikes((n) => n + 1); })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await ch.track({ name: myName, role: isStaff ? "host" : "listener" });
      });
    room.current = ch;
    return () => { supabase.removeChannel(ch); room.current = null; setPeople([]); };
  }, [live?.id, joined]);

  function showFloat(emoji: string) {
    const f = { id: Date.now() + Math.random(), emoji, left: 10 + Math.random() * 70 };
    setFloats((cur) => [...cur.slice(-20), f]);
    setTimeout(() => setFloats((cur) => cur.filter((x) => x.id !== f.id)), 2200);
  }
  function react(emoji: string) {
    showFloat(emoji);
    if (emoji === "❤️") setLikes((n) => n + 1);
    room.current?.send({ type: "broadcast", event: "react", payload: { emoji } });
  }

  // ---------- audio (Agora) ----------
  const mine = requests.find((r) => r.user_id === me);
  useEffect(() => {
    if (!joined || isStaff) return;
    const shouldSpeak = mine?.status === "on_air";
    if (shouldSpeak !== speakerRef.current) { leave().then(() => join()); }
  }, [mine?.status]);

  // If the host mutes me, switch my microphone off; I can unmute myself only after the host allows it
  const wasHostMuted = useRef(false);
  useEffect(() => {
    if (!mic.current || mine?.status !== "on_air") return;
    if (mine.muted_by_host) { mic.current.setEnabled(false); setMuted(true); setNotice("The host has muted your microphone."); }
    else if (wasHostMuted.current) { setNotice("The host has unmuted you. Tap Unmute to speak."); }
    wasHostMuted.current = !!mine.muted_by_host;
  }, [mine?.muted_by_host, joined]);

  function explain(e: unknown) {
    const msg = String((e as { message?: string })?.message ?? e);
    if (/^Setup problem/.test(msg)) return msg;
    if (/NotAllowed|Permission|denied/i.test(msg)) return "Please allow microphone access for this site in your browser settings, then try again.";
    if (/NotFound|device/i.test(msg)) return "No microphone was found on this device.";
    if (/UID_CONFLICT/i.test(msg)) return "You are already in this session on another device. Leave there first.";
    if (/network|timeout|WS_ABORT|CAN_NOT_GET_GATEWAY/i.test(msg)) return "Connection problem. Check your internet and try again.";
    return "Could not join the live room: " + msg;
  }

  async function join() {
    if (!live || joining.current) return;
    joining.current = true; setBusy(true); setError("");
    try {
      const { data, error } = await supabase.functions.invoke("live-token", { body: { session_id: live.id } });
      if (error) {
        const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(detail?.error ?? error.message);
      }
      if (data?.error) throw new Error(data.error);
      const c = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
      client.current = c;
      c.on("user-published", async (user, type) => { await c.subscribe(user, type); if (type === "audio") user.audioTrack?.play(); });
      c.enableAudioVolumeIndicator();
      c.on("volume-indicator", (vols) => {
        const set = new Set<number>();
        for (const v of vols) if (v.level > 5) set.add(v.uid === 0 ? data.uid : Number(v.uid));
        setTalking(set);
      });
      await c.setClientRole(data.speaker ? "host" : "audience", data.speaker ? undefined : { level: 1 });
      await c.join(data.appId, data.channel, data.token, data.uid);
      if (data.speaker) {
        mic.current = await AgoraRTC.createMicrophoneAudioTrack();
        await c.publish(mic.current);
      }
      speakerRef.current = !!data.speaker;
      setSpeaker(!!data.speaker); setMuted(false); setJoined(true);
    } catch (e) {
      setError(explain(e));
      mic.current?.close(); mic.current = null;
      await client.current?.leave().catch(() => {}); client.current = null;
      setJoined(false);
    } finally {
      joining.current = false; setBusy(false);
    }
  }
  async function leave() {
    mic.current?.close(); mic.current = null;
    await client.current?.leave().catch(() => {}); client.current = null;
    speakerRef.current = false;
    setJoined(false); setSpeaker(false); setTalking(new Set());
  }
  async function toggleMute() {
    if (!mic.current) return;
    if (muted && mine?.muted_by_host) { setNotice("The host has muted you. Wait for the host to unmute you."); return; }
    await mic.current.setEnabled(muted);
    setMuted(!muted);
  }

  // ---------- actions (each one waits for the database and reports errors) ----------
  async function run(label: string, q: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await q;
    if (error) setError(`${label} did not work: ${error.message}`);
    return !error;
  }
  async function requestCall() {
    const topic = window.prompt("What would you like to say or ask? (optional)") ?? "";
    if (await run("Request to call in", supabase.from("call_requests").insert({ session_id: live!.id, user_id: me, topic: topic.trim() || null })))
      setNotice("Request sent. The host will bring you on when it's your turn.");
  }
  const setStatus = (id: number, status: string) => run("Updating the call", supabase.from("call_requests").update({ status }).eq("id", id));
  const hostMute = (id: number, value: boolean) => run(value ? "Muting" : "Unmuting", supabase.from("call_requests").update({ muted_by_host: value }).eq("id", id));
  const muteAll = () => run("Muting all callers", supabase.from("call_requests").update({ muted_by_host: true }).eq("session_id", live!.id).eq("status", "on_air"));
  const toggleLock = () => run("Locking chat", supabase.from("live_sessions").update({ chat_locked: !live!.chat_locked }).eq("id", live!.id))
    .then((ok) => ok && setLive((s) => (s ? { ...s, chat_locked: !s.chat_locked } : s)));
  const endSession = async () => {
    if (!window.confirm("End this live session for everyone?")) return;
    if (await run("Ending the session", supabase.from("live_sessions").update({ status: "ended" }).eq("id", live!.id))) { await leave(); setLive(null); }
  };
  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const body = text.trim(); setText("");
    await run(live?.chat_locked && !isStaff ? "Chat is locked by the host. Message" : "Sending", supabase.from("live_chat").insert({ session_id: live!.id, user_id: me, body }));
  }
  async function share() {
    const url = `${window.location.origin}${import.meta.env.BASE_URL}live`;
    const shareText = `Join "${live?.title}" live on BCIL Live`;
    try {
      if (navigator.share) await navigator.share({ title: "BCIL Live", text: shareText, url });
      else { await navigator.clipboard.writeText(`${shareText}: ${url}`); setNotice("Link copied. Paste it in WhatsApp."); }
    } catch { /* cancelled */ }
  }
  async function remind(s: Session) {
    if (await run("Reminder", supabase.from("live_reminders").upsert({ session_id: s.id, user_id: me }))) setNotice("We will remind you when it starts.");
  }

  // ---------- nothing live ----------
  if (!live) return (
    <section className="view">
      <h1>Live</h1>
      <div className="pod-empty">
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" />
        <div><b>Nothing is live right now</b><p className="muted">When BCIL goes live, it shows up here.</p></div>
      </div>
      <h2>Coming up</h2>
      <div className="list">
        {upcoming.length ? upcoming.map((s) => (
          <div key={s.id}><div className="grow"><b>{s.title}</b><br /><small className="muted">{new Date(s.starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></div>
            <button className="btn primary" onClick={() => remind(s)}>Remind me</button></div>
        )) : <div className="muted">No sessions scheduled yet.</div>}
      </div>
      {notice && <p className="ok">{notice}</p>}
    </section>
  );

  // ---------- the live room ----------
  const onStage = requests.filter((r) => r.status === "on_air");
  const waiting = requests.filter((r) => r.status === "waiting");
  const listeners = people.filter((p) => !onStage.some((r) => r.user_id === p.id) && p.role !== "host");
  const hostPeople = people.filter((p) => p.role === "host");
  const isTalking = (userId: string) => talking.has(agoraUid(userId));

  return (
    <section className="view pod">
      <div className="pod-cover">
        <img className="pod-art" src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" />
        <div className="grow">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="pill live">● LIVE</span><span className="pod-meta">{elapsed}</span>
            <span className="pod-meta">🎧 {Math.max(people.length, joined ? 1 : 0)} listening</span>
          </div>
          <h1 className="pod-title">{live.title}</h1>
          <p className="pod-host">Hosted by {hostName}{live.topic ? ` · ${live.topic}` : ""}</p>
        </div>
      </div>

      <div className="pod-stage card">
        <span className="eyebrow">On stage</span>
        <div className="pod-speakers">
          {(hostPeople.length ? hostPeople : [{ id: live.host_id ?? "host", name: hostName, role: "host" as const }]).map((h) => (
            <div key={h.id} className={`pod-spk${isTalking(h.id) ? " talking" : ""}`}>
              <div className="pod-ava big">{initials(h.name)}</div><b>{h.id === me ? "You" : h.name}</b><small>Host</small>
            </div>
          ))}
          {onStage.map((r) => (
            <div key={r.id} className={`pod-spk${isTalking(r.user_id) ? " talking" : ""}`}>
              <div className="pod-ava big caller">{initials(r.profiles?.full_name ?? "")}{r.muted_by_host && <span className="pod-muted" title="Muted by host">🔇</span>}</div>
              <b>{r.user_id === me ? "You" : r.profiles?.full_name}</b><small>{r.muted_by_host ? "Muted by host" : "Caller"}</small>
              {isStaff && <div className="row" style={{ gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                <button className="chip" onClick={() => hostMute(r.id, !r.muted_by_host)}>{r.muted_by_host ? "Unmute" : "Mute"}</button>
                <button className="chip" onClick={() => setStatus(r.id, "done")}>End call</button>
              </div>}
            </div>
          ))}
        </div>
        {listeners.length > 0 && <>
          <span className="eyebrow">Listening</span>
          <div className="pod-listeners">
            {listeners.slice(0, 18).map((p) => <div key={p.id} className="pod-ava" title={p.name}>{initials(p.name)}</div>)}
            {listeners.length > 18 && <div className="pod-ava more">+{listeners.length - 18}</div>}
          </div>
        </>}
        <div className="pod-floats" aria-hidden="true">{floats.map((f) => <span key={f.id} style={{ left: `${f.left}%` }}>{f.emoji}</span>)}</div>
      </div>

      {isStaff && joined && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}><h3>Call-in queue</h3><span className="pill soon">{waiting.length} waiting</span></div>
          <div className="list">
            {waiting.map((r) => (
              <div key={r.id}><div className="pod-ava">{initials(r.profiles?.full_name ?? "")}</div>
                <div className="grow"><b>{r.profiles?.full_name}</b><br /><small className="muted">{r.topic ?? "No topic"}</small></div>
                <button className="btn primary" onClick={() => setStatus(r.id, "on_air")}>Bring on</button>
                <button className="btn ghost" aria-label="Decline" onClick={() => setStatus(r.id, "declined")}>✕</button></div>
            ))}
            {!waiting.length && <div className="muted">No one is waiting. Listeners tap “Call in” to join the queue.</div>}
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {onStage.length > 0 && <button className="btn ghost" onClick={muteAll}>🔇 Mute all callers</button>}
            <button className="btn ghost" onClick={toggleLock}>{live.chat_locked ? "Unlock chat" : "Lock chat"}</button>
            <button className="btn ghost" style={{ color: "var(--live)" }} onClick={endSession}>End session</button>
          </div>
        </div>
      )}

      <div className="card pod-chat">
        <div className="row" style={{ justifyContent: "space-between" }}><h3>Comments</h3>{live.chat_locked && <span className="pill">Chat locked</span>}</div>
        <div className="pod-pinned">📌 Tap <b>Call in</b> to ask your question on air. Never send money to anyone in chat.</div>
        <div className="pod-lines">
          {chat.map((l) => <div className="pod-line" key={l.id}><span className="pod-ava sm">{initials(l.profiles?.full_name ?? "")}</span><div><b>{l.user_id === me ? "You" : l.profiles?.full_name}</b> {l.body}</div></div>)}
          <div ref={chatEnd} />
        </div>
        <form className="composer" onSubmit={sendChat}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={live.chat_locked && !isStaff ? "The host has locked the chat" : "Add a comment"} aria-label="Comment" disabled={live.chat_locked && !isStaff} />
          <button className="btn primary" disabled={live.chat_locked && !isStaff}>Send</button>
        </form>
      </div>

      {error && <p className="err" role="alert">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}

      <div className="pod-bar">
        {!joined ? (
          <button className="btn primary pod-join" onClick={join} disabled={busy}>{busy ? "Connecting…" : isStaff ? "▶ Start hosting" : "🎧 Listen live"}</button>
        ) : <>
          {REACTIONS.map((r) => <button key={r} className="pod-react" onClick={() => react(r)} aria-label={`React ${r}`}>{r}{r === "❤️" && likes > 0 ? <small>{likes}</small> : null}</button>)}
          <span className="sp" />
          {speaker ? (
            <button className={`btn ${muted ? "primary" : "ghost"}`} onClick={toggleMute} disabled={muted && !!mine?.muted_by_host}>{muted && mine?.muted_by_host ? "🔇 Muted by host" : muted ? "🎙 Unmute" : "Mute"}</button>
          ) : mine?.status === "waiting" ? (
            <button className="btn ghost" onClick={() => setStatus(mine.id, "cancelled")}>✋ #{waiting.findIndex((r) => r.user_id === me) + 1} · Cancel</button>
          ) : (
            <button className="btn primary" onClick={requestCall}>✋ Call in</button>
          )}
          {mine?.status === "on_air" && <button className="btn primary" onClick={() => setStatus(mine.id, "done")}>End call</button>}
          <button className="btn ghost" onClick={share} aria-label="Share">Share</button>
          <button className="btn ghost" onClick={leave}>Leave</button>
        </>}
      </div>
    </section>
  );
}
