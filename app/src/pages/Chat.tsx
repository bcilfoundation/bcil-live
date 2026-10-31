import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

type Room = { id: string; name: string; kind: string; read_only: boolean };
type Msg = { id: number; user_id: string; body: string; created_at: string; profiles?: { full_name: string } | null };

export default function Chat() {
  const { session, isStaff } = useAuth();
  const me = session!.user.id;
  const [rooms, setRooms] = useState<Room[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  async function loadRooms() {
    // join every open room automatically, then list the rooms you can see
    const { data } = await supabase.from("rooms").select("id, name, kind, read_only").order("created_at");
    const list = (data ?? []) as Room[];
    await Promise.all(list.map((r) => supabase.from("room_members").upsert({ room_id: r.id, user_id: me }, { ignoreDuplicates: true })));
    setRooms(list);
    setRoom((cur) => cur ?? list[0] ?? null);
  }
  useEffect(() => { loadRooms(); }, []);

  useEffect(() => {
    if (!room) return;
    supabase.from("messages").select("id, user_id, body, created_at, profiles(full_name)")
      .eq("room_id", room.id).order("created_at").limit(200)
      .then(({ data }) => setMsgs((data ?? []) as unknown as Msg[]));
    // new messages arrive instantly through Supabase Realtime
    const ch = supabase.channel(`room:${room.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${room.id}` },
        async (p) => {
          const m = p.new as Msg;
          const { data } = await supabase.from("profiles").select("full_name").eq("id", m.user_id).single();
          setMsgs((cur) => cur.some((x) => x.id === m.id) ? cur : [...cur, { ...m, profiles: data }]);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [room?.id]);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!room || !text.trim()) return;
    const body = text.trim(); setText("");
    const { error } = await supabase.from("messages").insert({ room_id: room.id, user_id: me, body });
    if (error) setError("Message not sent. Check your connection and try again.");
  }
  async function report(m: Msg) {
    await supabase.from("reports").insert({ reporter: me, target_type: "message", target_id: String(m.id) });
    alert("Thanks. A moderator will review this message.");
  }
  async function join() {
    const { error } = await supabase.rpc("join_with_code", { code });
    if (error) setError(error.message); else { setCode(""); setError(""); loadRooms(); }
  }

  const canPost = room && (!room.read_only || isStaff);
  return (
    <section className="view">
      <h1>Chat room</h1>
      <div className="chatwrap">
        <div className="chans">
          {rooms.map((r) => (
            <button key={r.id} aria-current={r.id === room?.id} onClick={() => setRoom(r)}><b>{r.name}</b></button>
          ))}
          <div className="joincode">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Group code" aria-label="Group code" />
            <button className="btn ghost" onClick={join}>Join</button>
          </div>
        </div>
        <div className="room">
          <div className="msgs">
            <div className="sysmsg">Be kind. Never send money to anyone in chat.</div>
            {msgs.map((m) => (
              <div key={m.id} className={`msg${m.user_id === me ? " mine" : ""}`}>
                <div className="bub"><b>{m.user_id === me ? "You" : m.profiles?.full_name || "Member"}</b>
                  <small>{new Date(m.created_at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}</small>
                  <p>{m.body}</p>
                  {m.user_id !== me && <button className="linkbtn" onClick={() => report(m)}>Report</button>}
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
          <form className="composer" onSubmit={send}>
            <input value={text} onChange={(e) => setText(e.target.value)} disabled={!canPost}
              placeholder={canPost ? `Message ${room?.name ?? ""}` : "Only admins can post here"} aria-label="Message" />
            <button className="btn primary" disabled={!canPost}>Send</button>
          </form>
          <p className="err" role="alert">{error}</p>
        </div>
      </div>
    </section>
  );
}
