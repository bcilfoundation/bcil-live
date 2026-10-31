import { lazy, Suspense } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { isNative } from "./lib/native";
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

export default function App() {
  const { session, loading, isStaff } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!session) return <SignIn />;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}logo-wordmark.webp`} alt="BCIL Foundation" /><b>Live</b></div>
        <nav className="menu">
          {NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
          {isStaff && <NavLink to="/admin">Admin</NavLink>}
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
                <div className="list">{NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
                  {isStaff && <NavLink to="/admin">Admin</NavLink>}</div>
                {!isNative && <a className="btn primary" href="https://github.com/bcilfoundation/bcil-live/releases/latest/download/bcil-live.apk">Get the Android app</a>}
                <p className="app-version">BCIL Live · version {__APP_VERSION__}</p></section>} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
          </Suspense>
        </main>
      </div>
      <nav className="tabbar">
        {([["/", "Home"], ["/live", "Live"], ["/chat", "Chat"], ["/groups", "Groups"]] as const).map(([to, label]) =>
          <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
        <NavLink to="/more">More</NavLink>
      </nav>
    </div>
  );
}
