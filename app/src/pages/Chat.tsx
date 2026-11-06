import { useEffect, useRef, useState } from "react";
import ChatTabs from "../components/ChatTabs";
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

type Conv = { id: string; name: string; sub: string; avatar?: string | null; kind: "group" | "dm" | "announcements"; read_only: boolean; cover?: string | null; members?: number; otherId?: string; leader?: boolean };
type Msg = { id: number; user_id: string; body: string; created_at: string; reply_to?: number | null;
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
    const ok = await L.goLiveNow({ title: `Call with ${room.name}`, topic: "", kind, record: false, cam: kind === "video", roomId: room.id, dm: true });
    setCalling(false);
    if (ok) nav("/live");
  }
  const me = session!.user.id;
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const roomId = params.get("room");
  const [convs, setConvs] = useState<Conv[] | null>(null);
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
      ...groups.filter((g) => g.is_member).map((g) => ({ id: g.id, name: g.name, sub: g.kind === "announcements" ? "Announcements" : `${g.member_count} members`, kind: g.kind as Conv["kind"], read_only: g.read_only, cover: g.cover_url, members: g.member_count, leader: isStaff || g.my_role === "leader" })),
      ...((dms ?? []) as { room_id: string; other_id: string; other_name: string; other_avatar: string | null }[]).map((d) => ({ id: d.room_id, name: d.other_name || "Member", sub: "Direct message", avatar: d.other_avatar, kind: "dm" as const, read_only: false, otherId: d.other_id })),
    ];
    setConvs(list);
    setUnread(Object.fromEntries(((un ?? []) as { room_id: string; n: number }[]).map((u) => [u.room_id, u.n])));
    // on a big screen, open the first conversation straight away
    const firstDm = list.find((c) => c.kind === "dm");
    if (!roomId && firstDm && window.matchMedia("(min-width: 761px)").matches) setParams({ room: firstDm.id }, { replace: true });
  }
  useEffect(() => { loadConvs(); }, []);

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
      }).subscribe();
    return () => { supabase.removeChannel(ch); supabase.removeChannel(all); };
  }, [roomId]);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!room || (!text.trim() && !file) || sending) return;
    const body = text.trim();
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
    setText(""); setReplyTo(null); clearFile();
    const { error } = await supabase.from("messages").insert({ room_id: room.id, user_id: me, body, ...att, ...(reply ? { reply_to: reply.id } : {}) });
    setSending(false);
    if (error) { setError("Message not sent. Check your connection and try again."); setText(body); setReplyTo(reply); }
  }
  async function report(m: Msg) {
    await supabase.from("reports").insert({ reporter: me, target_type: "message", target_id: String(m.id) });
    alert("Thanks. A moderator will review this message.");
  }

  const canPost = room && (!room.read_only || isStaff);
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
          <div className="chanhead"><h1>Chat</h1><Link to="/friends" className="iconbtn sm" aria-label="Start a conversation with a friend"><Icon name="userplus" size={18} /></Link></div>
          <div className="pad"><ChatTabs /></div>
          {convs === null ? <p className="muted pad">Loading…</p> : <>
            <ChanList title="Messages" items={convs.filter((c) => c.kind === "dm")} roomId={roomId} unread={unread} onPick={(id) => setParams({ room: id })}
              empty={<p className="muted pad small">Add friends, then message them here. <Link to="/friends">Find people</Link></p>} />
            <p className="pad small muted">Group chats are under <Link to="/groups">Groups</Link> and <Link to="/campus">Campus Sync</Link>.</p>
          </>}
        </div>
        <div className="room">
          {!room ? <div className="center muted">Pick a conversation.</div> : <>
            <div className="roomhead">
              <button className={`iconbtn sm${room.kind === "dm" ? " backonly" : ""}`} onClick={() => nav(room.kind === "dm" ? "/chat" : "/groups")} aria-label={room.kind === "dm" ? "Back to messages" : "Back to groups"}><Icon name="back" size={20} /></button>
              <button className="plainbtn roomhead-who" onClick={() => (room.kind === "dm" ? room.otherId && setPerson(room.otherId) : nav(`/groups/${room.id}`))}
                aria-label={room.kind === "dm" ? `See ${room.name}'s profile` : `About ${room.name}: description, members, leave group`}>
                {room.kind === "dm" ? <Avatar name={room.name} url={room.avatar} size={40} /> : <ChanIcon c={room} />}
                <span className="grow"><b>{room.name}</b>
                  <small className="muted">{room.kind === "dm" ? "Tap for profile" : `${room.members ?? ""} members · tap for group info`}{online > 1 && <>, <span className="ok">{online} online</span></>}</small></span>
              </button>
              {room.kind === "dm" && canCall && <div className="callbtns">
                <button className="iconbtn callbtn" disabled={calling} onClick={() => call("audio")} aria-label={`Voice call ${room.name}`} title="Voice call">📞</button>
                <button className="iconbtn callbtn" disabled={calling} onClick={() => call("video")} aria-label={`Video call ${room.name}`} title="Video call">🎥</button>
              </div>}
              {room.kind === "group" && room.leader && <button className="btn ghost sm golivebtn" onClick={() => nav("/live", { state: { group: { id: room.id, name: room.name } } })} aria-label={`Go live with ${room.name}`}>● Live</button>}
            </div>
            <div className="msgs">
              <div className="sysmsg">Be kind. Never send money to anyone in chat.</div>
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
                      <div className="bub">
                        {!mine && !sameAuthor && room.kind !== "dm" && <button className="plainbtn bubname" onClick={() => setPerson(m.user_id)}>{m.profiles?.full_name || "Member"}</button>}
                        {m.reply_to && <button className="quote-in" onClick={() => m.reply_to && jumpTo(m.reply_to)}>
                          <b>{quoted ? nameOf(quoted) : "Reply"}</b><span>{quoted ? quoted.body : "Earlier message"}</span></button>}
                        {m.attachment_url && m.attachment_type === "image" && (
                          <button className="plainbtn msgimg" onClick={() => setViewImg(m.attachment_url!)}><img src={m.attachment_url} alt={m.attachment_name ?? "Photo"} loading="lazy" /></button>)}
                        {m.attachment_url && m.attachment_type !== "image" && (
                          <button className="plainbtn msgfile" onClick={() => openFile(m)}>
                            <span className="msgfile-ico" aria-hidden="true">{fileIcon(m.attachment_name)}</span>
                            <span className="grow"><b>{m.attachment_name || "File"}</b><small>{fileSize(m.attachment_size)}{fileSize(m.attachment_size) ? " · " : ""}Tap to open</small></span>
                          </button>)}
                        {m.body && <p className="prewrap">{m.body}</p>}
                        <small>{new Date(m.created_at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}
                          {mine && room.kind === "dm" && (seenBy(m) > 0 ? <span className="tick seen" title="Seen" aria-label="Seen"> ✓✓</span> : <span className="tick" title="Sent" aria-label="Sent"> ✓</span>)}</small>
                        {mine && room.kind !== "dm" && m.id === lastMine && seenBy(m) > 0 && <small className="seenby">Seen by {seenBy(m)}</small>}
                        {canPost && <button className="linkbtn" onClick={() => startReply(m)}>Reply</button>}
                        <button className="linkbtn" onClick={() => setPickFor(pickFor === m.id ? null : m.id)} aria-label="React">☺︎+</button>
                        {pickFor === m.id && <span className="reactpick">{EMOJIS.map((e) => <button key={e} onClick={() => react(m, e)} aria-label={`React ${e}`}>{e}</button>)}</span>}
                        {(reacts[m.id]?.length ?? 0) > 0 && <span className="reactrow">{Object.entries((reacts[m.id] ?? []).reduce<Record<string, number>>((a, r) => ((a[r.emoji] = (a[r.emoji] ?? 0) + 1), a), {})).map(([e, n]) => (
                          <button key={e} className={`reactchip${(reacts[m.id] ?? []).some((r) => r.user_id === me && r.emoji === e) ? " mine" : ""}`} onClick={() => react(m, e)}>{e}{n > 1 ? ` ${n}` : ""}</button>))}</span>}
                        {!mine && <button className="linkbtn" onClick={() => report(m)}>Report</button>}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={end} />
            </div>
            {replyTo && (
              <div className="replybar"><div className="grow"><b>Replying to {nameOf(replyTo)}</b><span>{replyTo.body}</span></div>
                <button className="linkbtn" onClick={() => setReplyTo(null)} aria-label="Cancel reply">✕</button></div>
            )}
            {file && (
              <div className="attachbar">{preview ? <img src={preview} alt="" /> : <span className="msgfile-ico" aria-hidden="true">{fileIcon(file.name)}</span>}
                <span className="grow"><b>{file.name}</b><small className="muted">{fileSize(file.size)}{sending ? " · sending…" : " · add a message or tap Send"}</small></span>
                {!sending && <button className="linkbtn" onClick={clearFile} aria-label="Remove file">✕</button>}</div>
            )}
            <form className="composer" onSubmit={send}>
              {canPost && <label className="attachbtn" aria-label="Add a photo or document" title="Add a photo or document">📎
                <input type="file" hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} /></label>}
              <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} disabled={!canPost}
                placeholder={canPost ? "Write a message" : "Only admins can post here"} aria-label="Message" />
              <button className="btn primary" disabled={!canPost || sending || (!text.trim() && !file)}>{sending ? "…" : "Send"}</button>
            </form>
            {error && <p className="err pad" role="alert">{error}</p>}
          </>}
          {person && <PersonSheet userId={person} close={() => setPerson(null)} />}
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

function ChanList({ title, items, roomId, unread, onPick, empty }: { title: string; items: Conv[]; roomId: string | null; unread: Record<string, number>; onPick: (id: string) => void; empty?: React.ReactNode }) {
  return (
    <div className="chanlist">
      <div className="chantitle">{title}</div>
      {items.length === 0 ? empty : items.map((c) => (
        <button key={c.id} aria-current={c.id === roomId} onClick={() => onPick(c.id)}>
          {c.kind === "dm" ? <Avatar name={c.name} url={c.avatar} size={40} /> : <ChanIcon c={c} />}
          <span className="grow"><b>{c.name}</b><small className="muted">{c.sub}</small></span>
          {(unread[c.id] ?? 0) > 0 && <span className="count inline">{unread[c.id] > 99 ? "99+" : unread[c.id]}</span>}
        </button>
      ))}
    </div>
  );
}
