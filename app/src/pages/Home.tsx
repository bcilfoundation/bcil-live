import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import DobPrompt from "../components/DobPrompt";

type Quote = { body: string; author: string; theme: string; reflection: string | null };
type Session = { id: string; title: string; starts_at: string; status: string };

export default function Home() {
  const { profile } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [next, setNext] = useState<Session | null>(null);

  useEffect(() => {
    supabase.from("quotes").select("body, author, theme, reflection").order("show_on", { ascending: false }).limit(1)
      .maybeSingle().then(({ data }) => setQuote(data as Quote | null));
    supabase.from("live_sessions").select("id, title, starts_at, status").neq("status", "ended")
      .order("starts_at").limit(1).maybeSingle().then(({ data }) => setNext(data as Session | null));
  }, []);

  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <section className="view home">
      <p className="hello">{hello}, {profile?.full_name.split(" ")[0] || "friend"} 👋</p>
      <DobPrompt />
      {/* 1. the main thing: the flagship event */}
      <div className="banner hero photo compact" style={{ backgroundImage: `linear-gradient(180deg, rgba(10,25,60,.55), rgba(10,25,60,.92)), url(${import.meta.env.BASE_URL}fcb/hero.jpg)` }}>
        <span className="eyebrow">Sat 23 Jan 2027 · Auditorium 900, UCC</span>
        <h1>Finding Campus Balance 2027</h1>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Link className="btn primary sm" to="/forms?form=fcb27-registration">Register</Link>
          <Link className="btn ghost light sm" to="/fcb">Programme &amp; ticket</Link>
        </div>
      </div>
      <div className="fcb-strip" aria-label="Photos from FCB 2026">
        {[1, 2, 3, 4, 5, 6].map((i) => <img key={i} src={`${import.meta.env.BASE_URL}fcb/p${i}.jpg`} alt="" loading="lazy" />)}
      </div>
      <small className="muted fcb-credit">FCB 2026 at UCC · photos by Kingdave Studios</small>
      {/* 2. what's on live */}
      {next && (
        <Link to="/live" className="card row">
          <span className={`pill ${next.status === "live" ? "live" : "soon"}`}>{next.status === "live" ? "LIVE" : "Next live"}</span>
          <div className="grow"><b>{next.title}</b><br /><small className="muted">{new Date(next.starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></div>
        </Link>
      )}
      {/* 3. a small daily quote; the full one lives on the Daily Quotes page */}
      {quote && (
        <Link to="/quotes" className="quote-mini">
          <span className="eyebrow">Today's quote · {quote.theme}</span>
          <p>“{quote.body}”</p>
          <small>— {quote.author}</small>
        </Link>
      )}
    </section>
  );
}
