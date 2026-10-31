import { useEffect, useRef, useState } from "react";
import { startLiveService, stopLiveService } from "../lib/native";
import { MixRecorder, uploadAudio } from "../lib/recorder";
import { useLocation, useNavigate } from "react-router-dom";
import AgoraRTC, { type IAgoraRTCClient, type IMicrophoneAudioTrack, type ICameraVideoTrack, type IRemoteVideoTrack, type IBufferSourceAudioTrack } from "agora-rtc-sdk-ng";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, initials } from "../lib/supabase";
import { useAuth } from "../lib/auth";

type Session = { id: string; title: string; topic: string | null; starts_at: string; status: string; chat_locked: boolean; host_id: string | null; recording?: boolean; kind?: string };
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
  const [remoteVideo, setRemoteVideo] = useState<Record<string, IRemoteVideoTrack>>({});
  const [camOn, setCamOn] = useState(false);
  const [newKind, setNewKind] = useState<"audio" | "video">("audio");
  const [musicName, setMusicName] = useState("");
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicVol, setMusicVol] = useState(35);
  const [musicLoop, setMusicLoop] = useState(true);
  const [musicBusy, setMusicBusy] = useState(false);
  const [requests, setRequests] = useState<Req[]>([]);
  const [chat, setChat] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [floats, setFloats] = useState<Float[]>([]);
  const [likes, setLikes] = useState(0);
  const [elapsed, setElapsed] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [recordNew, setRecordNew] = useState(true);
  const [recording, setRecording] = useState(false);
  const [savingRec, setSavingRec] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const autostart = useRef(Boolean((location.state as { autostart?: boolean } | null)?.autostart));
  const client = useRef<IAgoraRTCClient | null>(null);
  const mic = useRef<IMicrophoneAudioTrack | null>(null);
  const cam = useRef<ICameraVideoTrack | null>(null);
  const music = useRef<IBufferSourceAudioTrack | null>(null);
  const room = useRef<RealtimeChannel | null>(null);
  const joining = useRef(false);
  const speakerRef = useRef(false);
  const stayIn = useRef(false);          // true while the person wants to be in the room (drives auto-reconnect)
  const reconnecting = useRef(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const recRef = useRef<MixRecorder | null>(null);      // host-side recording of the whole room
  const liveRef = useRef<Session | null>(null);

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
        if (s.status === "live") setLive((cur) => (cur && cur.id === s.id ? { ...cur, ...s } : s));
        else if (s.status === "ended") { setLive((cur) => (cur?.id === s.id ? null : cur)); leave(); }
      }).subscribe();
    return () => { supabase.removeChannel(ch); leave(); };
  }, []);

  useEffect(() => { liveRef.current = live; }, [live]);

  useEffect(() => {
    if (!live?.host_id) return;
    supabase.from("profiles").select("full_name").eq("id", live.host_id).single().then(({ data }) => data?.full_name && setHostName(data.full_name));
  }, [live?.host_id]);

  // Arriving from Admin "Go live": start hosting straight away
  useEffect(() => {
    if (autostart.current && live && isStaff && !joined) {
      autostart.current = false;
      navigate(".", { replace: true, state: null });
      join(live);
    }
  }, [live?.id, isStaff]);

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

  // Every listener's app silences callers the host has muted, so a muted caller is never heard
  const silenced = useRef<Set<number>>(new Set());
  const silencedKey = requests.filter((r) => r.muted_by_host || r.status !== "on_air").map((r) => r.user_id).sort().join(",");
  useEffect(() => {
    silenced.current = new Set(requests.filter((r) => r.muted_by_host || r.status !== "on_air").map((r) => agoraUid(r.user_id)));
    for (const u of client.current?.remoteUsers ?? []) {
      if (!u.audioTrack) continue;
      if (silenced.current.has(Number(u.uid))) { u.audioTrack.stop(); recRef.current?.remove(String(u.uid)); }
      else { if (!u.audioTrack.isPlaying) u.audioTrack.play(); recRef.current?.add(String(u.uid), u.audioTrack.getMediaStreamTrack()); }
    }
  }, [silencedKey, joined]);

  // If the host mutes me, switch my microphone off; I can unmute myself only after the host allows it
  const wasHostMuted = useRef(false);
  useEffect(() => {
    if (!mic.current || mine?.status !== "on_air") return;
    if (mine.muted_by_host) { mic.current.setEnabled(false).catch(() => {}); setMuted(true); setNotice("The host has muted your microphone."); }
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

  async function join(target?: Session) {
    const sess = target ?? live;
    if (!sess || joining.current) return;
    joining.current = true; setBusy(true); setError("");
    try {
      const { data, error } = await supabase.functions.invoke("live-token", { body: { session_id: sess.id } });
      if (error) {
        const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(detail?.error ?? error.message);
      }
      if (data?.error) throw new Error(data.error);
      const c = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
      // if the connection drops (phone slept, network switched), get back in automatically
      c.on("connection-state-change", (cur) => { if (cur === "DISCONNECTED" && stayIn.current) reconnectRef.current(); });
      client.current = c;
      c.on("user-published", async (user, type) => {
        await c.subscribe(user, type);
        if (type === "video" && user.videoTrack) setRemoteVideo((v) => ({ ...v, [String(user.uid)]: user.videoTrack! }));
        if (type === "audio" && !silenced.current.has(Number(user.uid))) {
          user.audioTrack?.play();
          recRef.current?.add(String(user.uid), user.audioTrack?.getMediaStreamTrack());
        }
      });
      c.on("user-unpublished", (user, type) => {
        if (type === "audio") recRef.current?.remove(String(user.uid));
        if (type === "video") setRemoteVideo((v) => { const n = { ...v }; delete n[String(user.uid)]; return n; });
      });
      c.on("user-left", (user) => setRemoteVideo((v) => { const n = { ...v }; delete n[String(user.uid)]; return n; }));
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
        // video sessions: speakers also turn on their camera (they can switch it off)
        if (sess.kind === "video") {
          try {
            cam.current = await AgoraRTC.createCameraVideoTrack({ encoderConfig: "480p_1", facingMode: "user" });
            await c.publish(cam.current); setCamOn(true);
          } catch { setNotice("Camera not available. You're on audio only; check camera permission to turn it on."); }
        }
        // after a reconnect, keep recording with the new microphone
        if (recRef.current) { recRef.current.remove("me"); recRef.current.add("me", mic.current.getMediaStreamTrack()); }
      }
      speakerRef.current = !!data.speaker;
      stayIn.current = true;
      startLiveService(sess.title, !!data.speaker);
      mic.current?.on("track-ended", () => { if (stayIn.current) reconnectRef.current(); });
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
    stayIn.current = false;
    if (!reconnecting.current) stopLiveService();
    mic.current?.close(); mic.current = null;
    cam.current?.close(); cam.current = null; setCamOn(false); setRemoteVideo({});
    if (music.current) { music.current.stopProcessAudioBuffer(); music.current.close(); music.current = null; setMusicName(""); setMusicPlaying(false); }
    await client.current?.leave().catch(() => {}); client.current = null;
    speakerRef.current = false;
    setJoined(false); setSpeaker(false); setTalking(new Set());
  }
  // Reconnect after the phone sleeps or the app is switched away (browsers pause the microphone then)
  async function reconnect() {
    if (reconnecting.current || !live) return;
    reconnecting.current = true;
    try {
      setNotice("Reconnecting…");
      await leave();
      await join(live);
      setNotice("You're back in the room.");
    } finally { reconnecting.current = false; }
  }
  const reconnectRef = useRef(reconnect);
  reconnectRef.current = reconnect;

  useEffect(() => {
    if (!joined) return;
    let lock: { release: () => Promise<void> } | null = null;
    const wake = async () => {
      try { lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* not supported */ }
    };
    wake(); // keep the screen on while in a live session, so the phone does not sleep and cut the audio
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      wake();
      const c = client.current;
      const micDead = mic.current && mic.current.getMediaStreamTrack().readyState === "ended";
      if (stayIn.current && (!c || c.connectionState !== "CONNECTED" || micDead)) reconnectRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    // lock-screen card ("BCIL Live") so the phone treats this like a podcast that is playing
    if ("mediaSession" in navigator && live) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: live.title, artist: "BCIL Live",
        artwork: [{ src: `${import.meta.env.BASE_URL}icon-512.png`, sizes: "512x512", type: "image/png" }] });
    }
    // warn the host before closing the page by accident
    const onUnload = (e: BeforeUnloadEvent) => { if (speakerRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("beforeunload", onUnload);
      lock?.release().catch(() => {});
    };
  }, [joined, live?.id]);

  // ---------- background music: the host plays an audio file into the room ----------
  async function startMusic(file?: File) {
    const c = client.current;
    if (!file || !c) return;
    setMusicBusy(true);
    try {
      await stopMusic();
      const t = await AgoraRTC.createBufferSourceAudioTrack({ source: file });
      t.setVolume(musicVol);
      t.startProcessAudioBuffer({ loop: musicLoop });
      t.play();                       // the host hears it too
      await c.publish(t);
      music.current = t;
      recRef.current?.add("music", t.getMediaStreamTrack());
      t.on("source-state-change", (st) => { if (st === "stopped") setMusicPlaying(false); });
      setMusicName(file.name.replace(/\.[^.]+$/, "")); setMusicPlaying(true);
    } catch { setError("Could not play that file. Try an MP3 or M4A audio file."); }
    finally { setMusicBusy(false); }
  }
  function pauseMusic() {
    const t = music.current; if (!t) return;
    if (musicPlaying) t.pauseProcessAudioBuffer(); else if (t.currentState === "stopped") t.startProcessAudioBuffer({ loop: musicLoop }); else t.resumeProcessAudioBuffer();
    setMusicPlaying(!musicPlaying);
  }
  async function stopMusic() {
    const t = music.current; if (!t) return;
    music.current = null;
    recRef.current?.remove("music");
    await client.current?.unpublish(t).catch(() => {});
    t.stopProcessAudioBuffer(); t.close();
    setMusicName(""); setMusicPlaying(false);
  }
  function setVolume(v: number) { setMusicVol(v); music.current?.setVolume(v); }

  async function toggleCam() {
    const c = client.current;
    if (!c) return;
    if (!cam.current) {
      try { cam.current = await AgoraRTC.createCameraVideoTrack({ encoderConfig: "480p_1", facingMode: "user" }); await c.publish(cam.current); setCamOn(true); }
      catch { setError("Could not turn on the camera. Allow camera access for this site."); }
      return;
    }
    await cam.current.setEnabled(!camOn); setCamOn(!camOn);
  }
  async function flipCam() {
    if (!cam.current) return;
    const cams = await AgoraRTC.getCameras().catch(() => []);
    if (cams.length < 2) return;
    const cur = cam.current.getTrackLabel();
    const next = cams.find((d) => d.label !== cur) ?? cams[0];
    await cam.current.setDevice(next.deviceId).catch(() => {});
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
  // ---------- recording (on the host's device; saved to the Library when it stops) ----------
  async function startRecording() {
    if (!mic.current || !client.current || recRef.current) return;
    if (typeof MediaRecorder === "undefined") { setError("This browser can't record. Try Chrome, or update your phone."); return; }
    const r = new MixRecorder();
    r.add("me", mic.current.getMediaStreamTrack());
    if (music.current) r.add("music", music.current.getMediaStreamTrack());
    for (const u of client.current.remoteUsers) {
      if (u.audioTrack && !silenced.current.has(Number(u.uid))) r.add(String(u.uid), u.audioTrack.getMediaStreamTrack());
    }
    r.start();
    recRef.current = r; setRecording(true);
    if (liveRef.current) await supabase.from("live_sessions").update({ recording: true }).eq("id", liveRef.current.id);
    setNotice("Recording. Everyone sees a ● REC badge. It will be saved as a draft in the Library when you stop or end the session.");
  }
  async function saveRecording() {
    const r = recRef.current, sess = liveRef.current;
    if (!r) return;
    recRef.current = null; setRecording(false); setSavingRec(true);
    setNotice("Saving the recording to the Library… keep this page open.");
    try {
      const seconds = Math.round((Date.now() - r.startedAt) / 1000);
      const blob = await r.stop();
      if (seconds < 5 || blob.size < 2000) { setNotice("The recording was too short to save."); return; }
      const url = await uploadAudio(me, blob, sess?.title ?? "live-session");
      await supabase.from("talks").insert({
        kind: "audio", audio_url: url, title: sess?.title ?? "BCIL Live session", program: "Live sessions",
        description: sess?.topic ?? null, published_on: new Date().toISOString().slice(0, 10), duration_seconds: seconds,
        live_session_id: sess?.id ?? null, created_by: me, status: "draft",
      });
      if (sess) await supabase.from("live_sessions").update({ recording: false, recording_url: url }).eq("id", sess.id);
      setNotice("Recording saved as a draft. Open the Library → Drafts to trim, edit and publish it.");
    } catch (e) {
      setError("The recording could not be saved: " + ((e as Error).message ?? "unknown error"));
    } finally { setSavingRec(false); }
  }
  // if the host leaves the Live page while recording, save what was recorded
  useEffect(() => () => { if (recRef.current) saveRecording(); }, []);

  const endSession = async () => {
    if (!window.confirm("End this live session for everyone?")) return;
    if (recRef.current) await saveRecording();
    if (await run("Ending the session", supabase.from("live_sessions").update({ status: "ended", recording: false }).eq("id", live!.id))) { await leave(); setLive(null); }
  };
  async function leaveRoom() {
    if (recRef.current) {
      if (!window.confirm("You are recording. Stop the recording and save it to the Library, then leave?")) return;
      await saveRecording();
    }
    await leave();
  }
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
  async function goLiveNow(e?: React.FormEvent) {
    e?.preventDefault();
    const title = newTitle.trim() || `BCIL Live · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
    const { data, error } = await supabase.from("live_sessions")
      .insert({ title, topic: newTopic.trim() || null, starts_at: new Date().toISOString(), status: "live", host_id: me, kind: newKind })
      .select("*").single();
    if (error || !data) { setError("Could not go live: " + (error?.message ?? "unknown error")); return; }
    setLive(data as Session); setNewTitle(""); setNewTopic("");
    liveRef.current = data as Session;
    await join(data as Session);
    if (recordNew) await startRecording();
  }
  async function startScheduled(s: Session) {
    const { data, error } = await supabase.from("live_sessions")
      .update({ status: "live", starts_at: new Date().toISOString(), host_id: me }).eq("id", s.id).select("*").single();
    if (error || !data) { setError("Could not go live: " + (error?.message ?? "unknown error")); return; }
    setLive(data as Session); setUpcoming((u) => u.filter((x) => x.id !== s.id));
    await join(data as Session);
  }
  async function remind(s: Session) {
    if (await run("Reminder", supabase.from("live_reminders").upsert({ session_id: s.id, user_id: me }))) setNotice("We will remind you when it starts.");
  }

  // ---------- nothing live ----------
  if (!live) return (
    <section className="view">
      <h1>Live</h1>
      {isStaff ? (
        <form className="pod-golive" onSubmit={goLiveNow}>
          <div className="row"><img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" /><div><b>Start a live session</b><p>Go live now. Everyone with the app can listen and call in.</p></div></div>
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title, e.g. Mentorship hour: planning your semester" aria-label="Session title" />
          <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="Topic (optional)" aria-label="Topic" />
          <div className="kindpick" role="radiogroup" aria-label="Session type">
            <button type="button" role="radio" aria-checked={newKind === "audio"} className={newKind === "audio" ? "on" : ""} onClick={() => setNewKind("audio")}>🎙 Audio<small>Like a podcast</small></button>
            <button type="button" role="radio" aria-checked={newKind === "video"} className={newKind === "video" ? "on" : ""} onClick={() => setNewKind("video")}>🎥 Video<small>Like Zoom</small></button>
          </div>
          <label className="pod-recopt"><input type="checkbox" checked={recordNew} onChange={(e) => setRecordNew(e.target.checked)} /> Record this session (saved as a draft in the Library{newKind === "video" ? "; audio only" : ""})</label>
          <button className="btn pod-golive-btn" disabled={busy}>{busy ? "Starting…" : "● Go live now"}</button>
        </form>
      ) : (
        <div className="pod-empty">
          <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" />
          <div><b>Nothing is live right now</b><p className="muted">When BCIL goes live, it shows up here.</p></div>
        </div>
      )}
      {error && <p className="err" role="alert">{error}</p>}
      <h2>Coming up</h2>
      <div className="list">
        {upcoming.length ? upcoming.map((s) => (
          <div key={s.id}><div className="grow"><b>{s.title}</b><br /><small className="muted">{new Date(s.starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></div>
            {isStaff ? <button className="btn primary" onClick={() => startScheduled(s)}>● Go live</button>
              : <button className="btn primary" onClick={() => remind(s)}>Remind me</button>}</div>
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
            <span className="pill live">● LIVE</span>{live.kind === "video" && <span className="pill soon">🎥 Video</span>}{(recording || live.recording) && <span className="pill rec" title="This session is being recorded">● REC</span>}<span className="pod-meta">{elapsed}</span>
            <span className="pod-meta">🎧 {Math.max(people.length, joined ? 1 : 0)} listening</span>
          </div>
          <h1 className="pod-title">{live.title}</h1>
          <p className="pod-host">Hosted by {hostName}{live.topic ? ` · ${live.topic}` : ""}</p>
        </div>
      </div>

      <div className="pod-stage card">
        <span className="eyebrow">On stage</span>
        {live.kind === "video" ? (
          <div className={`vgrid n${Math.min(onStage.length + 1, 4)}`}>
            {(hostPeople.length ? hostPeople : [{ id: live.host_id ?? "host", name: hostName, role: "host" as const }]).map((h) => (
              <VideoTile key={h.id} name={h.id === me ? "You" : h.name} label="Host" talking={isTalking(h.id)}
                track={h.id === me ? (camOn ? cam.current : null) : remoteVideo[String(agoraUid(h.id))] ?? null} mirror={h.id === me} />
            ))}
            {onStage.map((r) => (
              <VideoTile key={r.id} name={r.user_id === me ? "You" : r.profiles?.full_name ?? "Caller"} label={r.muted_by_host ? "Muted by host" : "Caller"}
                talking={isTalking(r.user_id)} muted={r.muted_by_host}
                track={r.user_id === me ? (camOn ? cam.current : null) : remoteVideo[String(agoraUid(r.user_id))] ?? null} mirror={r.user_id === me}>
                {isStaff && <div className="vctl">
                  <button className="chip" onClick={() => hostMute(r.id, !r.muted_by_host)}>{r.muted_by_host ? "Unmute" : "Mute"}</button>
                  <button className="chip" onClick={() => setStatus(r.id, "done")}>End call</button>
                </div>}
              </VideoTile>
            ))}
          </div>
        ) : (
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
        )}
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
            {speaker && (recording
              ? <button className="btn ghost" onClick={saveRecording} disabled={savingRec}>■ Stop &amp; save recording</button>
              : <button className="btn ghost" onClick={startRecording} disabled={savingRec}>{savingRec ? "Saving recording…" : "● Record"}</button>)}
            <button className="btn ghost" onClick={toggleLock}>{live.chat_locked ? "Unlock chat" : "Lock chat"}</button>
            <button className="btn ghost" style={{ color: "var(--live)" }} onClick={endSession}>End session</button>
          </div>
        </div>
      )}

      {isStaff && joined && speaker && (
        <div className="card musiccard">
          <div className="row" style={{ justifyContent: "space-between" }}><h3>🎵 Background music</h3>{musicName && <span className={`pill ${musicPlaying ? "live" : ""}`}>{musicPlaying ? "Playing" : "Paused"}</span>}</div>
          <p className="muted">Play a song, jingle or intro from your phone into the room. Everyone hears it with your voice. Headphones stop it echoing into your microphone.</p>
          {musicName ? <>
            <div className="row" style={{ gap: 10 }}><b className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{musicName}</b>
              <button className="btn ghost" onClick={pauseMusic} aria-label={musicPlaying ? "Pause music" : "Play music"}>{musicPlaying ? "Pause" : "Play"}</button>
              <button className="btn ghost" onClick={stopMusic}>Stop</button></div>
            <label className="field">Volume {musicVol}%<input type="range" min={0} max={100} value={musicVol} onChange={(e) => setVolume(Number(e.target.value))} /></label>
          </> : null}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <label className="btn primary filebtn">{musicBusy ? "Loading…" : musicName ? "Choose another song" : "Choose a song"}
              <input type="file" accept="audio/*" onChange={(e) => { startMusic(e.target.files?.[0]); e.target.value = ""; }} hidden /></label>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={musicLoop} onChange={(e) => setMusicLoop(e.target.checked)} style={{ width: 18, height: 18 }} /> Repeat</label>
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
          <button className="btn primary pod-join" onClick={() => join()} disabled={busy}>{busy ? "Connecting…" : isStaff ? "▶ Start hosting" : "🎧 Listen live"}</button>
        ) : <>
          {REACTIONS.map((r) => <button key={r} className="pod-react" onClick={() => react(r)} aria-label={`React ${r}`}>{r}{r === "❤️" && likes > 0 ? <small>{likes}</small> : null}</button>)}
          <span className="sp" />
          {speaker && live.kind === "video" && <>
            <button className={`btn ${camOn ? "ghost" : "primary"}`} onClick={toggleCam} aria-label={camOn ? "Turn camera off" : "Turn camera on"}>{camOn ? "📷 Camera off" : "📷 Camera on"}</button>
            {camOn && <button className="btn ghost" onClick={flipCam} aria-label="Switch camera">🔄</button>}
          </>}
          {speaker ? (
            <button className={`btn ${muted ? "primary" : "ghost"}`} onClick={toggleMute} disabled={muted && !!mine?.muted_by_host}>{muted && mine?.muted_by_host ? "🔇 Muted by host" : muted ? "🎙 Unmute" : "Mute"}</button>
          ) : mine?.status === "waiting" ? (
            <button className="btn ghost" onClick={() => setStatus(mine.id, "cancelled")}>✋ #{waiting.findIndex((r) => r.user_id === me) + 1} · Cancel</button>
          ) : (
            <button className="btn primary" onClick={requestCall}>✋ Call in</button>
          )}
          {mine?.status === "on_air" && <button className="btn primary" onClick={() => setStatus(mine.id, "done")}>End call</button>}
          <button className="btn ghost" onClick={share} aria-label="Share">Share</button>
          <button className="btn ghost" onClick={leaveRoom}>Leave</button>
        </>}
      </div>
    </section>
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
      {!track && <div className="vnocam"><div className="pod-ava big">{initials(name === "You" ? "Me" : name)}</div></div>}
      <div className="vname">{muted ? "🔇 " : ""}{name} · <small>{label}</small></div>
      {children}
    </div>
  );
}
