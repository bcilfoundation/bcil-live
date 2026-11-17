import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Avatar from "./Avatar";

// Chat info: call, search, mute, wallpaper, shared media/documents/links, groups in common, report.
type Room = { id: string; name: string; kind: string; avatar?: string | null; cover?: string | null; otherId?: string; members?: number };
type Att = { id: number; attachment_url: string; attachment_name: string | null; attachment_type: string | null; created_at: string };
const LINK = /https?:\/\/[^\s<>()]+/g;

export default function ChatInfo({ room, me, canCall, onCall, onSearch, onWallpaper, onProfile, onGroup, onOpenRoom, onClose }: {
  room: Room; me: string; canCall: boolean; onCall: (k: "audio" | "video") => void; onSearch: () => void; onWallpaper: () => void;
  onProfile: () => void; onGroup: () => void; onOpenRoom: (id: string) => void; onClose: () => void;
}) {
  const [muted, setMuted] = useState<string | null>(null);
  const [tab, setTab] = useState<"media" | "docs" | "links">("media");
  const [atts, setAtts] = useState<Att[] | null>(null);
  const [links, setLinks] = useState<{ url: string; at: string }[]>([]);
  const [common, setCommon] = useState<{ id: string; name: string; cover: string | null }[]>([]);
  const [muteMenu, setMuteMenu] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    supabase.from("room_members").select("muted_until").eq("room_id", room.id).eq("user_id", me).maybeSingle()
      .then(({ data }) => setMuted((data as { muted_until: string | null } | null)?.muted_until ?? null));
    supabase.from("messages").select("id, attachment_url, attachment_name, attachment_type, created_at").eq("room_id", room.id)
      .not("attachment_url", "is", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(90)
      .then(({ data }) => setAtts((data as Att[] | null) ?? []));
    supabase.from("messages").select("body, created_at").eq("room_id", room.id).ilike("body", "%http%").is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(60).then(({ data }) => {
        const out: { url: string; at: string }[] = [];
        for (const m of (data ?? []) as { body: string; created_at: string }[]) for (const u of m.body.match(LINK) ?? []) out.push({ url: u.replace(/[.,!?]+$/, ""), at: m.created_at });
        setLinks(out);
      });
    if (room.kind === "dm" && room.otherId) {
      (async () => {
        const { data: mine } = await supabase.from("room_members").select("room_id").eq("user_id", me);
        const ids = ((mine ?? []) as { room_id: string }[]).map((r) => r.room_id).filter((id) => id !== room.id);
        if (!ids.length) return;
        const { data: theirs } = await supabase.from("room_members").select("room_id").eq("user_id", room.otherId!).in("room_id", ids);
        const both = ((theirs ?? []) as { room_id: string }[]).map((r) => r.room_id);
        if (!both.length) return;
        const { data: rs } = await supabase.from("rooms").select("id, name, kind, cover_url").in("id", both).neq("kind", "dm");
        setCommon(((rs ?? []) as { id: string; name: string; cover_url: string | null }[]).map((r) => ({ id: r.id, name: r.name, cover: r.cover_url })));
      })();
    }
  }, [room.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const isMuted = !!muted && Date.parse(muted) > Date.now() || muted === "infinity";
  async function mute(hours: number | null) {
    setMuteMenu(false);
    const { data, error } = await supabase.rpc("mute_room", { p_room: room.id, p_hours: hours });
    if (error) { setNote("Could not change that. Try again."); return; }
    setMuted((data as string | null) ?? null);
    setNote(hours === null ? "Notifications on" : hours === 0 ? "Muted" : `Muted for ${hours >= 24 ? `${hours / 24} day${hours > 24 ? "s" : ""}` : `${hours} hours`}`);
  }
  async function report() {
    if (!room.otherId || !window.confirm(`Report ${room.name} to the BCIL team?`)) return;
    await supabase.from("reports").insert({ reporter: me, target_type: "user", target_id: room.otherId });
    setNote("Thanks. A moderator will look at it.");
  }
  const media = (atts ?? []).filter((a) => a.attachment_type === "image");
  const docs = (atts ?? []).filter((a) => a.attachment_type !== "image");
  const until = muted && muted !== "infinity" && Date.parse(muted) < 8.64e15 ? new Date(muted).toLocaleString("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
  return (
    <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Chat info" onClick={onClose}>
      <div className="sheet chatinfo" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="iconbtn sm" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="ci-head">
          {room.kind === "dm" ? <Avatar name={room.name} url={room.avatar} size={84} /> : room.cover ? <img className="ci-cover" src={room.cover} alt="" /> : <Avatar name={room.name} size={84} />}
          <h2>{room.name}</h2>
          <small className="muted">{room.kind === "dm" ? "Direct message" : `${room.members ?? ""} members`}</small>
        </div>
        <div className="ci-acts">
          {room.kind === "dm" && canCall && <button onClick={() => onCall("audio")}><span>📞</span>Call</button>}
          {room.kind === "dm" && canCall && <button onClick={() => onCall("video")}><span>🎥</span>Video</button>}
          <button onClick={onSearch}><span>🔍</span>Search</button>
          <button onClick={() => (isMuted ? mute(null) : setMuteMenu((m) => !m))}><span>{isMuted ? "🔕" : "🔔"}</span>{isMuted ? "Unmute" : "Mute"}</button>
          <button onClick={onWallpaper}><span>🖼</span>Wallpaper</button>
        </div>
        {muteMenu && <div className="ci-mute">
          <button className="chip" onClick={() => mute(8)}>8 hours</button><button className="chip" onClick={() => mute(168)}>1 week</button><button className="chip" onClick={() => mute(0)}>Always</button>
        </div>}
        {isMuted && <small className="muted">🔕 Muted{until ? ` until ${until}` : ""}. You won't get alerts for this chat.</small>}
        {note && <small className="ok">{note}</small>}
        <div className="ci-sec">
          <h3>Media, documents and links <span className="muted">{(atts?.length ?? 0) + links.length}</span></h3>
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={tab === "media"} onClick={() => setTab("media")}>Media</button>
            <button role="tab" aria-selected={tab === "docs"} onClick={() => setTab("docs")}>Docs</button>
            <button role="tab" aria-selected={tab === "links"} onClick={() => setTab("links")}>Links</button>
          </div>
          {atts === null ? <p className="muted small">Loading…</p> : tab === "media" ? (
            media.length ? <div className="ci-grid">{media.map((a) => <a key={a.id} href={a.attachment_url} target="_blank" rel="noopener"><img src={a.attachment_url} alt="" loading="lazy" /></a>)}</div> : <p className="muted small">No photos yet.</p>
          ) : tab === "docs" ? (
            docs.length ? <div className="ci-list">{docs.map((a) => <a key={a.id} href={a.attachment_url} target="_blank" rel="noopener">{a.attachment_type === "audio" ? "🎤 Voice note" : `📄 ${a.attachment_name || "File"}`}<small className="muted">{new Date(a.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small></a>)}</div> : <p className="muted small">No documents yet.</p>
          ) : (
            links.length ? <div className="ci-list">{links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noopener">🔗 {l.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}<small className="muted">{new Date(l.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small></a>)}</div> : <p className="muted small">No links yet.</p>
          )}
        </div>
        {room.kind === "dm" && common.length > 0 && <div className="ci-sec">
          <h3>Groups in common <span className="muted">{common.length}</span></h3>
          <div className="ci-list">{common.map((g) => <button key={g.id} className="plainbtn ci-group" onClick={() => onOpenRoom(g.id)}><Avatar name={g.name} url={g.cover} size={36} /><b>{g.name}</b></button>)}</div>
        </div>}
        <div className="ci-sec">
          {room.kind === "dm" ? <button className="btn ghost block" onClick={onProfile}>View profile</button> : <button className="btn ghost block" onClick={onGroup}>Group info and members</button>}
          {room.kind === "dm" && <button className="btn ghost block danger" onClick={report}>⚑ Report {room.name.split(" ")[0]}</button>}
        </div>
      </div>
    </div>
  );
}
