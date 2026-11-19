import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import Tick from "../components/Tick";
import NewsletterSwitch from "../components/NewsletterSwitch";
import FingerprintSetting from "../components/FingerprintSetting";
import WallpaperSheet from "../components/WallpaperSheet";
import { AccountSwitch, ALERTS_KEY, EditProfile, alertsOn } from "../components/TopBar";
import { disablePush, enablePush, pushEnabled } from "../lib/push";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { getWall, WALLS } from "../lib/wallpaper";
import { savedAccounts, signOutHere } from "../lib/accounts";
import { startTour } from "../components/Tour";

// Your profile and settings: one page with a list, each line opening its own page.
const SECTIONS: Record<string, string> = {
  accounts: "Switch account", notifications: "Notifications", appearance: "Appearance and chat wallpaper",
  saved: "Photos and saved", privacy: "Privacy and security", profile: "Complete your profile",
};

export default function Settings() {
  const { section } = useParams();
  const nav = useNavigate();
  const { session, profile, realStaff, viewAsMember, setViewAsMember } = useAuth();
  const [editing, setEditing] = useState(false);
  const [requests, setRequests] = useState(0);
  const [alerts, setAlerts] = useState(alertsOn());
  const me = session!.user.id;
  useEffect(() => {
    supabase.from("friendships").select("id", { count: "exact", head: true }).eq("addressee", me).eq("status", "pending").then(({ count }) => setRequests(count ?? 0));
    pushEnabled().then((on) => { if (on) setAlerts(true); });
  }, [me]);
  if (section && SECTIONS[section]) return (
    <section className="view settings">
      <button className="backbtn" onClick={() => nav("/settings")} aria-label="Back to settings"><Icon name="back" size={20} /></button>
      <h1>{SECTIONS[section]}</h1>
      {section === "accounts" && <div className="card setcard"><AccountSwitch me={me} onClose={() => {}} /></div>}
      {section === "notifications" && <Notifications alerts={alerts} setAlerts={setAlerts} />}
      {section === "appearance" && <Appearance />}
      {section === "saved" && <Saved />}
      {section === "privacy" && <Privacy />}
      {section === "profile" && <ProfileSteps onEdit={() => { nav("/settings"); setEditing(true); }} />}
    </section>
  );
  const steps = profileSteps(profile);
  const done = steps.filter((s) => s.done).length;
  const share = async () => {
    const data = { title: "BCIL Foundation", text: "Join me on the BCIL Foundation app: live sessions, mentorship, Plan 2027 and more.", url: "https://live.bcilfoundation.org" };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); alert("Link copied. Paste it to share."); } } catch { /* cancelled */ }
  };
  const theme = getTheme();
  const nextTheme: Theme = theme === "dark" ? "light" : theme === "light" ? "auto" : "dark";
  const accounts = savedAccounts().filter((a) => a.id !== me).length;
  return (
    <section className="view settings">
      <div className="card setme">
        <button className="setava" onClick={() => setEditing(true)} aria-label="Change your photo">
          <Avatar name={profile?.full_name} url={profile?.avatar_url} size={64} /><span className="setcam" aria-hidden="true">📷</span></button>
        <div className="grow"><b className="setname">{profile?.full_name || "Your name"}<Tick id={me} size={16} /></b>
          <small className="muted">{profile?.is_org ? "Official BCIL Foundation account" : session?.user.email ?? session?.user.phone}</small></div>
      </div>
      {editing && <div className="settings-edit"><EditProfile onDone={() => setEditing(false)} /></div>}
      <div className="setquick">
        <button onClick={() => setEditing(true)}><span><Icon name="pencil" size={20} /></span>Edit</button>
        <button onClick={share}><span>🔗</span>Invite</button>
        <button onClick={() => nav("/settings/notifications")}><span><Icon name="bell" size={20} /></span>Alerts</button>
        <button onClick={() => { setTheme(nextTheme); nav("/settings", { replace: true }); location.reload(); }}><span>{theme === "light" ? "☀️" : theme === "dark" ? "🌙" : "🌓"}</span>{theme === "auto" ? "Auto" : theme === "dark" ? "Dark" : "Light"}</button>
      </div>
      <div className="card setlist">
        <Row to="/settings/accounts" icon="🔁" label="Switch account" value={accounts ? `${accounts + 1} accounts` : "Add an account"} />
        <Row to="/settings/notifications" icon="🔔" label="Notifications" value={alerts ? "On" : "Off"} />
        <Row to="/settings/appearance" icon="🎨" label="Appearance and chat wallpaper" />
        <Row to="/friends" icon="👥" label="Friends and people" badge={requests} />
        <Row to="/settings/saved" icon="🔖" label="Photos and saved" />
        <Row to="/giving" icon="🎁" label="My giving" />
        <Row to="/settings/privacy" icon="🔒" label="Privacy and security" />
      </div>
      <div className="card setlist">
        <Row to="/settings/profile" icon="📋" label="Complete your profile" value={`${done} of ${steps.length}`} />
        <button className="setrow" onClick={startTour}><span className="seticon">🧭</span><span className="grow">Take the tour</span><span className="chev">›</span></button>
        {realStaff && <button className="setrow" onClick={() => { setViewAsMember(!viewAsMember); nav("/"); }}><span className="seticon">👁</span><span className="grow">{viewAsMember ? "Back to admin view" : "View as member"}</span><span className="chev">›</span></button>}
      </div>
      <button className="btn ghost block danger" onClick={() => signOutHere()}>Sign out</button>
      <p className="app-version"><Link to="/privacy">Privacy policy</Link> · BCIL Foundation · version {__APP_VERSION__}</p>
    </section>
  );
}

