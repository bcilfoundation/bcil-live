import { lazy, Suspense } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Privacy from "./pages/Privacy";
import { useAuth } from "./lib/auth";
import { isNative } from "./lib/native";
import Icon from "./components/Icon";
import TopBar from "./components/TopBar";
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

// Turn giving on once Paystack has approved BCIL and the payment functions are deployed
const GIVING_ENABLED = false;

const NAV = ([
  ["/", "Home"], ["/live", "Live"], ["/library", "Library"], ["/quotes", "Daily Quotes"],
  ["/chat", "Chat"], ["/groups", "Groups & Campus Sync"], ["/friends", "Friends"], ["/forms", "Forms"], ["/give", "Give"],
] as const).filter(([to]) => GIVING_ENABLED || to !== "/give");

const ICONS: Record<string, string> = { "/": "home", "/live": "live", "/library": "library", "/quotes": "quote", "/chat": "chat", "/groups": "users", "/friends": "userplus", "/forms": "form", "/give": "gift", "/admin": "shield" };

export default function App() {
  const { session, loading, isStaff } = useAuth();
  const { pathname } = useLocation();
  // the privacy policy is public, so the app stores and visitors can read it without signing in
  if (pathname === "/privacy") return <main className="public"><Privacy /></main>;
  if (loading) return <div className="center muted">Loading…</div>;
  if (!session) return <SignIn />;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}logo-wordmark.webp`} alt="BCIL Foundation" /><b>Live</b></div>
        <nav className="menu">
          {NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}><Icon name={ICONS[to]} size={20} />{label}</NavLink>)}
          {isStaff && <NavLink to="/admin"><Icon name="shield" size={20} />Admin</NavLink>}
        </nav>
      </aside>
      <div className="app">
        <header className="top">
          <span className="org"><img className="toplogo" src={`${import.meta.env.BASE_URL}logo-wordmark.webp`} alt="" />BCIL Foundation</span>
          <span className="sp" />
          <TopBar />
        </header>
        <main>
          <Suspense fallback={<div className="center muted">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/live" element={<Live />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/groups/:id" element={<GroupPage />} />
            <Route path="/join/:code" element={<JoinWithLink />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/forms" element={<Forms />} />
            {GIVING_ENABLED && <Route path="/give" element={<Give />} />}
            <Route path="/library" element={<Library />} />
            <Route path="/quotes" element={<Quotes />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/more" element={
              <section className="view"><h1>More</h1>
                <div className="list morelist">{NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}><Icon name={ICONS[to]} size={22} />{label}</NavLink>)}
                  {isStaff && <NavLink to="/admin"><Icon name="shield" size={22} />Admin</NavLink>}</div>
                {!isNative && <a className="btn primary" href={`${import.meta.env.BASE_URL}bcil-live.apk`} download>Get the Android app</a>}
                <p className="app-version">BCIL Live · version {__APP_VERSION__}</p></section>} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
          </Suspense>
        </main>
      </div>
      <nav className="tabbar">
        {([["/", "Home", "home"], ["/live", "Live", "live"], ["/chat", "Chat", "chat"], ["/groups", "Groups", "users"], ["/more", "More", "more"]] as const).map(([to, label, icon]) =>
          <NavLink key={to} to={to} end={to === "/"}><Icon name={icon} size={24} /><span>{label}</span></NavLink>)}
      </nav>
    </div>
  );
}
