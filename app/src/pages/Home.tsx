import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

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
      <p className="hello">{hello}, {profile?.full_name.split(" ")[0] || "friend"} · Welcome to BCIL Live</p>
      {/* 1. the main thing: the flagship event */}
      <div className="banner hero">
        <span className="eyebrow">6th edition · Saturday 23 January 2027</span>
        <h1>Finding Campus Balance 2027</h1>
        <p>Digital safety, academic wellbeing, a campus life panel, and a CV and cover letter clinic.</p>
        <p className="venue">📍 Auditorium 900, University of Cape Coast</p>
        <Link className="btn primary" to="/forms">Register for FCB 2027</Link>
      </div>
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
          <small>— {quote.author} · <span className="more">Read more →</span></small>
        </Link>
      )}
    </section>
  );
}
