import { useEffect, useRef, useState } from "react";
import Tick from "../components/Tick";
import ChatTabs from "../components/ChatTabs";
import Statuses from "../components/Statuses";
import EmojiPanel from "../components/EmojiPanel";
import ChatInfo from "../components/ChatInfo";
import WallpaperSheet from "../components/WallpaperSheet";
import { getWall, isDarkWall, wallStyle } from "../lib/wallpaper";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { initials, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import type { Group } from "./Groups";
import PersonSheet from "../components/PersonSheet";
import { shrink } from "../lib/media";
import { isNative } from "../lib/native";
import { useLive } from "../lib/LiveContext";

type Conv = { id: string; name: string; sub: string; avatar?: string | null; kind: "group" | "dm" | "announcements"; read_only: boolean; cover?: string | null; members?: number; otherId?: string; leader?: boolean;
  category?: string; at?: string | null; last?: { body: string | null; type: string | null; user: string | null; name: string | null } };
type ListRow = { room_id: string; kind: string; category: string | null; name: string | null; avatar: string | null; other_id: string | null;
  last_body: string | null; last_type: string | null; last_user: string | null; last_name: string | null; last_at: string | null; unread: number };
const byRecent = (a: Conv, b: Conv) => (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0);
type Msg = { id: number; user_id: string; body: string; created_at: string; reply_to?: number | null;
  edited_at?: string | null; deleted_at?: string | null; mentions?: string[] | null; mention_all?: boolean | null;
  attachment_url?: string | null; attachment_name?: string | null; attachment_type?: string | null; attachment_size?: number | null; profiles?: { full_name: string; avatar_url: string | null } | null };

export default function Chat() {
  const { session, profile, isStaff } = useAuth();
  const L = useLive();
  const canCall = isStaff || profile?.role === "mentor";   // staff and mentors can start calls in a direct message
  const [calling, setCalling] = useState(false);
  async function call(kind: "audio" | "video") {
    if (!room || calling) return;
    if (L.joined) { nav("/live"); return; }
    setCalling(true);
    // every call can use cameras: a voice call simply starts with the camera off and either person can turn it on
    const ok = await L.goLiveNow({ title: `Call with ${room.name}`, topic: "", kind: "video", record: false, cam: kind === "video", roomId: room.id, dm: true });
    setCalling(false);
    if (ok) nav("/live");
  }
  const me = session!.user.id;
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const roomId = params.get("room");
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "mentions">("all");
  const [tab, setTab] = useState<"dm" | "groups" | "requests" | null>(null);
  const [requests, setRequests] = useState<{ id: number; requester: string; name: string; avatar: string | null }[]>([]);
  const [mentionRooms, setMentionRooms] = useState<Set<string>>(new Set());
  const [showInfo, setShowInfo] = useState(false);
  const [showWall, setShowWall] = useState(false);
  const [wall, setWallState] = useState("none");
  const [findQ, setFindQ] = useState<string | null>(null);
  const [findIdx, setFindIdx] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [rec, setRec] = useState<{ start: number; secs: number } | null>(null);
  const recRef = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; cancel?: boolean; secs?: number } | null>(null);
  const openRoom = useRef<string | null>(roomId);
  openRoom.current = roomId;
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [online, setOnline] = useState(0);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [viewImg, setViewImg] = useState<string | null>(null);
  const [reacts, setReacts] = useState<Record<number, { emoji: string; user_id: string }[]>>({});
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);   // tapped message: shows Reply / React / Report
  // read receipts: when each other member last opened this conversation
  const [reads, setReads] = useState<Record<string, string>>({});
  async function react(m: Msg, emoji: string) {
    setPickFor(null);
    const mine = (reacts[m.id] ?? []).some((r) => r.user_id === me && r.emoji === emoji);
    setReacts((cur) => ({ ...cur, [m.id]: mine ? (cur[m.id] ?? []).filter((r) => !(r.user_id === me && r.emoji === emoji)) : [...(cur[m.id] ?? []), { emoji, user_id: me }] }));
    const r = mine ? await supabase.from("message_reactions").delete().eq("message_id", m.id).eq("user_id", me).eq("emoji", emoji)
      : await supabase.from("message_reactions").insert({ message_id: m.id, room_id: roomId, user_id: me, emoji });
    if (r.error && !/duplicate/i.test(r.error.message)) setError("Could not add the reaction. Try again.");
  }
  const pickFile = (f?: File | null) => {
    setError("");
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { setError("That file is over 20 MB. Please send a smaller one."); return; }
    setFile(f);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  };
  const clearFile = () => { if (preview) URL.revokeObjectURL(preview); setFile(null); setPreview(null); };
  const [person, setPerson] = useState<string | null>(null);
  // group members (for @mentions and "who read it"), editing, and message info
  const [members, setMembers] = useState<{ id: string; name: string; avatar: string | null; role: string }[]>([]);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [infoFor, setInfoFor] = useState<Msg | null>(null);
  const [tags, setTags] = useState<string[]>([]);          // people tagged in the message being written
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  const end = useRef<HTMLDivElement>(null);

  async function loadConvs() {
    const [{ data: gs }, { data: dms }, { data: un }] = await Promise.all([
      supabase.rpc("group_list"), supabase.rpc("my_dms"), supabase.rpc("my_unread")]);
    let groups = (gs ?? []) as Group[];
    // everyone is in the open community rooms (announcements, general chat) automatically
    const autoJoin = groups.filter((g) => !g.is_member && !g.is_private && g.category === "general");
    if (autoJoin.length) {
      await Promise.all(autoJoin.map((g) => supabase.from("room_members").upsert({ room_id: g.id, user_id: me }, { ignoreDuplicates: true })));
      groups = groups.map((g) => (autoJoin.includes(g) ? { ...g, is_member: true } : g));
    }
    const list: Conv[] = [
      ...groups.filter((g) => g.is_member).map((g) => ({ id: g.id, name: g.name, category: g.category, sub: g.kind === "announcements" ? "Announcements" : `${g.member_count} members`, kind: g.kind as Conv["kind"], read_only: g.read_only, cover: g.cover_url, members: g.member_count, leader: isStaff || g.my_role === "leader" })),
      ...((dms ?? []) as { room_id: string; other_id: string; other_name: string; other_avatar: string | null }[]).map((d) => ({ id: d.room_id, name: d.other_name || "Member", sub: "Direct message", avatar: d.other_avatar, kind: "dm" as const, read_only: false, otherId: d.other_id })),
    ];
    setUnread(Object.fromEntries(((un ?? []) as { room_id: string; n: number }[]).map((u) => [u.room_id, u.n])));
    setConvs(await withPreviews(list));
    // on a big screen, open the first conversation straight away
    const firstDm = list.find((c) => c.kind === "dm");
    if (!roomId && firstDm && window.matchMedia("(min-width: 761px)").matches) setParams({ room: firstDm.id }, { replace: true });
  }
  useEffect(() => { loadConvs(); loadRequests(); loadMentions(); }, []);
  async function loadRequests() {
    const { data } = await supabase.from("friendships").select("id, requester").eq("addressee", me).eq("status", "pending").limit(100);
    const rows = (data ?? []) as { id: number; requester: string }[];
    if (!rows.length) { setRequests([]); return; }
    const { data: ps } = await supabase.from("profiles").select("id, full_name, avatar_url").in("id", rows.map((r) => r.requester));
    const by = new Map(((ps ?? []) as { id: string; full_name: string; avatar_url: string | null }[]).map((p) => [p.id, p]));
    setRequests(rows.map((r) => ({ id: r.id, requester: r.requester, name: by.get(r.requester)?.full_name || "Member", avatar: by.get(r.requester)?.avatar_url ?? null })));
  }
  // conversations where someone tagged me or replied to me in the last two weeks
  async function loadMentions() {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const [{ data: tagged }, { data: mine }] = await Promise.all([
      supabase.from("messages").select("room_id").or(`mentions.cs.{${me}},mention_all.eq.true`).neq("user_id", me).gte("created_at", since).limit(300),
      supabase.from("messages").select("id").eq("user_id", me).gte("created_at", since).order("created_at", { ascending: false }).limit(300),
    ]);
    const set = new Set(((tagged ?? []) as { room_id: string }[]).map((r) => r.room_id));
    const ids = ((mine ?? []) as { id: number }[]).map((r) => r.id);
    if (ids.length) {
      const { data: rep } = await supabase.from("messages").select("room_id").in("reply_to", ids).neq("user_id", me).limit(300);
      ((rep ?? []) as { room_id: string }[]).forEach((r) => set.add(r.room_id));
    }
    setMentionRooms(set);
  }
  async function answerRequest(r: { id: number; requester: string }, ok: boolean) {
    const { error } = ok ? await supabase.from("friendships").update({ status: "accepted" }).eq("id", r.id) : await supabase.from("friendships").delete().eq("id", r.id);
    if (error) { setError(/row-level security/i.test(error.message) ? "This connection isn't allowed. Under-18 members can connect with BCIL staff and mentors only." : "That didn't work. Try again."); return; }
    setRequests((cur) => cur.filter((x) => x.id !== r.id));
    if (ok) { const { data } = await supabase.rpc("start_dm", { other: r.requester }); if (data) { await loadConvs(); setTab("dm"); setParams({ room: data as string }); } }
  }

  // last message, time and unread count for each conversation (newest first, like WhatsApp)
  async function withPreviews(list: Conv[]): Promise<Conv[]> {
    const { data, error } = await supabase.rpc("chat_list");
    if (error || !data) return [...list].sort((a, b) => (a.kind === "dm" ? 0 : 1) - (b.kind === "dm" ? 0 : 1));
    const rows = new Map((data as ListRow[]).map((r) => [r.room_id, r]));
    setUnread(Object.fromEntries((data as ListRow[]).map((r) => [r.room_id, r.room_id === openRoom.current ? 0 : r.unread])));
    return list.map((c) => {
      const r = rows.get(c.id);
      return r ? { ...c, at: r.last_at, last: { body: r.last_body, type: r.last_type, user: r.last_user, name: r.last_name } } : c;
    }).sort(byRecent);
  }
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();
  function refreshList() {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      const cur = convsRef.current;
      if (cur) setConvs(await withPreviews(cur));
    }, 500);
  }
  const convsRef = useRef<Conv[] | null>(null);
  convsRef.current = convs;

  const room = convs?.find((c) => c.id === roomId) ?? null;
  // a DM opened from a notification may be new: reload the list once
  useEffect(() => { if (roomId && convs && !room) loadConvs(); }, [roomId, !!convs]);

  async function markRead(id: string) {
    await supabase.from("room_members").update({ last_read_at: new Date().toISOString() }).eq("room_id", id).eq("user_id", me);
    setUnread((u) => ({ ...u, [id]: 0 }));
    window.dispatchEvent(new Event("bcil-read"));
  }

  useEffect(() => {
    if (!roomId) return;
    setMsgs([]); setError(""); setReplyTo(null); setFile(null); setPreview(null);
    supabase.from("messages").select("*, profiles!messages_user_id_fkey(full_name, avatar_url)")
      .eq("room_id", roomId).order("created_at", { ascending: false }).limit(200)
      .then(({ data }) => setMsgs(((data ?? []) as unknown as Msg[]).reverse()));
    markRead(roomId);
    setReacts({}); setPickFor(null); setReads({});
    supabase.from("room_members").select("user_id, last_read_at").eq("room_id", roomId).neq("user_id", me).limit(500)
      .then(({ data }) => setReads(Object.fromEntries(((data ?? []) as { user_id: string; last_read_at: string }[]).map((r) => [r.user_id, r.last_read_at]))));
    setMembers([]); setEditing(null); setTags([]); setMentionQ(null);
    supabase.from("room_members").select("user_id, role").eq("room_id", roomId).limit(1000).then(async ({ data }) => {
      const rows = (data ?? []) as { user_id: string; role: string }[];
      if (!rows.length) return;
      const { data: ps } = await supabase.from("profiles").select("id, full_name, avatar_url").in("id", rows.map((r) => r.user_id));
      const byId = new Map(((ps ?? []) as { id: string; full_name: string; avatar_url: string | null }[]).map((p) => [p.id, p]));
      setMembers(rows.map((r) => ({ id: r.user_id, role: r.role, name: byId.get(r.user_id)?.full_name || "Member", avatar: byId.get(r.user_id)?.avatar_url ?? null })));
    });
    supabase.from("message_reactions").select("message_id, emoji, user_id").eq("room_id", roomId).then(({ data }) => {
      const m: Record<number, { emoji: string; user_id: string }[]> = {};
      for (const r of (data ?? []) as { message_id: number; emoji: string; user_id: string }[]) (m[r.message_id] ??= []).push({ emoji: r.emoji, user_id: r.user_id });
      setReacts(m);
    });
    const ch = supabase.channel(`room:${roomId}`, { config: { presence: { key: me } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions", filter: `room_id=eq.${roomId}` }, (p) => {
        const n = (p.eventType === "DELETE" ? p.old : p.new) as { message_id: number; emoji: string; user_id: string };
        if (!n?.message_id || n.user_id === me) return;
        setReacts((cur) => {
          const list = (cur[n.message_id] ?? []).filter((r) => !(r.user_id === n.user_id && r.emoji === n.emoji));
          return { ...cur, [n.message_id]: p.eventType === "DELETE" ? list : [...list, { emoji: n.emoji, user_id: n.user_id }] };
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
        async (p) => {
          const m = p.new as Msg;
          const { data } = await supabase.from("profiles").select("full_name, avatar_url").eq("id", m.user_id).single();
          setMsgs((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, { ...m, profiles: data }]));
          markRead(roomId);
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` }, (p) => {
        const m = p.new as Msg;
        setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, ...m, profiles: x.profiles } : x)));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` }, (p) => {
        const r = p.new as { user_id: string; last_read_at: string };
        if (r.user_id && r.user_id !== me) setReads((cur) => ({ ...cur, [r.user_id]: r.last_read_at }));
      })
      .on("presence", { event: "sync" }, () => setOnline(Object.keys(ch.presenceState()).length))
      .subscribe((s) => { if (s === "SUBSCRIBED") ch.track({ name: profile?.full_name ?? "" }); });
    // keep unread counts on the list fresh for other rooms
    const all = supabase.channel(`rooms-list:${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
        const m = p.new as Msg & { room_id: string };
        if (m.room_id !== roomId && m.user_id !== me) setUnread((u) => ({ ...u, [m.room_id]: (u[m.room_id] ?? 0) + 1 }));
        if (convsRef.current && !convsRef.current.some((c) => c.id === m.room_id)) loadConvs(); else refreshList();
      }).subscribe();
    return () => { supabase.removeChannel(ch); supabase.removeChannel(all); };
  }, [roomId]);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  useEffect(() => {
    const upd = () => setWallState(getWall(me, roomId));
    upd(); setFindQ(null); setEmojiOpen(false); setShowInfo(false);
    window.addEventListener("bcil-wall", upd); return () => window.removeEventListener("bcil-wall", upd);
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps
  // search in this chat: jump between matching messages
  const found = findQ && findQ.trim().length > 1 ? msgs.filter((m) => !m.deleted_at && m.body?.toLowerCase().includes(findQ.trim().toLowerCase())).map((m) => m.id).reverse() : [];
  useEffect(() => { setFindIdx(0); }, [findQ]);
  useEffect(() => { if (found.length) jumpTo(found[Math.min(findIdx, found.length - 1)]); }, [findIdx, found.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  function insertEmoji(e: string) {
    const el = inputRef.current;
    const at = el?.selectionStart ?? text.length, to = el?.selectionEnd ?? text.length;
    const v = text.slice(0, at) + e + text.slice(to);
    setText(v);
    setTimeout(() => { if (el) { el.selectionStart = el.selectionEnd = at + e.length; } }, 0);
  }
  // voice notes: tap the mic to record, then send or delete
  async function startRec() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("Voice notes aren't supported on this device."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported?.(t));
      const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
      const r: { mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; cancel?: boolean; secs?: number } = { mr, chunks: [] as Blob[], stream, cancel: false };
      recRef.current = r;
      mr.ondataavailable = (e) => { if (e.data.size) r.chunks.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); if (!r.cancel) sendVoice(r.chunks, mr.mimeType || type || "audio/webm", r.secs ?? 1); };
      mr.start(500);
      const start = Date.now(); setRec({ start, secs: 0 });
    } catch { setError("Allow the microphone to record a voice note."); }
  }
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setRec((r) => { if (!r) return r; const secs = Math.floor((Date.now() - r.start) / 1000); if (secs >= 300) stopRec(false); return { ...r, secs }; }), 500);
    return () => clearInterval(t);
  }, [!!rec]); // eslint-disable-line react-hooks/exhaustive-deps
  function stopRec(cancel: boolean) {
    const r = recRef.current; if (!r) return;
    r.cancel = cancel || (rec ? Date.now() - rec.start < 800 : false);
    r.secs = rec ? Math.max(1, Math.round((Date.now() - rec.start) / 1000)) : 1;
    if (r.mr.state !== "inactive") r.mr.stop();
    recRef.current = null; setRec(null);
  }
  useEffect(() => () => { if (recRef.current) { recRef.current.cancel = true; recRef.current.mr.stop(); } }, [roomId]);
  async function sendVoice(chunks: Blob[], type: string, secs: number) {
    if (!room || !chunks.length) return;
    const blob = new Blob(chunks, { type: type.split(";")[0] });
    setSending(true);
    try {
      const ext = /mp4/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : "webm";
      const path = `${me}/${Date.now()}-voice.${ext}`;
      const up = await supabase.storage.from("chat-files").upload(path, blob, { contentType: blob.type || "audio/webm" });
      if (up.error) throw up.error;
      const reply = replyTo; setReplyTo(null);
      const { error } = await supabase.from("messages").insert({ room_id: room.id, user_id: me, body: "", attachment_url: supabase.storage.from("chat-files").getPublicUrl(path).data.publicUrl,
        attachment_name: `Voice note (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")})`, attachment_type: "audio", attachment_size: blob.size, ...(reply ? { reply_to: reply.id } : {}) });
      if (error) throw error;
    } catch (e) { setError("Could not send the voice note: " + ((e as Error).message || "try again")); }
    setSending(false);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!room || (!text.trim() && !file) || sending) return;
    const body = text.trim();
    if (editing) {
      const m = editing; setSending(true);
      const { error } = await supabase.rpc("edit_message", { p_id: m.id, p_body: body });
      setSending(false);
      if (error) { setError(error.message || "Could not edit the message."); return; }
      setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, body, edited_at: new Date().toISOString() } : x)));
      setEditing(null); setText(""); return;
    }
    // who is tagged: the people picked from the list whose @name is still in the text, and @everyone
    const mentions = members.filter((p) => tags.includes(p.id) && body.includes("@" + p.name)).map((p) => p.id);
    const mentionAll = canTagAll && /@everyone\b/i.test(body);
    const tagCols = mentions.length || mentionAll ? { mentions, mention_all: mentionAll } : {};
    const reply = replyTo;
    let att: Record<string, unknown> = {};
    if (file) {
      setSending(true); setError("");
      try {
        const isImg = file.type.startsWith("image/") && !/gif|svg/.test(file.type);
        const blob: Blob = isImg ? await shrink(file, 1600) : file;
        const clean = file.name.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(-80) || "file";
        const path = `${me}/${Date.now()}-${isImg ? clean.replace(/\.[^.]+$/, "") + ".jpg" : clean}`;
        const up = await supabase.storage.from("chat-files").upload(path, blob, { contentType: isImg ? "image/jpeg" : file.type || "application/octet-stream" });
        if (up.error) throw up.error;
        att = { attachment_url: supabase.storage.from("chat-files").getPublicUrl(path).data.publicUrl, attachment_name: file.name.slice(0, 120),
          attachment_type: isImg || file.type.startsWith("image/") ? "image" : "file", attachment_size: blob.size };
      } catch (e) { setSending(false); setError("Could not send the file: " + ((e as Error).message || "try again")); return; }
    }
    setText(""); setReplyTo(null); clearFile(); setTags([]); setMentionQ(null);
    const { error } = await supabase.from("messages").insert({ room_id: room.id, user_id: me, body, ...att, ...tagCols, ...(reply ? { reply_to: reply.id } : {}) });
    setSending(false);
    if (error) { setError("Message not sent. Check your connection and try again."); setText(body); setReplyTo(reply); }
  }
  async function remove(m: Msg) {
    if (!confirm(m.user_id === me ? "Delete this message for everyone?" : "Delete this message for everyone in the group?")) return;
    const { error } = await supabase.rpc("delete_message", { p_id: m.id });
    if (error) { alert(error.message || "Could not delete the message."); return; }
    setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, body: "This message was deleted", deleted_at: new Date().toISOString(), attachment_url: null, attachment_type: null } : x)));
    setSel(null);
  }
  function startEdit(m: Msg) { setEditing(m); setReplyTo(null); setText(m.body); setSel(null); setTimeout(() => inputRef.current?.focus(), 0); }
  // typing "@" opens the list of group members to tag
  function onType(v: string) {
    setText(v);
    if (room?.kind === "dm") return;
    const mt = /(?:^|\s)@([^@\n]{0,30})$/.exec(v);
    setMentionQ(mt ? mt[1].toLowerCase() : null);
  }
  function pickTag(id: string | "everyone", name: string) {
    setText((t) => t.replace(/@([^@\n]{0,30})$/, "@" + name + " "));
    if (id !== "everyone") setTags((x) => (x.includes(id) ? x : [...x, id]));
    setMentionQ(null); setTimeout(() => inputRef.current?.focus(), 0);
  }
  async function report(m: Msg) {
    await supabase.from("reports").insert({ reporter: me, target_type: "message", target_id: String(m.id) });
    alert("Thanks. A moderator will review this message.");
  }

  const canPost = room && (!room.read_only || isStaff);
  const amLeader = isStaff || members.some((p) => p.id === me && p.role === "leader");
  const canTagAll = !!room && room.kind !== "dm" && amLeader;
  const canEdit = (m: Msg) => m.user_id === me && !m.deleted_at && Date.now() - Date.parse(m.created_at) < 24 * 3600e3;
  const canDelete = (m: Msg) => !m.deleted_at && (m.user_id === me || amLeader);
  const tagList = mentionQ === null ? [] : [
    ...(canTagAll && "everyone".startsWith(mentionQ) ? [{ id: "everyone", name: "everyone", avatar: null as string | null, role: "" }] : []),
    ...members.filter((p) => p.id !== me && p.name.toLowerCase().includes(mentionQ)).slice(0, 6),
  ];
  // show @names of tagged people (and @everyone) in bold
  const withTags = (m: Msg) => {
    const names = members.filter((p) => m.mentions?.includes(p.id)).map((p) => "@" + p.name);
    if (m.mention_all) names.push("@everyone");
    if (!names.length) return m.body;
    const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return m.body.split(new RegExp(`(${esc.join("|")})`, "g")).map((part, i) => names.includes(part) ? <b key={i} className="tagged">{part}</b> : part);
  };
  const seenBy = (m: Msg) => Object.values(reads).filter((t) => Date.parse(t) >= Date.parse(m.created_at)).length;
  const lastMine = [...msgs].reverse().find((m) => m.user_id === me)?.id;
  const startReply = (m: Msg) => { if (!canPost) return; setReplyTo(m); setTimeout(() => inputRef.current?.focus(), 0); };
  const nameOf = (m: Msg) => (m.user_id === me ? "You" : m.profiles?.full_name || "Member");
  const jumpTo = (id: number) => { const el = document.getElementById(`m${id}`); if (!el) return; el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1200); };
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });

  return (
    <section className="view chatview">
      <div className={`chatwrap${room ? " has-room" : ""}`}>
        <div className="chans">
          <div className="chanhead"><h1>Chats</h1><Link to="/friends" className="iconbtn sm" aria-label="Start a conversation with a friend"><Icon name="userplus" size={18} /></Link></div>
          <div className="pad"><ChatTabs /></div>
          <div className="pad"><Statuses /></div>
          <div className="wa-search"><Icon name="search" size={17} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
            {q && <button className="linkbtn" onClick={() => setQ("")} aria-label="Clear search">✕</button>}</div>
          {(() => {
            const curTab = tab ?? (convs?.some((c) => c.kind === "dm") ? "dm" : "groups");
            const unreadIn = (k: "dm" | "groups") => (convs ?? []).filter((c) => (k === "dm" ? c.kind === "dm" : c.kind !== "dm") && (unread[c.id] ?? 0) > 0).length;
            return <>
              <div className="seg chatseg" role="tablist" aria-label="Chat type">
                <button role="tab" aria-selected={curTab === "dm"} onClick={() => setTab("dm")}>Direct{unreadIn("dm") ? <b className="segn">{unreadIn("dm")}</b> : null}</button>
                <button role="tab" aria-selected={curTab === "groups"} onClick={() => setTab("groups")}>Groups{unreadIn("groups") ? <b className="segn">{unreadIn("groups")}</b> : null}</button>
                <button role="tab" aria-selected={curTab === "requests"} onClick={() => setTab("requests")}>Requests{requests.length ? <b className="segn red">{requests.length}</b> : null}</button>
              </div>
              {curTab !== "requests" && <div className="wa-filters" role="group" aria-label="Show">
                {([["all", "All"], ["unread", "Unread"], ["mentions", "Mentions and replies"]] as const).map(([k, label]) => (
                  <button key={k} className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>))}
              </div>}
              {curTab === "groups" && <Link to="/groups" className="findgroups"><Icon name="users" size={18} /><span className="grow">Find groups</span><span aria-hidden>›</span></Link>}
              {curTab === "requests" ? (
                <div className="chanlist wa-list reqlist">
                  {requests.length === 0 ? <p className="muted pad small">No requests right now. When someone asks to be your friend, it shows here. <Link to="/friends">Find people</Link></p>
                    : requests.map((r) => (
                      <div key={r.id} className="reqrow">
                        <button className="plainbtn" onClick={() => setPerson(r.requester)} aria-label={`See ${r.name}'s profile`}><Avatar name={r.name} url={r.avatar} size={48} /></button>
                        <span className="wa-mid"><b>{r.name}<Tick id={r.requester} size={14} /></b><small className="muted">wants to be your friend</small></span>
                        <button className="btn primary sm" onClick={() => answerRequest(r, true)}>Accept</button>
                        <button className="btn ghost sm" onClick={() => answerRequest(r, false)} aria-label={`Decline ${r.name}`}>✕</button>
                      </div>))}
                </div>
              ) : convs === null ? <p className="muted pad">Loading…</p> : (() => {
                const items = convs.filter((c) => (curTab === "dm" ? c.kind === "dm" : c.kind !== "dm")
                  && (filter === "all" || (filter === "unread" ? (unread[c.id] ?? 0) > 0 : mentionRooms.has(c.id)))
                  && (!q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())));
                return <ChanList items={items} roomId={roomId} unread={unread} me={me} onPick={(id) => setParams({ room: id })}
                  empty={<p className="muted pad small">{q ? "No chats match that name." : filter === "unread" ? "You're all caught up." : filter === "mentions" ? "No one has tagged you or replied to you lately." : curTab === "dm" ? <>Add friends, then message them here. <Link to="/friends">Find people</Link></> : "You're not in any groups yet."}</p>} />;
              })()}
            </>;
          })()}
        </div>
        <div className="room">
          {!room ? <div className="center muted">Pick a conversation.</div> : <>
            <div className="roomhead">
              <button className="iconbtn sm backonly" onClick={() => nav("/chat")} aria-label="Back to chats"><Icon name="back" size={20} /></button>
              <button className="plainbtn roomhead-who" onClick={() => setShowInfo(true)} aria-label={`Chat info for ${room.name}`}>
                {room.kind === "dm" ? <Avatar name={room.name} url={room.avatar} size={40} /> : <ChanIcon c={room} />}
                <span className="grow"><b>{room.name}{room.kind === "dm" && <Tick id={room.otherId} />}</b>
                  <small className="muted">{room.kind === "dm" ? "Tap for chat info" : `${room.members ?? ""} members · tap for info`}{online > 1 && <>, <span className="ok">{online} online</span></>}</small></span>
              </button>
              {room.kind === "dm" && canCall && <div className="callbtns">
                <button className="iconbtn callbtn" disabled={calling} onClick={() => call("audio")} aria-label={`Voice call ${room.name}`} title="Voice call">📞</button>
                <button className="iconbtn callbtn" disabled={calling} onClick={() => call("video")} aria-label={`Video call ${room.name}`} title="Video call">🎥</button>
              </div>}
              <button className="iconbtn sm" onClick={() => setShowInfo(true)} aria-label="More options">⋮</button>
              {room.kind === "group" && room.leader && <button className="btn ghost sm golivebtn" onClick={() => nav("/live", { state: { group: { id: room.id, name: room.name } } })} aria-label={`Go live with ${room.name}`}>● Live</button>}
            </div>
            {findQ !== null && (
              <div className="findbar">
                <input autoFocus value={findQ} onChange={(e) => setFindQ(e.target.value)} placeholder="Search in this chat" aria-label="Search in this chat" />
                <small className="muted">{findQ.trim().length > 1 ? (found.length ? `${Math.min(findIdx, found.length - 1) + 1} of ${found.length}` : "None") : ""}</small>
                <button className="iconbtn sm" disabled={!found.length} onClick={() => setFindIdx((i) => (i + 1) % found.length)} aria-label="Older match">↑</button>
                <button className="iconbtn sm" disabled={!found.length} onClick={() => setFindIdx((i) => (i - 1 + found.length) % found.length)} aria-label="Newer match">↓</button>
                <button className="linkbtn" onClick={() => setFindQ(null)}>Done</button>
              </div>
            )}
            <div className={`msgs${isDarkWall(wall) ? " darkwall" : ""}${wall !== "none" ? " haswall" : ""}`} style={wallStyle(wall)}>
              <div className="sysmsg kindnote">🛡 Be kind here. Never send money to anyone in chat. You can report a message or a person.</div>
              {msgs.map((m, i) => {
                const mine = m.user_id === me;
                const newDay = i === 0 || day(msgs[i - 1].created_at) !== day(m.created_at);
                const sameAuthor = !newDay && i > 0 && msgs[i - 1].user_id === m.user_id;
                const quoted = m.reply_to ? msgs.find((x) => x.id === m.reply_to) : null;
                return (
                  <div key={m.id} className="msgblock">
                    {newDay && <div className="sysmsg">{day(m.created_at)}</div>}
                    <div id={`m${m.id}`} className={`msg${mine ? " mine" : ""}${sameAuthor && !m.reply_to ? " cont" : ""}`}
                      onTouchStart={(e) => { swipe.current = { id: m.id, x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
                      onTouchEnd={(e) => { const s0 = swipe.current; swipe.current = null; if (!s0 || s0.id !== m.id) return;
                        const dx = e.changedTouches[0].clientX - s0.x, dy = Math.abs(e.changedTouches[0].clientY - s0.y);
                        if (dx > 60 && dy < 40) startReply(m); }}
                      onDoubleClick={() => startReply(m)}>
                      {!mine && <span className="msgav">{!sameAuthor && <button className="plainbtn" onClick={() => setPerson(m.user_id)} aria-label={`See ${nameOf(m)}'s profile`}><Avatar name={m.profiles?.full_name} url={m.profiles?.avatar_url} size={32} /></button>}</span>}
                      <div className={`bub${sel === m.id ? " sel" : ""}`} onClick={(e) => { if (!(e.target as HTMLElement).closest("button,a")) setSel(sel === m.id ? null : m.id); }}>
                        {!mine && !sameAuthor && room.kind !== "dm" && <button className="plainbtn bubname" onClick={() => setPerson(m.user_id)}>{m.profiles?.full_name || "Member"}<Tick id={m.user_id} size={13} /></button>}
                        {m.reply_to && <button className="quote-in" onClick={() => m.reply_to && jumpTo(m.reply_to)}>
                          <b>{quoted ? nameOf(quoted) : "Reply"}</b><span>{quoted ? quoted.body : "Earlier message"}</span></button>}
                        {m.attachment_url && m.attachment_type === "image" && (
                          <button className="plainbtn msgimg" onClick={() => setViewImg(m.attachment_url!)}><img src={m.attachment_url} alt={m.attachment_name ?? "Photo"} loading="lazy" /></button>)}
                        {m.attachment_url && m.attachment_type === "audio" && (
                          <div className="msgvoice"><span aria-hidden="true">🎤</span><audio controls preload="none" src={m.attachment_url} aria-label={m.attachment_name ?? "Voice note"} /></div>)}
                        {m.attachment_url && m.attachment_type !== "image" && m.attachment_type !== "audio" && (
                          <button className="plainbtn msgfile" onClick={() => openFile(m)}>
                            <span className="msgfile-ico" aria-hidden="true">{fileIcon(m.attachment_name)}</span>
                            <span className="grow"><b>{m.attachment_name || "File"}</b><small>{fileSize(m.attachment_size)}{fileSize(m.attachment_size) ? " · " : ""}Tap to open</small></span>
                          </button>)}
                        {m.deleted_at ? <p className="msgdeleted">🚫 {m.user_id === me ? "You deleted this message" : "This message was deleted"}</p>
                          : m.body && <p className="prewrap">{withTags(m)}</p>}
                        <small className="mtime">{m.edited_at && !m.deleted_at ? "edited · " : ""}{new Date(m.created_at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}
                          {mine && room.kind === "dm" && (seenBy(m) > 0 ? <span className="tick seen" title="Seen" aria-label="Seen"> ✓✓</span> : <span className="tick" title="Sent" aria-label="Sent"> ✓</span>)}</small>
                        {mine && room.kind !== "dm" && m.id === lastMine && seenBy(m) > 0 && <button className="plainbtn seenby" onClick={() => setInfoFor(m)}>Seen by {seenBy(m)} ›</button>}
                        {!m.deleted_at && <span className="msgacts">
                        {canPost && <button className="linkbtn" onClick={() => startReply(m)}>Reply</button>}
                        <button className="linkbtn" onClick={() => setPickFor(pickFor === m.id ? null : m.id)} aria-label="React">☺︎+</button>
                        {canEdit(m) && <button className="linkbtn" onClick={() => startEdit(m)}>Edit</button>}
                        {mine && room.kind !== "dm" && <button className="linkbtn" onClick={() => setInfoFor(m)}>Info</button>}
                        {canDelete(m) && <button className="linkbtn danger" onClick={() => remove(m)}>Delete</button>}
                        {!mine && <button className="linkbtn" onClick={() => report(m)}>Report</button>}
                        </span>}
                        {pickFor === m.id && <span className="reactpick">{EMOJIS.map((e) => <button key={e} onClick={() => react(m, e)} aria-label={`React ${e}`}>{e}</button>)}</span>}
                        {(reacts[m.id]?.length ?? 0) > 0 && <span className="reactrow">{Object.entries((reacts[m.id] ?? []).reduce<Record<string, number>>((a, r) => ((a[r.emoji] = (a[r.emoji] ?? 0) + 1), a), {})).map(([e, n]) => (
                          <button key={e} className={`reactchip${(reacts[m.id] ?? []).some((r) => r.user_id === me && r.emoji === e) ? " mine" : ""}`} onClick={() => react(m, e)}>{e}{n > 1 ? ` ${n}` : ""}</button>))}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={end} />
            </div>
            {editing && (
              <div className="replybar"><div className="grow"><b>✏️ Editing message</b><span>{editing.body}</span></div>
                <button className="linkbtn" onClick={() => { setEditing(null); setText(""); }} aria-label="Cancel editing">✕</button></div>
            )}
            {tagList.length > 0 && (
              <div className="taglist" role="listbox" aria-label="Tag someone">{tagList.map((p) => (
                <button key={p.id} role="option" aria-selected="false" className="tagopt" onMouseDown={(e) => e.preventDefault()} onClick={() => pickTag(p.id, p.name)}>
                  {p.id === "everyone" ? <span className="tagall" aria-hidden="true">@</span> : <Avatar name={p.name} url={p.avatar} size={28} />}
                  <span><b>{p.id === "everyone" ? "@everyone" : p.name}</b>{p.id === "everyone" && <small className="muted"> · tag all {members.length - 1} members</small>}</span>
                </button>))}</div>
            )}
            {replyTo && (
              <div className="replybar"><div className="grow"><b>Replying to {nameOf(replyTo)}</b><span>{replyTo.body}</span></div>
                <button className="linkbtn" onClick={() => setReplyTo(null)} aria-label="Cancel reply">✕</button></div>
            )}
            {file && (
              <div className="attachbar">{preview ? <img src={preview} alt="" /> : <span className="msgfile-ico" aria-hidden="true">{fileIcon(file.name)}</span>}
                <span className="grow"><b>{file.name}</b><small className="muted">{fileSize(file.size)}{sending ? " · sending…" : " · add a message or tap Send"}</small></span>
                {!sending && <button className="linkbtn" onClick={clearFile} aria-label="Remove file">✕</button>}</div>
            )}
            {emojiOpen && canPost && !rec && <EmojiPanel onPick={insertEmoji} />}
            {rec ? (
              <div className="composer recbar" role="group" aria-label="Recording a voice note">
                <button type="button" className="iconbtn" onClick={() => stopRec(true)} aria-label="Delete recording">🗑</button>
                <span className="recdot" aria-hidden="true" /><b className="rectime">{Math.floor(rec.secs / 60)}:{String(rec.secs % 60).padStart(2, "0")}</b>
                <span className="grow muted small">Recording… tap send when you're done</span>
                <button type="button" className="btn primary sendround" onClick={() => stopRec(false)} aria-label="Send voice note">➤</button>
              </div>
            ) : (
            <form className="composer" onSubmit={(e) => { setEmojiOpen(false); send(e); }}>
              <div className="composebox">
                {canPost && <button type="button" className="emojibtn" onClick={() => { setEmojiOpen((o) => !o); if (emojiOpen) setTimeout(() => inputRef.current?.focus(), 0); }} aria-label={emojiOpen ? "Show keyboard" : "Emojis"} aria-pressed={emojiOpen}>{emojiOpen ? "⌨️" : "😊"}</button>}
                <input ref={inputRef} value={text} onChange={(e) => onType(e.target.value)} disabled={!canPost} onFocus={() => setEmojiOpen(false)}
                  placeholder={canPost ? "Message" : "Only admins can post here"} aria-label="Message" />
                {canPost && <label className="attachbtn" aria-label="Add a photo or document" title="Add a photo or document">📎
                  <input type="file" hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} /></label>}
                {canPost && !text && !file && <label className="attachbtn" aria-label="Take a photo" title="Take a photo">📷
                  <input type="file" hidden accept="image/*" capture="environment" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} /></label>}
              </div>
              {canPost && !editing && !text.trim() && !file
                ? <button type="button" className="btn primary sendround" onClick={startRec} disabled={sending} aria-label="Record a voice note">🎤</button>
                : <button className="btn primary sendround" disabled={!canPost || sending || (!text.trim() && !file)} aria-label={editing ? "Save" : "Send"}>{sending ? "…" : editing ? "✓" : "➤"}</button>}
            </form>
            )}
            {error && <p className="err pad" role="alert">{error}</p>}
          </>}
          {person && <PersonSheet userId={person} close={() => setPerson(null)} />}
          {showInfo && room && <ChatInfo room={room} me={me} canCall={canCall} onClose={() => setShowInfo(false)}
            onCall={(k) => { setShowInfo(false); call(k); }} onSearch={() => { setShowInfo(false); setFindQ(""); }} onWallpaper={() => { setShowInfo(false); setShowWall(true); }}
            onProfile={() => { setShowInfo(false); if (room.otherId) setPerson(room.otherId); }} onGroup={() => nav(`/groups/${room.id}`)}
            onOpenRoom={(id) => { setShowInfo(false); setTab("groups"); setParams({ room: id }); }} />}
          {showWall && room && <WallpaperSheet me={me} room={room.id} roomName={room.name} onClose={() => setShowWall(false)} />}
          {infoFor && (() => {
            const others = members.filter((p) => p.id !== me);
            const readers = others.filter((p) => reads[p.id] && Date.parse(reads[p.id]) >= Date.parse(infoFor.created_at))
              .sort((a, b) => Date.parse(reads[a.id]) - Date.parse(reads[b.id]));
            const notYet = others.filter((p) => !readers.includes(p));
            const t = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit" });
            return (
              <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Message info" onClick={() => setInfoFor(null)}>
                <div className="sheet msginfo" onClick={(e) => e.stopPropagation()}>
                  <h2>Message info</h2>
                  <div className="msginfo-msg">{infoFor.body}<small className="muted"> · sent {t(infoFor.created_at)}</small></div>
                  <h3>✓✓ Read by {readers.length}</h3>
                  {readers.length ? readers.map((p) => <div key={p.id} className="row msginfo-row"><Avatar name={p.name} url={p.avatar} size={32} /><span className="grow">{p.name}</span><small className="muted">{t(reads[p.id])}</small></div>)
                    : <p className="muted small">No one has read it yet.</p>}
                  <h3>✓ Not read yet · {notYet.length}</h3>
                  {notYet.slice(0, 100).map((p) => <div key={p.id} className="row msginfo-row"><Avatar name={p.name} url={p.avatar} size={32} /><span className="grow">{p.name}</span></div>)}
                  <button className="btn ghost block" onClick={() => setInfoFor(null)}>Close</button>
                </div>
              </div>
            );
          })()}
          {viewImg && <div className="lightbox" role="dialog" aria-label="Photo" onClick={() => setViewImg(null)}>
            <img src={viewImg} alt="" /><button className="lightbox-x" aria-label="Close">✕</button>
            <a className="lightbox-dl" href={`${viewImg}?download=`} onClick={(e) => e.stopPropagation()}>⬇ Save</a></div>}
        </div>
      </div>
    </section>
  );
}

const EMOJIS = ["👍", "❤️", "🙏", "😂", "🔥", "👏"];
const fileSize = (n?: number | null) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fileIcon = (name?: string | null) => {
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return ext === "pdf" ? "📕" : /docx?/.test(ext) ? "📘" : /xlsx?|csv/.test(ext) ? "📗" : /pptx?/.test(ext) ? "📙" : ext === "zip" ? "🗜" : "📄";
};
async function openFile(m: Msg) {
  if (!m.attachment_url) return;
  const url = `${m.attachment_url}?download=${encodeURIComponent(m.attachment_name || "file")}`;
  if (isNative) { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url: m.attachment_url }); return; }
  window.open(/\.pdf$/i.test(m.attachment_name ?? "") ? m.attachment_url : url, "_blank", "noopener");
}

function ChanIcon({ c }: { c: Conv }) {
  return c.cover ? <img className="gcover sm" src={c.cover} alt="" /> : <span className={`gcover sm cat-${c.kind === "announcements" ? "program" : "general"}`} aria-hidden="true">{initials(c.name.replace(/^BCIL\s+/i, "").replace(/\b(UCC|KNUST|UG|UEW|\d+)\b/g, ""))}</span>;
}

function ChanList({ items, roomId, unread, me, onPick, empty }: { items: Conv[]; roomId: string | null; unread: Record<string, number>; me: string; onPick: (id: string) => void; empty?: React.ReactNode }) {
  return (
    <div className="chanlist wa-list">
      {items.length === 0 ? empty : items.map((c) => {
        const n = unread[c.id] ?? 0;
        const l = c.last;
        const who = !l?.user ? "" : l.user === me ? "You: " : c.kind !== "dm" ? `${(l.name || "Member").split(" ")[0]}: ` : "";
        const what = !l || (!l.body && !l.type) ? (c.kind === "dm" ? "Say hello 👋" : c.sub)
          : l.body ? l.body : l.type === "image" ? "📷 Photo" : l.type === "audio" ? "🎤 Voice note" : "📄 Document";
        return (
          <button key={c.id} aria-current={c.id === roomId} className={n > 0 ? "unread" : ""} onClick={() => onPick(c.id)}
            aria-label={`${c.name}${n ? `, ${n} unread` : ""}`}>
            {c.kind === "dm" ? <Avatar name={c.name} url={c.avatar} size={48} /> : <ChanIcon c={c} />}
            <span className="wa-mid">
              <span className="wa-top"><b>{c.name}{c.kind === "dm" && <Tick id={c.otherId} size={14} />}</b>{c.at && <small className="wa-time">{listTime(c.at)}</small>}</span>
              <span className="wa-bot"><span className="wa-prev">{who}{what.replace(/\s+/g, " ")}</span>{n > 0 && <span className="wa-count">{n > 99 ? "99+" : n}</span>}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function listTime(iso: string) {
  const d = new Date(iso), now = new Date();
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "2-digit" });
}
