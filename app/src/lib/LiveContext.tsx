import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { startLiveService, stopLiveService } from "./native";
import { MixRecorder, uploadAudio } from "./recorder";
import type { IAgoraRTCClient, IMicrophoneAudioTrack, ICameraVideoTrack, IRemoteVideoTrack, IBufferSourceAudioTrack } from "agora-rtc-sdk-ng";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

// The live room runs here, at app level, so audio keeps playing while people move around the app.
export type Session = { id: string; title: string; topic: string | null; starts_at: string; status: string; chat_locked: boolean; host_id: string | null; recording?: boolean; kind?: string; background?: string | null; pinned_chat_id?: number | null };
export type Req = { id: number; user_id: string; topic: string | null; status: string; muted_by_host: boolean; profiles?: { full_name: string } | null };
export type Line = { id: number; user_id: string; body: string; kind?: string; created_at?: string; profiles?: { full_name: string } | null };
export type Person = { id: string; name: string; role: "host" | "listener" };
export type Float = { id: number; emoji: string; left: number };
export type Gift = { emoji: string; name: string };
export type GiftShow = Gift & { from: string; id?: number };

export const agoraUid = (userId: string) => parseInt(userId.replace(/-/g, "").slice(0, 8), 16) >>> 1;
export const REACTIONS = ["❤️", "👏", "🙏", "🔥"];
export const GIFTS: Gift[] = [{ emoji: "🌹", name: "Rose" }, { emoji: "⭐", name: "Star" }, { emoji: "🎁", name: "Gift" }, { emoji: "🏆", name: "Trophy" }, { emoji: "👑", name: "Crown" }];

// Agora is only downloaded when someone joins a live session (keeps the app light on mobile data)
let rtcPromise: Promise<typeof import("agora-rtc-sdk-ng").default> | null = null;
const rtc = () => (rtcPromise ??= import("agora-rtc-sdk-ng").then((m) => m.default));

