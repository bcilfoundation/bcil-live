import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { initials } from "./lib/supabase";
import SignIn from "./pages/SignIn";
import Home from "./pages/Home";
import Live from "./pages/Live";
import Chat from "./pages/Chat";
import Forms from "./pages/Forms";
import Give from "./pages/Give";
import Soon from "./pages/Soon";

const NAV = [
  ["/", "Home"], ["/live", "Live"], ["/library", "Library"], ["/quotes", "Daily Quotes"],
  ["/chat", "Chat room"], ["/forms", "Forms"], ["/give", "Give"],
] as const;

export default function App() {
  const { session, profile, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!session) return <SignIn />;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="mark">BCIL</span><b>BCIL<span>Live</span></b></div>
        <nav className="menu">
          {NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
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
            <Route path="/library" element={<Soon title="Library" />} />
            <Route path="/quotes" element={<Soon title="Daily Quotes" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
      <nav className="tabbar">
        {NAV.filter(([to]) => ["/", "/live", "/chat", "/give"].includes(to)).map(([to, label]) =>
          <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
      </nav>
    </div>
  );
}

async function confirmSignOut() {
  const { supabase } = await import("./lib/supabase");
  if (window.confirm("Sign out of BCIL Live?")) await supabase.auth.signOut();
}
