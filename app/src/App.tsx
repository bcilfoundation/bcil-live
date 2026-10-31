import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { initials } from "./lib/supabase";
import SignIn from "./pages/SignIn";
import Home from "./pages/Home";
import Live from "./pages/Live";
import Chat from "./pages/Chat";
import Forms from "./pages/Forms";
import Give from "./pages/Give";
import Library from "./pages/Library";
import Quotes from "./pages/Quotes";
import Admin from "./pages/Admin";

const NAV = [
  ["/", "Home"], ["/live", "Live"], ["/library", "Library"], ["/quotes", "Daily Quotes"],
  ["/chat", "Chat room"], ["/forms", "Forms"], ["/give", "Give"],
] as const;

export default function App() {
  const { session, profile, loading, isStaff } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!session) return <SignIn />;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="mark">BCIL</span><b>BCIL<span>Live</span></b></div>
        <nav className="menu">
          {NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
          {isStaff && <NavLink to="/admin">Admin</NavLink>}
        </nav>
      </aside>
      <div className="app">
        <header className="top">
          <span className="org">BCIL Foundation</span>
          <span className="sp" />
          <button className="me" onClick={() => confirmSignOut()} aria-label="Sign out">{initials(profile?.full_name ?? "")}</button>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/live" element={<Live />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/forms" element={<Forms />} />
            <Route path="/give" element={<Give />} />
            <Route path="/library" element={<Library />} />
            <Route path="/quotes" element={<Quotes />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/more" element={
              <section className="view"><h1>More</h1>
                <div className="list">{NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
                  {isStaff && <NavLink to="/admin">Admin</NavLink>}</div></section>} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
      <nav className="tabbar">
        {NAV.filter(([to]) => ["/", "/live", "/chat", "/give"].includes(to)).map(([to, label]) =>
          <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
        <NavLink to="/more">More</NavLink>
      </nav>
    </div>
  );
}

async function confirmSignOut() {
  const { supabase } = await import("./lib/supabase");
  if (window.confirm("Sign out of BCIL Live?")) await supabase.auth.signOut();
}