function useLiveEngine() {
  const { session: auth, profile, isStaff } = useAuth();
  const me = auth!.user.id;
  const myName = profile?.full_name || "Member";
  const [live, setLive] = useState<Session | null>(null);
  const [joinedId, setJoinedId] = useState<string | null>(null);
  const [needTap, setNeedTap] = useState(false);
  const [giftShow, setGiftShow] = useState<(GiftShow & { id: number })[]>([]);
  const left = useRef<Set<string>>(new Set());          // sessions this person chose to leave
  const lastReconnect = useRef(0);
  const reconnectTries = useRef(0);

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
  const [canVideo, setCanVideo] = useState(false);   // video sessions: anyone may turn on their camera
  const [musicName, setMusicName] = useState("");
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicVol, setMusicVol] = useState(35);
  const [musicLoop, setMusicLoop] = useState(true);
  const [musicBusy, setMusicBusy] = useState(false);
  const [requests, setRequests] = useState<Req[]>([]);
  const [chat, setChat] = useState<Line[]>([]);
  const [floats, setFloats] = useState<Float[]>([]);
  const [likes, setLikes] = useState(0);
  const [elapsed, setElapsed] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recording, setRecording] = useState(false);
  const [savingRec, setSavingRec] = useState(false);
  const client = useRef<IAgoraRTCClient | null>(null);
  const mic = useRef<IMicrophoneAudioTrack | null>(null);
  const cam = useRef<ICameraVideoTrack | null>(null);
  const music = useRef<IBufferSourceAudioTrack | null>(null);
  const room = useRef<RealtimeChannel | null>(null);
  const joining = useRef(false);
  const speakerRef = useRef(false);
  const stayIn = useRef(false);          // true while the person wants to be in the room (drives auto-reconnect)
  const reconnecting = useRef(false);
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
    supabase.from("live_chat").select("id, user_id, body, kind, created_at, profiles(full_name)").eq("session_id", live.id)
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


  // ---------- presence (who is in the room) + reactions ----------
  useEffect(() => {
    if (!live || !joined) return;
    const ch = supabase.channel(`room:${live.id}`, { config: { presence: { key: me } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ name: string; role: "host" | "listener" }>();
      setPeople(Object.entries(state).map(([id, metas]) => ({ id, name: metas[0]?.name ?? "Member", role: metas[0]?.role ?? "listener" })));
    })
      .on("broadcast", { event: "react" }, ({ payload }) => { showFloat(payload.emoji); if (payload.emoji === "❤️") setLikes((n) => n + 1); })
      .on("broadcast", { event: "gift" }, ({ payload }) => showGift(payload as GiftShow))
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
  function showGift(g: GiftShow) {
    const item = { ...g, id: Date.now() + Math.random() };
    setGiftShow((cur) => [...cur.slice(-3), item]);
    setTimeout(() => setGiftShow((cur) => cur.filter((x) => x.id !== item.id)), 3500);
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

  async function join(target?: Session, attempt = 0): Promise<boolean> {
    const sess = target ?? live;
    if (!sess || joining.current) return false;
    if (client.current) await leave();   // never keep two connections (that caused "already in this session")
    joining.current = true; setBusy(true); setError("");
    try {
      const { data, error } = await supabase.functions.invoke("live-token", { body: { session_id: sess.id } });
      if (error) {
        const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(detail?.error ?? error.message);
      }
      if (data?.error) throw new Error(data.error);
      const c = (await rtc()).createClient({ mode: "live", codec: "vp8" });
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
        mic.current = await (await rtc()).createMicrophoneAudioTrack();
        await c.publish(mic.current);
        // video sessions: speakers also turn on their camera (they can switch it off)
        if (sess.kind === "video") {
          try {
            cam.current = await (await rtc()).createCameraVideoTrack({ encoderConfig: "480p_1", facingMode: "user" });
            await c.publish(cam.current); setCamOn(true);
          } catch { setNotice("Camera not available. You're on audio only; check camera permission to turn it on."); }
        }
        // after a reconnect, keep recording with the new microphone
        if (recRef.current) { recRef.current.remove("me"); recRef.current.add("me", mic.current.getMediaStreamTrack().clone()); }
      }
      speakerRef.current = !!data.speaker;
      setCanVideo(!!(data.canVideo ?? data.speaker));
      stayIn.current = true;
      startLiveService(sess.title, !!data.speaker);
      setSpeaker(!!data.speaker); setMuted(false); setJoined(true); setJoinedId(sess.id);
      reconnectTries.current = 0;
      return true;
    } catch (e) {
      mic.current?.close(); mic.current = null;
      await client.current?.leave().catch(() => {}); client.current = null;
      setJoined(false);
      // an old connection from this phone can linger for a few seconds; wait and try again
      if (/UID_CONFLICT/i.test(String((e as Error)?.message ?? e)) && attempt < 2) {
        joining.current = false;
        await new Promise((r) => setTimeout(r, 3000));
        return join(sess, attempt + 1);
      }
      setError(explain(e));
      return false;
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
    setJoined(false); setJoinedId(null); setSpeaker(false); setTalking(new Set()); setNeedTap(false);
  }
  // Reconnect after the phone sleeps or the app is switched away (browsers pause the microphone then)
  async function reconnect() {
    if (reconnecting.current || !liveRef.current) return;
    // at most one attempt every 8 seconds, and stop after 3 failed attempts in a row
    if (Date.now() - lastReconnect.current < 8000) return;
    if (reconnectTries.current >= 3) { setError("The connection keeps dropping. Check your internet, then tap Join again."); stayIn.current = false; return; }
    lastReconnect.current = Date.now(); reconnectTries.current++;
    reconnecting.current = true;
    try {
      setNotice("Reconnecting…");
      await leave();
      const ok = await join(liveRef.current ?? undefined);
      if (ok) setNotice("You're back in the room.");
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
      const t = await (await rtc()).createBufferSourceAudioTrack({ source: file });
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
    const guest = !speakerRef.current;   // in the audience, not on the mic
    if (!cam.current) {
      if (guest && !canVideo) { setError("Please leave and join the room again to turn on your camera."); return; }
      try {
        // listeners become video senders only (their microphone stays off unless the host brings them on air)
        if (guest) await c.setClientRole("host");
        cam.current = await (await rtc()).createCameraVideoTrack({ encoderConfig: guest ? "360p_1" : "480p_1", facingMode: "user" });
        await c.publish(cam.current); setCamOn(true);
      } catch (e) {
        cam.current?.close(); cam.current = null;
        if (guest) await c.setClientRole("audience", { level: 1 }).catch(() => {});
        setError(/NotAllowed|Permission|denied/i.test(String(e)) ? "Allow camera access for this app, then try again." : "Could not turn on the camera.");
      }
      return;
    }
    if (guest && camOn) {
      // a listener switching off: stop sending video completely
      const t = cam.current; cam.current = null; setCamOn(false);
      await c.unpublish(t).catch(() => {}); t.close();
      await c.setClientRole("audience", { level: 1 }).catch(() => {});
      return;
    }
    await cam.current.setEnabled(!camOn); setCamOn(!camOn);
  }
  async function flipCam() {
    if (!cam.current) return;
    const cams = await (await rtc()).getCameras().catch(() => []);
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
    let r: MixRecorder;
    try {
      r = new MixRecorder();
      // record a copy of the microphone, so recording can never interfere with the live audio
      r.add("me", mic.current.getMediaStreamTrack().clone());
      if (music.current) r.add("music", music.current.getMediaStreamTrack());
      for (const u of client.current.remoteUsers) {
        if (u.audioTrack && !silenced.current.has(Number(u.uid))) r.add(String(u.uid), u.audioTrack.getMediaStreamTrack());
      }
      r.start();
    } catch {
      setNotice("Recording isn't available on this phone, but you're live. Try recording from Chrome on a laptop or Android.");
      return;
    }
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
    if (liveRef.current) left.current.add(liveRef.current.id);   // don't rejoin automatically
    await leave();
  }
  async function sendChat(text: string, kind: "chat" | "question" = "chat") {
    const body = text.trim();
    if (!body || !live) return false;
    return run(live.chat_locked && !isStaff ? "Chat is locked by the host. Message" : "Sending",
      supabase.from("live_chat").insert({ session_id: live.id, user_id: me, body, kind }));
  }
  async function sendGift(gift: Gift) {
    if (!live) return;
    showGift({ ...gift, from: myName });
    room.current?.send({ type: "broadcast", event: "gift", payload: { ...gift, from: myName } });
    await supabase.from("live_chat").insert({ session_id: live.id, user_id: me, body: `sent ${gift.emoji} ${gift.name}`, kind: "gift" });
  }
  async function pinComment(id: number | null) {
    if (!live) return;
    if (await run("Pinning", supabase.from("live_sessions").update({ pinned_chat_id: id }).eq("id", live.id)))
      setLive((s) => (s ? { ...s, pinned_chat_id: id } : s));
  }
  async function setBackground(bg: string | null) {
    if (!live) return;
    if (await run("Changing the background", supabase.from("live_sessions").update({ background: bg }).eq("id", live.id)))
      setLive((s) => (s ? { ...s, background: bg } : s));
  }
  async function share() {
    const url = `${window.location.origin}${import.meta.env.BASE_URL}live`;
    const shareText = `Join "${live?.title}" live on BCIL Live`;
    try {
      if (navigator.share) await navigator.share({ title: "BCIL Live", text: shareText, url });
      else { await navigator.clipboard.writeText(`${shareText}: ${url}`); setNotice("Link copied. Paste it in WhatsApp."); }
    } catch { /* cancelled */ }
  }
  async function goLiveNow(opts: { title: string; topic: string; kind: "audio" | "video"; record: boolean }) {
    const title = opts.title.trim() || `BCIL Live · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
    const { data, error } = await supabase.from("live_sessions")
      .insert({ title, topic: opts.topic.trim() || null, starts_at: new Date().toISOString(), status: "live", host_id: me, kind: opts.kind })
      .select("*").single();
    if (error || !data) { setError("Could not go live: " + (error?.message ?? "unknown error")); return false; }
    setLive(data as Session);
    liveRef.current = data as Session;
    left.current.delete(data.id);
    const ok = await join(data as Session);
    if (ok && opts.record) await startRecording();
    return ok;
  }
  async function startScheduled(s: Session) {
    const { data, error } = await supabase.from("live_sessions")
      .update({ status: "live", starts_at: new Date().toISOString(), host_id: me }).eq("id", s.id).select("*").single();
    if (error || !data) { setError("Could not go live: " + (error?.message ?? "unknown error")); return; }
    setLive(data as Session); setUpcoming((u) => u.filter((x) => x.id !== s.id));
    left.current.delete(s.id);
    await join(data as Session);
  }
  async function remind(s: Session) {
    if (await run("Reminder", supabase.from("live_reminders").upsert({ session_id: s.id, user_id: me }))) setNotice("We will remind you when it starts.");
  }

  // Phones block sound until the person taps once; show "Tap to hear the room" when that happens
  useEffect(() => {
    if (!live) return;
    rtc().then((A) => { A.onAutoplayFailed = () => setNeedTap(true); });
  }, [live?.id]);
  function tapToHear() {
    for (const u of client.current?.remoteUsers ?? []) if (u.audioTrack && !silenced.current.has(Number(u.uid))) u.audioTrack.play();
    setNeedTap(false);
  }

  // Join automatically: listeners as soon as a session is live, and the host again when they come back to the app
  useEffect(() => {
    if (!live || live.status !== "live" || joined || joining.current || left.current.has(live.id)) return;
    const amHost = live.host_id === me;
    if (isStaff && !amHost) return;              // other admins choose to join (they would be on the microphone)
    join(live);
  }, [live?.id, live?.status, isStaff, joined]);

  const value = {
    me, myName, isStaff, live, setLive, hostName, upcoming, joined, joinedId, speaker, muted, busy, people, talking, remoteVideo, camOn,
    musicName, musicPlaying, musicVol, musicLoop, setMusicLoop, musicBusy, requests, chat, floats, likes, elapsed, error, setError, notice, setNotice,
    recording, savingRec, needTap, giftShow, mine, cam,
    join, leaveRoom, tapToHear, toggleMute, toggleCam, canVideo, flipCam, startMusic, pauseMusic, stopMusic, setVolume, react, sendGift, requestCall,
    setStatus, hostMute, muteAll, toggleLock, startRecording, saveRecording, endSession, sendChat, pinComment, setBackground, share,
    goLiveNow, startScheduled, remind,
  };
  return value;
}

export type LiveApi = ReturnType<typeof useLiveEngine>;
const Ctx = createContext<LiveApi | null>(null);
export function LiveProvider({ children }: { children: ReactNode }) {
  const value = useLiveEngine();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useLive = () => useContext(Ctx)!;
