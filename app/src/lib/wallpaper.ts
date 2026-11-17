import type { CSSProperties } from "react";
// Chat wallpapers: only on this person's screen. A default for all chats, and an optional one per chat.
export type Wall = string;   // a preset id, or a photo URL
export const WALLS: { id: string; name: string; css: CSSProperties }[] = [
  { id: "none", name: "Plain", css: {} },
  { id: "navy", name: "Navy dots", css: { backgroundColor: "#e8eef8", backgroundImage: "radial-gradient(#c7d4ea 1.3px, transparent 1.3px)", backgroundSize: "18px 18px" } },
  { id: "gold", name: "Gold dots", css: { backgroundColor: "#faf3e3", backgroundImage: "radial-gradient(#ead7a8 1.3px, transparent 1.3px)", backgroundSize: "18px 18px" } },
  { id: "mint", name: "Mint", css: { backgroundColor: "#e3f4ee", backgroundImage: "radial-gradient(#b9e3d3 1.3px, transparent 1.3px)", backgroundSize: "18px 18px" } },
  { id: "rose", name: "Rose", css: { backgroundColor: "#fbecf1", backgroundImage: "radial-gradient(#f1c9d6 1.3px, transparent 1.3px)", backgroundSize: "18px 18px" } },
  { id: "lines", name: "Lines", css: { backgroundColor: "#eef1f6", backgroundImage: "repeating-linear-gradient(45deg, rgba(30,63,120,.06) 0 2px, transparent 2px 16px)" } },
  { id: "night", name: "Night", css: { backgroundColor: "#0e1a2e", backgroundImage: "radial-gradient(rgba(255,255,255,.07) 1.3px, transparent 1.3px)", backgroundSize: "18px 18px" } },
  { id: "forest", name: "Forest", css: { backgroundColor: "#12322a", backgroundImage: "radial-gradient(rgba(255,255,255,.07) 1.3px, transparent 1.3px)", backgroundSize: "18px 18px" } },
];
type Store = { all?: Wall; rooms?: Record<string, Wall> };
const key = (me: string) => `bcil.wall.${me}`;
const read = (me: string): Store => { try { return JSON.parse(localStorage.getItem(key(me)) || "{}"); } catch { return {}; } };
export function getWall(me: string, room?: string | null): Wall { const s = read(me); return (room && s.rooms?.[room]) || s.all || "none"; }
export function hasOwnWall(me: string, room: string) { return !!read(me).rooms?.[room]; }
export function setWall(me: string, w: Wall, room?: string | null) {
  const s = read(me);
  if (room) { s.rooms = { ...(s.rooms ?? {}), [room]: w }; } else { s.all = w; }
  try { localStorage.setItem(key(me), JSON.stringify(s)); } catch { /* */ }
  window.dispatchEvent(new Event("bcil-wall"));
}
export function clearRoomWall(me: string, room: string) {
  const s = read(me); if (s.rooms) delete s.rooms[room];
  try { localStorage.setItem(key(me), JSON.stringify(s)); } catch { /* */ }
  window.dispatchEvent(new Event("bcil-wall"));
}
export function wallStyle(w: Wall): CSSProperties {
  if (/^https?:/.test(w)) return { backgroundImage: `linear-gradient(rgba(0,0,0,.08), rgba(0,0,0,.08)), url("${w}")`, backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "local" };
  return WALLS.find((x) => x.id === w)?.css ?? {};
}
export const isDarkWall = (w: Wall) => w === "night" || w === "forest" || /^https?:/.test(w);