function Row({ to, icon, label, value, badge }: { to: string; icon: string; label: string; value?: string; badge?: number }) {
  return (
    <Link className="setrow" to={to}><span className="seticon" aria-hidden="true">{icon}</span><span className="grow">{label}</span>
      {!!badge && <span className="setbadge">{badge}</span>}{value && <small className="muted">{value}</small>}<span className="chev" aria-hidden="true">›</span></Link>
  );
}

function Switch({ on, onChange, label, busy }: { on: boolean; onChange: () => void; label: string; busy?: boolean }) {
  return <button className={`switch${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={label} disabled={busy} onClick={onChange}><span /></button>;
}

function Notifications({ alerts, setAlerts }: { alerts: boolean; setAlerts: (b: boolean) => void }) {
  const { session, profile, refreshProfile } = useAuth();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setMsg(""); setBusy(true);
    try {
      if (alerts) { await disablePush(); localStorage.setItem(ALERTS_KEY, "off"); setAlerts(false); }
      else { await enablePush(session!.user.id); localStorage.setItem(ALERTS_KEY, "push"); setAlerts(true); setMsg("Done. Notifications are on for this device."); }
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }
  async function quotes() {
    await supabase.from("profiles").update({ notify_quotes: !(profile?.notify_quotes ?? true) }).eq("id", session!.user.id);
    refreshProfile();
  }
  return (
    <>
      <div className="card setlist">
        <div className="setrow"><span className="seticon">🔔</span><span className="grow">Notifications on this device<small className="muted">Messages, live sessions, programme reminders</small></span><Switch on={alerts} onChange={toggle} busy={busy} label="Notifications on this device" /></div>
        <div className="setrow"><span className="seticon">✨</span><span className="grow">Daily Bite<small className="muted">A short quote every morning</small></span><Switch on={profile?.notify_quotes ?? true} onChange={quotes} label="Daily Bite notifications" /></div>
      </div>
      {msg && <p className="muted small">{msg}</p>}
      <NewsletterSwitch />
      <p className="muted small">To quiet one chat, open it, tap its name, then Mute.</p>
    </>
  );
}

function Appearance() {
  const { session } = useAuth();
  const [t, setT] = useState<Theme>(getTheme());
  const [wall, setWall] = useState(false);
  const cur = getWall(session!.user.id, null);
  const wallName = /^https?:/.test(cur) ? "Your photo" : WALLS.find((w) => w.id === cur)?.name ?? "Plain";
  return (
    <div className="card setlist">
      <div className="setrow"><span className="seticon">🎨</span><span className="grow">Appearance</span>
        <div className="seg mini" role="tablist">{(["auto", "light", "dark"] as Theme[]).map((x) => (
          <button key={x} role="tab" aria-selected={t === x} onClick={() => { setT(x); setTheme(x); }}>{x === "auto" ? "Auto" : x === "light" ? "Light" : "Dark"}</button>))}</div></div>
      <button className="setrow" onClick={() => setWall(true)}><span className="seticon">🖼</span><span className="grow">Chat wallpaper</span><small className="muted">{wallName}</small><span className="chev">›</span></button>
      {wall && <WallpaperSheet me={session!.user.id} room={null} roomName="" onClose={() => setWall(false)} />}
    </div>
  );
}

function Saved() {
  const { session } = useAuth();
  const [talks, setTalks] = useState<{ id: number; title: string }[] | null>(null);
  useEffect(() => {
    supabase.from("talk_saves").select("talk_id, talks(id, title)").eq("user_id", session!.user.id).limit(100)
      .then(({ data }) => setTalks(((data ?? []) as unknown as { talks: { id: number; title: string } | null }[]).map((r) => r.talks).filter(Boolean) as { id: number; title: string }[]));
  }, []);
  return (
    <>
      <div className="card setlist">
        <Row to="/photos" icon="🖼" label="Photos" />
        <Row to="/reading" icon="📚" label="Reading room" />
      </div>
      <h3 className="setsub">Saved talks</h3>
      <div className="card setlist">
        {talks === null ? <p className="muted pad">Loading…</p> : talks.length ? talks.map((t) => <Row key={t.id} to={`/library?talk=${t.id}`} icon="🎧" label={t.title} />)
          : <p className="muted pad small">Talks you save in the Library show here.</p>}
      </div>
    </>
  );
}

function Privacy() {
  const { session, profile, refreshProfile } = useAuth();
  const me = session!.user.id;
  const [blocked, setBlocked] = useState<{ id: string; name: string; avatar: string | null }[] | null>(null);
  const [msg, setMsg] = useState("");
  const loadBlocked = async () => {
    const { data } = await supabase.from("blocks").select("blocked").eq("blocker", me);
    const ids = ((data ?? []) as { blocked: string }[]).map((b) => b.blocked);
    if (!ids.length) { setBlocked([]); return; }
    const { data: ps } = await supabase.from("profiles").select("id, full_name, avatar_url").in("id", ids);
    setBlocked(((ps ?? []) as { id: string; full_name: string; avatar_url: string | null }[]).map((p) => ({ id: p.id, name: p.full_name, avatar: p.avatar_url })));
  };
  useEffect(() => { loadBlocked(); }, []);
  async function set(col: string, value: unknown) {
    const { error } = await supabase.from("profiles").update({ [col]: value }).eq("id", me);
    if (error) setMsg("Could not save that. Try again."); else refreshProfile();
  }
  return (
    <>
      <h3 className="setsub">Chats</h3>
      <div className="card setlist">
        <div className="setrow"><span className="grow">Read receipts<small className="muted">People see when you've read their messages, and you see when they've read yours. Turn off to do neither.</small></span>
          <Switch on={profile?.read_receipts ?? true} onChange={() => set("read_receipts", !(profile?.read_receipts ?? true))} label="Read receipts" /></div>
        <div className="setrow"><span className="grow">Show when I'm online<small className="muted">People in a chat see that you're online while it's open. Turn off to stay hidden.</small></span>
          <Switch on={profile?.show_online ?? true} onChange={() => set("show_online", !(profile?.show_online ?? true))} label="Show when I'm online" /></div>
      </div>
      <h3 className="setsub">People</h3>
      <div className="card setlist">
        <div className="setrow col"><span className="grow">Who can find me<small className="muted">Who can find you by name to add you as a friend. The BCIL team and mentors can always find you.</small></span>
          <div className="seg mini" role="tablist">{([["everyone", "Everyone"], ["friends_of_friends", "Friends of friends"], ["nobody", "No one"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={(profile?.discoverable ?? "everyone") === k} onClick={() => set("discoverable", k)}>{l}</button>))}</div></div>
        <div className="setrow col"><span className="grow">Blocked people<small className="muted">They can't message you, add you or see your statuses.</small></span>
          {blocked === null ? <small className="muted">Loading…</small> : blocked.length === 0 ? <small className="muted">No one</small>
            : blocked.map((b) => <div key={b.id} className="row blockrow"><Avatar name={b.name} url={b.avatar} size={32} /><span className="grow">{b.name}</span>
              <button className="btn ghost sm" onClick={async () => { await supabase.from("blocks").delete().eq("blocker", me).eq("blocked", b.id); loadBlocked(); }}>Unblock</button></div>)}
        </div>
      </div>
      <h3 className="setsub">Security</h3>
      <FingerprintSetting />
      <div className="card setlist">
        <button className="setrow" onClick={async () => { if (!window.confirm("Sign out of BCIL Foundation on every other phone and computer?")) return; await supabase.auth.signOut({ scope: "others" }); setMsg("Signed out on your other devices."); }}>
          <span className="seticon">📱</span><span className="grow">Sign out on other devices<small className="muted">Use this if you lost a phone or signed in somewhere else</small></span><span className="chev">›</span></button>
        <Row to="/privacy" icon="📄" label="Privacy policy" />
      </div>
      {msg && <p className="muted small">{msg}</p>}
    </>
  );
}

function profileSteps(p: ReturnType<typeof useAuth>["profile"]) {
  if (p?.is_org) return [
    { key: "photo", label: "Add the BCIL logo as the photo", done: !!p?.avatar_url },
    { key: "bio", label: "Write a short description", done: !!p?.bio?.trim() },
    { key: "alerts", label: "Turn on notifications", done: alertsOn() },
  ];
  return [
    { key: "photo", label: "Add a profile photo", done: !!p?.avatar_url },
    { key: "name", label: "Use your full name", done: (p?.full_name ?? "").trim().split(/\s+/).length >= 2 },
    { key: "bio", label: "Write a short bio", done: !!p?.bio?.trim() },
    { key: "birthday", label: "Add your birthday", done: !!p?.birthday_month && !!p?.birthday_day },
    { key: "gender", label: "Add your gender", done: !!p?.gender },
    { key: "alerts", label: "Turn on notifications", done: alertsOn() },
  ];
}
function ProfileSteps({ onEdit }: { onEdit: () => void }) {
  const { profile } = useAuth();
  const nav = useNavigate();
  const steps = profileSteps(profile);
  return (
    <div className="card setlist">
      {steps.map((s) => (
        <button key={s.key} className="setrow" onClick={() => (s.key === "alerts" ? nav("/settings/notifications") : onEdit())}>
          <span className="seticon">{s.done ? "✅" : "⬜"}</span><span className="grow">{s.label}</span>{!s.done && <span className="chev">›</span>}</button>
      ))}
    </div>
  );
}
