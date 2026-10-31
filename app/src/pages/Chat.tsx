import { useEffect, useRef, useState } from "react";
import ChatTabs from "../components/ChatTabs";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { initials, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import type { Group } from "./Groups";

type Conv = { id: string; name: string; sub: string; avatar?: string | null; kind: "group" | "dm" | "announcements"; read_only: boolean; cover?: string | null; members?: number; otherId?: string };
type Msg = { id: number; user_id: string; body: string; created_at: string; profiles?: { full_name: string; avatar_url: string | null } | null };

export default function Chat() {
  const { session, profile, isStaff } = useAuth();
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
      ...groups.filter((g) => g.is_member).map((g) => ({ id: g.id, name: g.name, sub: g.kind === "announcements" ? "Announcements" : `${g.member_count} members`, kind: g.kind as Conv["kind"], read_only: g.read_only, cover: g.cover_url, members: g.member_count })),
      ...((dms ?? []) as { room_id: string; other_id: string; other_name: string; other_avatar: string | null }[]).map((d) => ({ id: d.room_id, name: d.other_name || "Member", sub: "Direct message", avatar: d.other_avatar, kind: "dm" as const, read_only: false, otherId: d.other_id })),
    ];
    setConvs(list);
    setUnread(Object.fromEntries(((un ?? []) as { room_id: string; n: number }[]).map((u) => [u.room_id, u.n])));
    // on a big screen, open the first conversation straight away
    if (!roomId && list[0] && window.matchMedia("(min-width: 761px)").matches) setParams({ room: list[0].id }, { replace: true });
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
    setMsgs([]); setError("");
    supabase.from("messages").select("id, user_id, body, created_at, profiles(full_name, avatar_url)")
      .eq("room_id", roomId).order("created_at", { ascending: false }).limit(200)
      .then(({ data }) => setMsgs(((data ?? []) as unknown as Msg[]).reverse()));
    markRead(roomId);
    const ch = supabase.channel(`room:${roomId}`, { config: { presence: { key: me } } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
        async (p) => {
          const m = p.new as Msg;
          const { data } = await supabase.from("profiles").select("full_name, avatar_url").eq("id", m.user_id).single();
          setMsgs((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, { ...m, profiles: data }]));
          markRead(roomId);
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
    if (!room || !text.trim()) return;
    const body = text.trim(); setText("");
    const { error } = await supabase.from("messages").insert({ room_id: room.id, user_id: me, body });
    if (error) { setError("Message not sent. Check your connection and try again."); setText(body); }
  }
  async function report(m: Msg) {
    await supabase.from("reports").insert({ reporter: me, target_type: "message", target_id: String(m.id) });
    alert("Thanks. A moderator will review this message.");
  }

  const canPost = room && (!room.read_only || isStaff);
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });

  return (
    <section className="view chatview">
      <div className={`chatwrap${room ? " has-room" : ""}`}>
        <div className="chans">
          <div className="chanhead"><h1>Chat</h1><Link to="/friends" className="iconbtn sm" aria-label="Start a conversation with a friend"><Icon name="userplus" size={18} /></Link></div>
          <div className="pad"><ChatTabs /></div>
          {convs === null ? <p className="muted pad">Loading…</p> : <>
            <ChanList title="Groups" items={convs.filter((c) => c.kind !== "dm")} roomId={roomId} unread={unread} onPick={(id) => setParams({ room: id })} />
            <ChanList title="Direct messages" items={convs.filter((c) => c.kind === "dm")} roomId={roomId} unread={unread} onPick={(id) => setParams({ room: id })}
              empty={<p className="muted pad small">Add friends, then message them here. <Link to="/friends">Find people</Link></p>} />
            <p className="pad small"><Link to="/groups">Browse all groups and Campus Sync →</Link></p>
          </>}
        </div>
        <div className="room">
          {!room ? <div className="center muted">Pick a conversation.</div> : <>
            <div className="roomhead">
              <button className="iconbtn sm backonly" onClick={() => nav("/chat")} aria-label="Back to conversations"><Icon name="back" size={20} /></button>
              {room.kind === "dm" ? <Avatar name={room.name} url={room.avatar} size={40} /> : <ChanIcon c={room} />}
              <div className="grow"><b>{room.name}</b>
                <small className="muted">{room.kind === "dm" ? "Direct message" : `${room.members ?? ""} members`}{online > 1 && <>, <span className="ok">{online} online</span></>}</small></div>
              {room.kind !== "dm" && <Link to={`/groups/${room.id}`} className="btn ghost sm">Group page</Link>}
            </div>
            <div className="msgs">
              <div className="sysmsg">Be kind. Never send money to anyone in chat.</div>
              {msgs.map((m, i) => {
                const mine = m.user_id === me;
                const newDay = i === 0 || day(msgs[i - 1].created_at) !== day(m.created_at);
                const sameAuthor = !newDay && i > 0 && msgs[i - 1].user_id === m.user_id;
                return (
                  <div key={m.id} className="msgblock">
                    {newDay && <div className="sysmsg">{day(m.created_at)}</div>}
                    <div className={`msg${mine ? " mine" : ""}${sameAuthor ? " cont" : ""}`}>
                      {!mine && <span className="msgav">{!sameAuthor && <Avatar name={m.profiles?.full_name} url={m.profiles?.avatar_url} size={32} />}</span>}
                      <div className="bub">
                        {!mine && !sameAuthor && room.kind !== "dm" && <b>{m.profiles?.full_name || "Member"}</b>}
                        <p className="prewrap">{m.body}</p>
                        <small>{new Date(m.created_at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}</small>
                        {!mine && <button className="linkbtn" onClick={() => report(m)}>Report</button>}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={end} />
            </div>
            <form className="composer" onSubmit={send}>
              <input value={text} onChange={(e) => setText(e.target.value)} disabled={!canPost}
                placeholder={canPost ? "Write a message" : "Only admins can post here"} aria-label="Message" />
              <button className="btn primary" disabled={!canPost || !text.trim()}>Send</button>
            </form>
            {error && <p className="err pad" role="alert">{error}</p>}
          </>}
        </div>
      </div>
    </section>
  );
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
