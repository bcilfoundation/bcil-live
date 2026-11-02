import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Privacy from "./pages/Privacy";
import Thanks from "./pages/Thanks";
import { useAuth } from "./lib/auth";
import { isNative } from "./lib/native";
import Icon from "./components/Icon";
import { LiveProvider, useLive } from "./lib/LiveContext";
import TopBar from "./components/TopBar";
import UpdateBanner from "./components/UpdateBanner";
import GetApp, { APK, isAndroid, isIOS } from "./components/GetApp";
import { startNativePush } from "./lib/push";
import SignIn from "./pages/SignIn";
import Home from "./pages/Home";
import Chat from "./pages/Chat";
import Forms from "./pages/Forms";
import Give, { MOMO } from "./pages/Give";
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
const Shop = lazy(() => import("./pages/Shop"));
const Team = lazy(() => import("./pages/Team"));
const Search = lazy(() => import("./pages/Search"));

import { paymentsOn } from "./lib/pay";

const NAV = ([
  ["/", "Home"], ["/quotes", "Daily Bite"], ["/events", "Programmes"], ["/live", "Live"], ["/library", "Library"], ["/reading", "Reading room"], ["/shop", "Bookshop"],
  ["/chat", "Chat"], ["/groups", "Groups"], ["/campus", "Campus Sync"], ["/friends", "Friends"], ["/forms", "Forms"], ["/about", "About us"], ["/donate", "Donate"],
] as const);

const ICONS: Record<string, string> = { "/events": "calendar", "/": "home", "/live": "live", "/library": "library", "/reading": "book", "/quotes": "quote", "/chat": "chat", "/groups": "users", "/campus": "pin", "/friends": "userplus", "/forms": "form", "/donate": "gift", "/admin": "shield", "/shop": "cart", "/about": "star" };

export default function App() {
  const { session, loading, isStaff } = useAuth();
  const go = useNavigate();
  // Android app: notifications (asks once), and taps on a notification open the right page
  useEffect(() => { if (session) startNativePush(session.user.id, (url) => go(url.replace(/^https?:\/\/[^/]+/, ""))); }, [session?.user.id]);
  const nav = NAV.filter(([to]) => to !== "/donate" || paymentsOn(isStaff) || !!MOMO);
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
        <GetApp />
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
            <Route path="/donate" element={<Give />} />
            <Route path="/give" element={<Navigate to="/donate" replace />} />
            <Route path="/library" element={<Library />} />
            <Route path="/reading" element={<Reading />} />
            <Route path="/fcb" element={<Navigate to="/events/fcb2027" replace />} />
            <Route path="/events" element={<Events />} />
            <Route path="/events/:slug" element={<Event />} />
            <Route path="/checkin" element={<CheckIn />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/about" element={<Team />} />
            <Route path="/team" element={<Navigate to="/about" replace />} />
            <Route path="/search" element={<Search />} />
            <Route path="/quotes" element={<Quotes />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/more" element={
              <section className="view"><h1>More</h1>
                <div className="list morelist">
                  <NavLink to="/about"><Icon name="star" size={22} />About us</NavLink>
                  <NavLink to="/events"><Icon name="calendar" size={22} />Programmes</NavLink>
                  <NavLink to="/forms?form=join-campus-sync"><Icon name="userplus" size={22} /><span className="grow">Join us<small className="muted">Become a member through Campus Sync</small></span></NavLink>
                  <NavLink to="/forms?form=fcb27-volunteer"><Icon name="users" size={22} /><span className="grow">Volunteer for FCB 27<small className="muted">Serve at Finding Campus Balance 2027</small></span></NavLink>
                </div>
                <div className="list morelist">
                  <NavLink to="/reading"><Icon name="book" size={22} />Reading room</NavLink>
                  <NavLink to="/shop"><Icon name="cart" size={22} />Bookshop</NavLink>
                  {isStaff && <NavLink to="/admin"><Icon name="shield" size={22} />Admin</NavLink>}
                </div>
                {!isNative && isAndroid && <a className="btn primary" href={APK} download>Get the Android app</a>}
                {!isNative && isIOS && <p className="muted small">On iPhone: tap ⬆︎ Share in Safari, then <b>Add to Home Screen</b> to install BCIL Live.</p>}
                {!isNative && !isAndroid && !isIOS && <p className="muted small">On your phone, open live.bcilfoundation.org to install the app (Android) or add it to your Home Screen (iPhone).</p>}
                <p className="app-version">BCIL Live · version {__APP_VERSION__}</p></section>} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
          </Suspense>
        </main>
      </div>
      <MiniPlayer />
      <nav className="tabbar">
        {([["/", "Home", "home"], ["/live", "Live", "live"], ["/library", "Library", "library"], ["/groups", "Groups", "users"], ["/donate", "Donate", "gift"], ["/more", "More", "more"]] as const).map(([to, label, icon]) =>
          <NavLink key={to} to={to} end={to === "/"}
            className={({ isActive }) => (isActive || (to === "/groups" && /^\/(chat|campus|friends|join)/.test(pathname)) || (to === "/library" && /^\/(reading|shop)/.test(pathname)) ? "active" : "")}>
            <Icon name={icon} size={24} /><span>{label}</span></NavLink>)}
      </nav>
    </div>
    </LiveProvider>
  );
}

