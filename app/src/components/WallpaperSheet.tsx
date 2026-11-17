import { useRef, useState } from "react";
import { WALLS, clearRoomWall, getWall, hasOwnWall, setWall, wallStyle } from "../lib/wallpaper";
import { uploadPhoto } from "../lib/media";

// Pick a chat wallpaper: for this chat only, or for all chats. Only you see it.
export default function WallpaperSheet({ me, room, roomName, onClose }: { me: string; room: string | null; roomName: string; onClose: () => void }) {
  const [scope, setScope] = useState<"room" | "all">(room && hasOwnWall(me, room) ? "room" : "all");
  const [cur, setCur] = useState(getWall(me, scope === "room" ? room : null));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const choose = (w: string) => { setCur(w); setWall(me, w, scope === "room" ? room : null); };
  async function photo(f?: File | null) {
    if (!f) return; setBusy(true); setErr("");
    try { choose(await uploadPhoto(me, f, 1600)); } catch (e) { setErr((e as Error).message || "Could not use that photo."); }
    setBusy(false);
  }
  return (
    <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Chat wallpaper" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}><h3>Chat wallpaper</h3><button className="iconbtn sm" onClick={onClose} aria-label="Close">✕</button></div>
        {room && <div className="seg" role="tablist">
          <button role="tab" aria-selected={scope === "all"} onClick={() => { setScope("all"); setCur(getWall(me, null)); }}>All chats</button>
          <button role="tab" aria-selected={scope === "room"} onClick={() => { setScope("room"); setCur(getWall(me, room)); }}>Only {roomName.split(" ")[0]}</button>
        </div>}
        <div className="wallgrid">
          {WALLS.map((w) => <button key={w.id} className={`wallopt${cur === w.id ? " on" : ""}`} style={wallStyle(w.id)} onClick={() => choose(w.id)} aria-label={w.name}><span>{w.name}</span></button>)}
          <button className={`wallopt photo${/^https?:/.test(cur) ? " on" : ""}`} style={/^https?:/.test(cur) ? wallStyle(cur) : undefined} onClick={() => pick.current?.click()} disabled={busy} aria-label="Use a photo">
            <span>{busy ? "Uploading…" : "📷 Your photo"}</span></button>
        </div>
        <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { photo(e.target.files?.[0]); e.target.value = ""; }} />
        {room && scope === "room" && hasOwnWall(me, room) && <button className="linkbtn" onClick={() => { clearRoomWall(me, room); setScope("all"); setCur(getWall(me, null)); }}>Use my default wallpaper for this chat</button>}
        <small className="muted">Only you see your wallpaper.</small>
        {err && <p className="err">{err}</p>}
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
