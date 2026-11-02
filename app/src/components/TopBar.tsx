import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { disablePush, enablePush, pushEnabled } from "../lib/push";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { uploadPhoto } from "../lib/media";
import Avatar from "./Avatar";
import Icon from "./Icon";

type Note = { id: number; kind: string; body: string; link: string | null; read_at: string | null; created_at: string; actor?: { full_name: string; avatar_url: string | null } | null };

const ALERTS_KEY = "bcil-alerts";
const alertsOn = () => { try { return ["on", "push"].includes(localStorage.getItem(ALERTS_KEY) ?? "") && "Notification" in window && Notification.permission === "granted"; } catch { return false; } };

// Show a phone/computer alert for a new notification (while the app is open or in the background)
async function systemAlert(n: Note) {
  if (!alertsOn() || localStorage.getItem(ALERTS_KEY) === "push") return;   // phone notifications already show it
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: n.body, icon: `${import.meta.env.BASE_URL}icon-192.png`, tag: `bcil-${n.id}`, data: { link: n.link } };
    if (reg) await reg.showNotification("BCIL Live", opts); else new Notification("BCIL Live", opts);
  } catch { /* alerts are best-effort */ }
}

export function timeAgo(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d} d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function TopBar() {
  const { session } = useAuth();
  const me = session!.user.id;
  const nav = useNavigate();
  const [open, setOpen] = useState<"" | "bell" | "me">("");
  const [editNow, setEditNow] = useState(false);
  // other pages can open "Edit name and photo" (e.g. the Home nudge to add a photo)
  useEffect(() => { const f = () => { setEditNow(true); setOpen("me"); }; window.addEventListener("bcil-edit-profile", f); return () => window.removeEventListener("bcil-edit-profile", f); }, []);
  const [notes, setNotes] = useState<Note[]>([]);
  const [unreadChats, setUnreadChats] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  // notifications
  async function loadNotes() {
    const { data } = await supabase.from("notifications")
      .select("id, kind, body, link, read_at, created_at, actor:profiles!notifications_actor_id_fkey(full_name, avatar_url)")
      .order("created_at", { ascending: false }).limit(40);
    setNotes((data ?? []) as unknown as Note[]);
  }
  // unread chat messages (for the dot on the chat button)
  async function loadUnread() {
    const { data } = await supabase.rpc("my_unread");
    setUnreadChats(((data ?? []) as { n: number }[]).reduce((a, r) => a + r.n, 0));
  }
  useEffect(() => {
    loadNotes(); loadUnread();
    let t: ReturnType<typeof setTimeout> | undefined;
    const ch = supabase.channel(`me:${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${me}` },
        (p) => { loadNotes(); systemAlert(p.new as Note); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" },
        () => { clearTimeout(t); t = setTimeout(loadUnread, 800); })
      .subscribe();
    const onRead = () => loadUnread();
    window.addEventListener("bcil-read", onRead);
    return () => { supabase.removeChannel(ch); window.removeEventListener("bcil-read", onRead); clearTimeout(t); };
  }, [me]);

  // close the panels when tapping elsewhere
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(""); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(""); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const unread = notes.filter((n) => !n.read_at).length;
  async function openBell() {
    setOpen(open === "bell" ? "" : "bell");
    if (unread) {
      setNotes((cur) => cur.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    }
  }
  async function clearAll() {
    setNotes([]);
    await supabase.from("notifications").delete().eq("user_id", me);
  }

  return (
    <div className="topacts" ref={wrap}>
      <button className={`iconbtn${open === "bell" ? " on" : ""}`} onClick={openBell} aria-label={`Notifications${unread ? `, ${unread} new` : ""}`}>
        <Icon name="bell" />{unread > 0 && <span className="count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      <button className="iconbtn" onClick={() => { setOpen(""); nav("/chat"); }} aria-label={`Chat${unreadChats ? ", new messages" : ""}`}>
        <Icon name="chat" />{unreadChats > 0 && <span className="dot" />}
      </button>
      <MeButton active={open === "me"} onClick={() => setOpen(open === "me" ? "" : "me")} />

      {open === "bell" && (
        <div className="pop notes" role="dialog" aria-label="Notifications">
          <div className="pophead"><b>Notifications</b>{notes.length > 0 && <button className="linkbtn" onClick={clearAll}>Clear all</button>}</div>
          {notes.length === 0 ? <p className="muted popempty">You are all caught up.</p> : (
            <div className="notelist">
              {notes.map((n) => (
                <button key={n.id} className="note" onClick={() => { setOpen(""); if (n.link) nav(n.link); }}>
                  {n.kind === "live" ? <span className="avatar livedot">LIVE</span> : <Avatar name={n.actor?.full_name} url={n.actor?.avatar_url} size={38} />}
                  <span className="grow"><span>{n.body}</span><small className="muted">{timeAgo(n.created_at)}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {open === "me" && <ProfileMenu startEditing={editNow} onClose={() => { setOpen(""); setEditNow(false); }} />}
    </div>
  );
}

function MeButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  const { profile } = useAuth();
  return (
    <button className={`mebtn${active ? " on" : ""}`} onClick={onClick} aria-label="Your account" aria-expanded={active}>
      <Avatar name={profile?.full_name} url={profile?.avatar_url} size={40} />
    </button>
  );
}

function ProfileMenu({ onClose, startEditing = false }: { onClose: () => void; startEditing?: boolean }) {
  const { session, profile } = useAuth();
  const [editing, setEditing] = useState(startEditing);
  const [theme, setT] = useState<Theme>(getTheme());
  const [alerts, setAlerts] = useState(alertsOn());
  const [msg, setMsg] = useState("");
  const nav = useNavigate();

  function cycleTheme() {
    const next: Theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
    setT(next); setTheme(next);
  }
  useEffect(() => { pushEnabled().then((on) => { if (on) setAlerts(true); }); }, []);
  async function toggleAlerts() {
    setMsg("");
    try {
      if (alerts) { await disablePush(); localStorage.setItem(ALERTS_KEY, "off"); setAlerts(false); return; }
      await enablePush(session!.user.id);
      localStorage.setItem(ALERTS_KEY, "push"); setAlerts(true);
      setMsg("Done. You'll get a notification on this device for the daily quote, when BCIL goes live, programme reminders and messages.");
    } catch (e) { setMsg((e as Error).message); }
  }

  async function deleteAccount() {
    const typed = window.prompt("This permanently deletes your BCIL Live account, your messages, posts and friends. It cannot be undone.\n\nType DELETE to confirm.");
    if (typed?.trim().toUpperCase() !== "DELETE") return;
    const { error } = await supabase.rpc("delete_my_account");
    if (error) { setMsg("Could not delete your account: " + error.message); return; }
    await supabase.auth.signOut();
    alert("Your account has been deleted.");
  }

  if (editing) return <EditProfile onDone={() => setEditing(false)} />;
  return (
    <div className="pop memenu" role="dialog" aria-label="Your account">
      <div className="mehead">
        <Avatar name={profile?.full_name} url={profile?.avatar_url} size={52} />
        <div className="grow"><b>{profile?.full_name || "Your name"}</b><small className="muted">{session?.user.email ?? session?.user.phone}</small></div>
        <span className="tick"><Icon name="check" size={20} /></span>
      </div>
      <button className="menubtn" onClick={() => setEditing(true)}><Icon name="pencil" size={18} />Edit name and photo</button>
      <button className="menubtn" onClick={() => { onClose(); nav("/friends"); }}><Icon name="users" size={18} />Friends</button>
      <div className="menurow"><span>Appearance</span>
        <button className="chipbtn" onClick={cycleTheme} aria-label={`Appearance: ${theme}. Tap to change`}><Icon name="sun" size={16} />{theme.toUpperCase()}</button>
      </div>
      <div className="menurow"><span>Alerts on this device<small className="muted">{alerts ? "On" : "Off"}</small></span>
        <button className={`switch${alerts ? " on" : ""}`} role="switch" aria-checked={alerts} onClick={toggleAlerts} aria-label="Alerts on this device"><span /></button>
      </div>
      {msg && <p className="err">{msg}</p>}
      <button className="menubtn danger" onClick={() => supabase.auth.signOut()}><Icon name="logout" size={18} />Sign out</button>
      <div className="menufoot">
        <a href={`${import.meta.env.BASE_URL}privacy`} onClick={(e) => { e.preventDefault(); onClose(); nav("/privacy"); }}>Privacy</a>
        <button className="linkbtn" onClick={deleteAccount}>Delete my account</button>
      </div>
    </div>
  );
}

function EditProfile({ onDone }: { onDone: () => void }) {
  const { session, profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [photo, setPhoto] = useState<string | null>(profile?.avatar_url ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  async function pick(f?: File) {
    if (!f) return;
    setBusy(true); setErr("");
    try { setPhoto(await uploadPhoto(session!.user.id, f, 512)); }
    catch (e) { setErr((e as Error).message || "Could not upload that photo."); }
    setBusy(false);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Please enter your name."); return; }
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ full_name: name.trim(), bio: bio.trim() || null, avatar_url: photo }).eq("id", session!.user.id);
    setBusy(false);
    if (error) { setErr("Could not save. Check your connection and try again."); return; }
    await refreshProfile(); onDone();
  }
  return (
    <form className="pop memenu" onSubmit={save} aria-label="Edit name and photo">
      <div className="pophead"><b>Edit name and photo</b><button type="button" className="iconbtn sm" onClick={onDone} aria-label="Close"><Icon name="x" size={18} /></button></div>
      <div className="photoedit">
        <Avatar name={name} url={photo} size={84} />
        <div className="col">
          <button type="button" className="btn ghost" onClick={() => file.current?.click()} disabled={busy}>{busy ? "Uploading…" : photo ? "Change photo" : "Add a photo"}</button>
          {photo && <button type="button" className="linkbtn" onClick={() => setPhoto(null)}>Remove photo</button>}
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <label className="field">Your name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></label>
      <label className="field">About you <small className="muted">(optional)</small>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} placeholder="e.g. Level 200, KNUST · BCIL Campus Sync" style={{ minHeight: 70 }} /></label>
      {err && <p className="err">{err}</p>}
      <button className="btn primary" disabled={busy}>Save</button>
    </form>
  );
}