// Small bar above the tabs while a live session is on, so people keep listening anywhere in the app.
// It can shrink to a small round bubble that you drag out of the way (it shrinks by itself in chats).
const CHAT_PATH = /^\/(chat|groups\/)/;
function MiniPlayer() {
  const L = useLive();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const inChat = CHAT_PATH.test(pathname);
  const [small, setSmall] = useState(() => { try { return localStorage.getItem("bcil.mp.small") === "1"; } catch { return false; } });
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => { try { return JSON.parse(localStorage.getItem("bcil.mp.pos") || "null"); } catch { return null; } });
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  useEffect(() => { try { localStorage.setItem("bcil.mp.small", small ? "1" : "0"); } catch { /* private mode */ } }, [small]);
  if (!L.live || pathname === "/live") return null;
  const amHost = L.live.host_id === L.me;
  const status = L.joined ? (L.speaker ? (amHost ? "You're hosting" : "You're on stage") : L.needTap ? "Tap 🔊 to hear" : "Listening live") : "BCIL is live now";

  if (small || inChat) {
    const clamp = (x: number, y: number) => ({ x: Math.max(6, Math.min(window.innerWidth - 62, x)), y: Math.max(60, Math.min(window.innerHeight - 140, y)) });
    const here = pos ? clamp(pos.x, pos.y) : null;
    return (
      <button className="mp-bubble" aria-label={`${L.live.title}, ${status}. Tap to open, drag to move.`}
        style={here ? { left: here.x, top: here.y, right: "auto", bottom: "auto" } : undefined}
        onPointerDown={(e) => { const r = e.currentTarget.getBoundingClientRect(); drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { const d = drag.current; if (!d) return; const n = clamp(e.clientX - d.dx, e.clientY - d.dy);
          if (!d.moved && here && Math.abs(n.x - here.x) + Math.abs(n.y - here.y) < 6) return; d.moved = true; setPos(n); }}
        onPointerUp={() => { const d = drag.current; drag.current = null;
          if (d?.moved) { try { localStorage.setItem("bcil.mp.pos", JSON.stringify(pos)); } catch { /* ignore */ } return; }
          if (inChat) nav("/live"); else setSmall(false); }}>
        <span className="mp-dot" aria-hidden="true" />
        <span className="mp-ico" aria-hidden="true">{L.joined && L.speaker ? (L.muted ? "🔇" : "🎙") : "🎧"}</span>
      </button>
    );
  }
  return (
    <div className="miniplayer" role="region" aria-label="Live session">
      <button className="mp-main" onClick={() => nav("/live")}>
        <span className="mp-dot" aria-hidden="true" />
        <span className="mp-text"><b>{L.live.title}</b><small>{status}</small></span>
      </button>
      {L.joined && L.needTap && <button className="mp-btn" onClick={L.tapToHear} aria-label="Tap to hear">🔊</button>}
      {L.joined && L.speaker && <button className="mp-btn" onClick={L.toggleMute} aria-label={L.muted ? "Unmute" : "Mute"}>{L.muted ? "🔇" : "🎙"}</button>}
      {!L.joined && <button className="mp-btn join" onClick={() => (L.live?.kind === "video" ? nav("/live") : L.join())}>Join</button>}
      {L.joined && !amHost && <button className="mp-btn" onClick={L.leaveRoom} aria-label="Leave">✕</button>}
      <button className="mp-btn" onClick={() => setSmall(true)} aria-label="Shrink to a small bubble">⌄</button>
    </div>
  );
}
