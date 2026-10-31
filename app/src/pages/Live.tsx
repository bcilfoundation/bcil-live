import { useEffect, useRef, useState } from "react";
import AgoraRTC, { type IAgoraRTCClient, type IMicrophoneAudioTrack } from "agora-rtc-sdk-ng";
import { supabase, initials } from "../lib/supabase";
import { useAuth } from "../lib/auth";

type Session = { id: string; title: string; topic: string | null; starts_at: string; status: string; chat_locked: boolean };
type Req = { id: number; user_id: string; topic: string | null; status: string; profiles?: { full_name: string } | null };
type Line = { id: number; user_id: string; body: string; profiles?: { full_name: string } | null };

export default function Live() {
  const { session: auth, isStaff } = useAuth();
  const me = auth!.user.id;
  const [live, setLive] = useState<Session | null>(null);
  const [upcoming, setUpcoming] = useState<Session[]>([]);
  const [joined, setJoined] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [muted, setMuted] = useState(false);
  const [listeners, setListeners] = useState(0);
  const [requests, setRequests] = useState<Req[]>([]);
  const [chat, setChat] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const client = useRef<IAgoraRTCClient | null>(null);
  const mic = useRef<IMicrophoneAudioTrack | null>(null);

  useEffect(() => {
    supabase.from("live_sessions").select("*").neq("status", "ended").order("starts_at").then(({ data }) => {
      const list = (data ?? []) as Session[];
      setLive(list.find((s) => s.status === "live") ?? null);
      setUpcoming(list.filter((s) => s.status === "scheduled"));
    });
    const ch = supabase.channel("live-sessions")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_sessions" }, (p) => {
        const s = p.new as Session;
        if (s.status === "live") setLive(s); else if (s.status === "ended") { setLive(null); leave(); }
      }).subscribe();
    return () => { supabase.removeChannel(ch); leave(); };
  }, []);

  // call-in queue and live chat for the current session, updated in real time
  useEffect(() => {
    if (!live) return;
    const loadReqs = () => supabase.from("call_requests").select("id, user_id, topic, status, profiles(full_name)")
      .eq("session_id", live.id).in("status", ["waiting", "on_air"]).order("created_at")
      .then(({ data }) => setRequests((data ?? []) as unknown as Req[]));
    loadReqs();
    supabase.from("live_chat").select("id, user_id, body, profiles(full_name)").eq("session_id", live.id)
      .order("created_at").limit(100).then(({ data }) => setChat((data ?? []) as unknown as Line[]));
    const ch = supabase.channel(`live:${live.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_requests", filter: `session_id=eq.${live.id}` }, () => loadReqs())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_chat", filter: `session_id=eq.${live.id}` }, async (p) => {
        const l = p.new as Line;
        const { data } = await supabase.from("profiles").select("full_name").eq("id", l.user_id).single();
        setChat((cur) => [...cur.slice(-99), { ...l, profiles: data }]);
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [live?.id]);

  const mine = requests.find((r) => r.user_id === me);
  const [busy, setBusy] = useState(false);
  const joining = useRef(false);
  const speakerRef = useRef(false);

  // When the host brings me on air (or ends my call), reconnect with the right role — once.
  useEffect(() => {
    if (!joined || isStaff) return;
    const shouldSpeak = mine?.status === "on_air";
    if (shouldSpeak !== speakerRef.current) { leave().then(() => join()); }
  }, [mine?.status]);

  function explain(e: unknown) {
    const msg = String((e as { message?: string })?.message ?? e);
    if (/NotAllowed|Permission|denied/i.test(msg)) return "Please allow microphone access for this site in your browser settings, then try again.";
    if (/NotFound|device/i.test(msg)) return "No microphone was found on this device.";
    if (/UID_CONFLICT/i.test(msg)) return "You are already in this session on another device. Leave there first.";
    if (/network|timeout|WS_ABORT|CAN_NOT_GET_GATEWAY/i.test(msg)) return "Connection problem. Check your internet and try again.";
    if (/^Setup problem/.test(msg)) return msg;
    return "Could not join the live room: " + msg;
  }

  async function join() {
    if (!live || joining.current) return;
    joining.current = true; setBusy(true); setError("");
    try {
      const { data, error } = await supabase.functions.invoke("live-token", { body: { session_id: live.id } });
      if (error) {
        // the function explains what went wrong in its response body
        const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(detail?.error ?? error.message);
      }
      if (data?.error) throw new Error(data.error);
      const c = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
      client.current = c;
      c.on("user-published", async (user, type) => { await c.subscribe(user, type); if (type === "audio") user.audioTrack?.play(); });
      c.on("user-joined", () => setListeners((n) => n + 1));
      c.on("user-left", () => setListeners((n) => Math.max(0, n - 1)));
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
    setJoined(false); setSpeaker(false); setListeners(0);
  }

  async function requestCall() {
    const topic = window.prompt("What do you want to ask? (optional)") ?? "";
    const { error } = await supabase.from("call_requests").insert({ session_id: live!.id, user_id: me, topic: topic.trim() || null });
    if (error) setError("Could not send your request.");
  }
  const setStatus = (id: number, status: string) => supabase.from("call_requests").update({ status }).eq("id", id);
  async function toggleMute() { await mic.current?.setEnabled(muted); setMuted(!muted); }
  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const body = text.trim(); setText("");
    const { error } = await supabase.from("live_chat").insert({ session_id: live!.id, user_id: me, body });
    if (error) setError(live?.chat_locked ? "The host has locked the chat." : "Message not sent.");
  }
  async function remind(s: Session) {
    await supabase.from("live_reminders").upsert({ session_id: s.id, user_id: me });
    alert("We will remind you when it starts.");
  }

  if (!live) return (
    <section className="view">
      <h1>Live</h1><p className="muted">Nothing is live right now.</p>
      <h2>Upcoming</h2>
      <div className="list">
        {upcoming.length ? upcoming.map((s) => (
          <div key={s.id}><div className="grow"><b>{s.title}</b><br /><small className="muted">{new Date(s.starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></div>
            <button className="btn primary" onClick={() => remind(s)}>Remind me</button></div>
        )) : <div className="muted">No sessions scheduled yet.</div>}
      </div>
    </section>
  );

  const onStage = requests.filter((r) => r.status === "on_air");
  const waiting = requests.filter((r) => r.status === "waiting");
  return (
    <section className="view">
      <div className="liveroom">
        <div className="stagecol">
          <div className="card stagecard">
            <div className="row"><span className="pill live">LIVE</span><span className="muted">{joined ? `${listeners + 1} in the room` : ""}</span></div>
            <h2>{live.title}</h2>
            {live.topic && <p className="muted">{live.topic}</p>}
            <div className="stage">
              {onStage.map((r) => (
                <div className="spk" key={r.id}><div className="sava">{initials(r.profiles?.full_name ?? "")}</div><b>{r.user_id === me ? "You" : r.profiles?.full_name}</b><small>Caller</small>
                  {isStaff && <button className="chip" onClick={() => setStatus(r.id, "done")}>End call</button>}</div>
              ))}
            </div>
            <div className="callbar">
              {!joined ? <button className="btn primary" onClick={join} disabled={busy}>{busy ? "Connecting…" : isStaff ? "Start hosting" : "Listen live"}</button>
                : speaker ? <>
                    <b className="grow" style={{ color: "var(--live)" }}>● {isStaff ? "You're live as host" : "You're on air"}</b>
                    <button className="btn ghost" onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
                    {mine && <button className="btn primary" onClick={() => setStatus(mine.id, "done")}>End call</button>}
                    {isStaff && <button className="btn ghost" onClick={leave}>Leave</button>}
                  </>
                : mine?.status === "waiting" ? <>
                    <span className="grow">You're #{waiting.findIndex((r) => r.user_id === me) + 1} in the call-in queue</span>
                    <button className="btn ghost" onClick={() => setStatus(mine.id, "cancelled")}>Cancel request</button>
                  </>
                : <><button className="btn primary" onClick={requestCall}>✋ Request to call in</button><button className="btn ghost" onClick={leave}>Leave</button></>}
            </div>
            {error && <p className="err" role="alert">{error}</p>}
          </div>
          {isStaff && (
            <div className="card">
              <h3>Call-in queue ({waiting.length})</h3>
              <div className="list">
                {waiting.map((r) => (
                  <div key={r.id}><div className="grow"><b>{r.profiles?.full_name}</b><br /><small className="muted">{r.topic ?? "No topic"}</small></div>
                    <button className="btn primary" onClick={() => setStatus(r.id, "on_air")}>Bring on</button>
                    <button className="btn ghost" onClick={() => setStatus(r.id, "declined")}>✕</button></div>
                ))}
                {!waiting.length && <div className="muted">No one is waiting.</div>}
              </div>
              <button className="btn ghost" onClick={() => supabase.from("live_sessions").update({ chat_locked: !live.chat_locked }).eq("id", live.id)}>
                {live.chat_locked ? "Unlock chat" : "Lock chat"}</button>
              <button className="btn ghost" onClick={() => supabase.from("live_sessions").update({ status: "ended" }).eq("id", live.id)}>End session</button>
            </div>
          )}
        </div>
        <div className="card chatcol">
          <h3>Live chat</h3>
          <div className="pinned">Tap “Request to call in” to ask your question on air. Never send money to anyone in chat.</div>
          <div className="lmsgs">{chat.map((l) => <div className="lmsg" key={l.id}><b>{l.user_id === me ? "You" : l.profiles?.full_name}</b> {l.body}</div>)}</div>
          <form className="composer" onSubmit={sendChat}><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something" aria-label="Chat message" /><button className="btn primary">Send</button></form>
        </div>
      </div>
    </section>
  );
}
