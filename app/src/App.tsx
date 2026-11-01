import { lazy, Suspense } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Privacy from "./pages/Privacy";
import Thanks from "./pages/Thanks";
import { useAuth } from "./lib/auth";
import { isNative } from "./lib/native";
import Icon from "./components/Icon";
import { LiveProvider, useLive } from "./lib/LiveContext";
import TopBar from "./components/TopBar";
import UpdateBanner from "./components/UpdateBanner";
import { startNativePush } from "./lib/push";
import { useEffect } from "react";
import SignIn from "./pages/SignIn";
import Home from "./pages/Home";
import Chat from "./pages/Chat";
import Forms from "./pages/Forms";
import Give from "./pages/Give";
import Library from "./pages/Library";
import Quotes from "./pages/Quotes";
import Friends from "./pages/Friends";
import Groups, { GroupPage, JoinWithLink } from "./pages/Groups";
// Live (audio library) and Admin load only when opened, to keep the app light on mobile data
const Live = lazy(() => import("./pages/Live"));
const Admin = lazy(() => import("./pages/Admin"));
const Reading = lazy(() => import("./pages/Reading"));
const Event = lazy(() => import("./pages/Event"));
const Events = lazy(() => import("./pages/Events"));
const CheckIn = lazy(() => import("./pages/CheckIn"));

import { paymentsOn } from "./lib/pay";

const NAV = ([
  ["/", "Home"], ["/events", "Programmes"], ["/live", "Live"], ["/library", "Library"], ["/reading", "Reading room"], ["/quotes", "Daily Quotes"],
  ["/chat", "Chat"], ["/groups", "Groups"], ["/campus", "Campus Sync"], ["/friends", "Friends"], ["/forms", "Forms"], ["/give", "Give"],
] as const);

const ICONS: Record<string, string> = { "/events": "calendar", "/": "home", "/live": "live", "/library": "library", "/reading": "book", "/quotes": "quote", "/chat": "chat", "/groups": "users", "/campus": "pin", "/friends": "userplus", "/forms": "form", "/give": "gift", "/admin": "shield" };

export default function App() {
  const { session, loading, isStaff } = useAuth();
  const go = useNavigate();
  // Android app: notifications (asks once), and taps on a notification open the right page
  useEffect(() => { if (session) startNativePush(session.user.id, (url) => go(url.replace(/^https?:\/\/[^/]+/, ""))); }, [session?.user.id]);
  const nav = NAV.filter(([to]) => to !== "/give" || paymentsOn(isStaff));
  const { pathname } = useLocation();
  // the privacy policy is public, so the app stores and visitors can read it without signing in
  if (pathname === "/privacy") return <main className="public"><Privacy /></main>;
  if (pathname === "/thanks") return <main className="public"><Thanks /></main>;
  if (loading) return <div className="center muted">Loading…</div>;
  if (!session) return <SignIn />;

  return (
    <LiveProvider>
    <div className="shell">
      <aside className="side">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}logo-wordmark.webp`} alt="BCIL Foundation" /><b>Live</b></div>
        <nav className="menu">
          {nav.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}><Icon name={ICONS[to]} size={20} />{label}</NavLink>)}
          {isStaff && <NavLink to="/admin"><Icon name="shield" size={20} />Admin</NavLink>}
        </nav>
      </aside>
      <div className="app">
        <header className="top">
          <span className="org"><img className="toplogo" src={`${import.meta.env.BASE_URL}logo-wordmark.webp`} alt="" />BCIL Foundation</span>
          <span className="sp" />
          <TopBar />
        </header>
        <UpdateBanner />
        <main className={pathname === "/live" ? "inroom" : ""}>
          <Suspense fallback={<div className="center muted">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/live" element={<Live />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/campus" element={<Groups campus />} />
            <Route path="/groups/:id" element={<GroupPage />} />
            <Route path="/join/:code" element={<JoinWithLink />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/forms" element={<Forms />} />
            <Route path="/give" element={<Give />} />
            <Route path="/library" element={<Library />} />
            <Route path="/reading" element={<Reading />} />
            <Route path="/fcb" element={<Navigate to="/events/fcb2027" replace />} />
            <Route path="/events" element={<Events />} />
            <Route path="/events/:slug" element={<Event />} />
            <Route path="/checkin" element={<CheckIn />} />
            <Route path="/quotes" element={<Quotes />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/more" element={
              <section className="view"><h1>More</h1>
                <div className="list morelist">{nav.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}><Icon name={ICONS[to]} size={22} />{label}</NavLink>)}
                  {isStaff && <NavLink to="/admin"><Icon name="shield" size={22} />Admin</NavLink>}</div>
                {!isNative && <a className="btn primary" href={`${import.meta.env.BASE_URL}bcil-live.apk`} download>Get the Android app</a>}
                <p className="app-version">BCIL Live · version {__APP_VERSION__}</p></section>} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
          </Suspense>
        </main>
      </div>
      <MiniPlayer />
      <nav className="tabbar">
        {([["/", "Home", "home"], ["/live", "Live", "live"], ["/library", "Library", "library"], ["/chat", "Chat", "chat"], ["/more", "More", "more"]] as const).map(([to, label, icon]) =>
          <NavLink key={to} to={to} end={to === "/"}
            className={({ isActive }) => (isActive || (to === "/chat" && /^\/(groups|campus|friends|join)/.test(pathname)) || (to === "/library" && pathname === "/reading") ? "active" : "")}>
            <Icon name={icon} size={24} /><span>{label}</span></NavLink>)}
      </nav>
    </div>
    </LiveProvider>
  );
}

// Small bar above the tabs while a live session is on, so people keep listening anywhere in the app
function MiniPlayer() {
  const L = useLive();
  const { pathname } = useLocation();
  const nav = useNavigate();
  if (!L.live || pathname === "/live") return null;
  const amHost = L.live.host_id === L.me;
  return (
    <div className="miniplayer" role="region" aria-label="Live session">
      <button className="mp-main" onClick={() => nav("/live")}>
        <span className="mp-dot" aria-hidden="true" />
        <span className="mp-text"><b>{L.live.title}</b><small>{L.joined ? (L.speaker ? (amHost ? "You're hosting" : "You're on stage") : L.needTap ? "Tap 🔊 to hear" : "Listening live") : "BCIL is live now"}</small></span>
      </button>
      {L.joined && L.needTap && <button className="mp-btn" onClick={L.tapToHear} aria-label="Tap to hear">🔊</button>}
      {L.joined && L.speaker && <button className="mp-btn" onClick={L.toggleMute} aria-label={L.muted ? "Unmute" : "Mute"}>{L.muted ? "🔇" : "🎙"}</button>}
      {!L.joined && <button className="mp-btn join" onClick={() => (L.live?.kind === "video" ? nav("/live") : L.join())}>Join</button>}
      {L.joined && !amHost && <button className="mp-btn" onClick={L.leaveRoom} aria-label="Leave">✕</button>}
    </div>
  );
}
