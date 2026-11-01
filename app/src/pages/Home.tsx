import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { EVENT_COLS, bgFor, countdown, img, isOnNow, nextSession, sessions, when, type Ev } from "../lib/events";

type Quote = { body: string; author: string; show_on: string };
type Session = { id: string; title: string; starts_at: string; status: string };
type NewItem = { id: string; title: string; sub: string; cover: string | null; to: string; at: string; icon: string };
const NEW_FOR_DAYS = 7;   // new books and talks stay on Home this long

const shared = (d: string) => {
  const day = new Date(d + "T12:00:00"); const today = new Date();
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()) / 864e5);
  return diff <= 0 ? "Shared today" : diff === 1 ? "Shared yesterday" : `Shared ${day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
};

export default function Home() {
  const { profile } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [next, setNext] = useState<Session | null>(null);
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [, tick] = useState(0);
  const [fresh, setFresh] = useState<NewItem[]>([]);

  useEffect(() => {
    supabase.from("quotes").select("body, author, show_on").order("show_on", { ascending: false }).limit(1)
      .maybeSingle().then(({ data }) => setQuote(data as Quote | null));
    supabase.from("live_sessions").select("id, title, starts_at, status").neq("status", "ended")
      .order("starts_at").limit(1).maybeSingle().then(({ data }) => setNext(data as Session | null));
    supabase.from("event_pages").select(EVENT_COLS).eq("listed", true).then(({ data }) => setEvents((data ?? []) as Ev[]));
    // new in the Reading room and the Library this week
    const since = new Date(Date.now() - NEW_FOR_DAYS * 864e5);
    Promise.all([
      supabase.from("books").select("id, title, author, category, cover_url, created_at").eq("published", true).gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(6),
      supabase.from("talks").select("id, title, program, kind, youtube_id, published_on, live_session_id").eq("status", "published").gte("published_on", since.toISOString().slice(0, 10)).order("published_on", { ascending: false }).limit(6),
    ]).then(([{ data: b }, { data: t }]) => {
      const books: NewItem[] = ((b ?? []) as { id: string; title: string; author: string | null; category: string; cover_url: string | null; created_at: string }[])
        .map((x) => ({ id: x.id, title: x.title, sub: `Reading room · ${x.category}`, cover: x.cover_url, to: `/reading?book=${x.id}`, at: x.created_at, icon: "📚" }));
      const talks: NewItem[] = ((t ?? []) as { id: string; title: string; program: string | null; kind: string; youtube_id: string | null; published_on: string; live_session_id: string | null }[])
        .map((x) => ({ id: x.id, title: x.title, sub: x.live_session_id ? "Live recording" : x.kind === "audio" ? "Audio talk" : "Video talk",
          cover: x.youtube_id ? `https://i.ytimg.com/vi/${x.youtube_id}/mqdefault.jpg` : null, to: `/library?talk=${x.id}`, at: x.published_on + "T12:00:00", icon: x.kind === "audio" ? "🎧" : "▶" }));
      setFresh([...books, ...talks].sort((a, c) => c.at.localeCompare(a.at)).slice(0, 8));
    });
    const t = setInterval(() => tick((n) => n + 1), 60000);   // keep the countdowns fresh
    return () => clearInterval(t);
  }, []);

  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  // upcoming programmes, soonest first
  const upcoming = (events ?? []).map((e) => ({ e, at: nextSession(e) })).filter((x): x is { e: Ev; at: Date } => !!x.at)
    .sort((a, b) => +a.at - +b.at);
  const [first, ...rest] = upcoming;

  return (
    <section className="view home">
      <p className="hello">{hello}, {profile?.full_name.split(" ")[0] || "friend"} 👋</p>

      {/* live now / next live session */}
      {next && (
        <Link to="/live" className="card row">
          <span className={`pill ${next.status === "live" ? "live" : "soon"}`}>{next.status === "live" ? "LIVE" : "Next live"}</span>
          <div className="grow"><b>{next.title}</b><br /><small className="muted">{new Date(next.starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></div>
        </Link>
      )}

      {/* coming up: the soonest programme big, the rest as small cards */}
      {first && <ProgrammeCard e={first.e} at={first.at} big />}
      {rest.length > 0 && <>
        <h2 className="home-h">Coming up</h2>
        <div className="prog-list">{rest.map(({ e, at }) => <ProgrammeCard key={e.slug} e={e} at={at} />)}</div>
      </>}
      {events && !upcoming.length && <Link to="/events" className="card"><b>Programmes</b><br /><small className="muted">See past and upcoming BCIL programmes</small></Link>}

      {/* new books and talks this week */}
      {fresh.length > 0 && <>
        <h2 className="home-h">New this week</h2>
        <div className="newrow">{fresh.map((n) => (
          <Link key={n.id} to={n.to} className="newcard">
            {n.cover ? <img src={n.cover} alt="" loading="lazy" /> : <span className="newart" aria-hidden="true">{n.icon}</span>}
            <b>{n.title}</b><small className="muted">{n.sub}</small>
          </Link>
        ))}</div>
      </>}

      {/* today's quote */}
      {quote && (
        <Link to="/quotes" className="quote-mini">
          <span className="eyebrow">Daily quote · {shared(quote.show_on)}</span>
          <p>“{quote.body}”</p>
          <small>— {quote.author}</small>
        </Link>
      )}
    </section>
  );
}

function ProgrammeCard({ e, at, big }: { e: Ev; at: Date; big?: boolean }) {
  const n = sessions(e).length, idx = sessions(e).findIndex((d) => +d === +at) + 1;
  const now = isOnNow(at);
  const bg = `linear-gradient(180deg, rgba(10,25,60,.78), rgba(10,25,60,.95)), url(${img(e.hero_url, bgFor(e.slug))})`;
  if (!big) return (
    <Link to={`/events/${e.slug}`} className="prog-row">
      <span className="prog-thumb" style={{ backgroundImage: `url(${img(e.hero_url, bgFor(e.slug))})` }} />
      <div className="grow"><b>{e.title}</b><small className="muted">{when(at)}{n > 1 ? ` · session ${idx} of ${n}` : ""}</small></div>
      <span className={`prog-count${now ? " now" : ""}`}>{countdown(at)}</span>
    </Link>
  );
  return (
    <div className="banner hero photo compact prog-big" style={{ backgroundImage: bg }}>
      <span className={`prog-count big${now ? " now" : ""}`}>{now ? "● On now" : countdown(at)}</span>
      <span className="eyebrow">{when(at, true)}{n > 1 ? ` · session ${idx} of ${n}` : ""}{e.venue ? ` · ${e.venue}` : ""}</span>
      <h1>{e.title}</h1>
      {e.summary && <p className="prog-sum">{e.summary}</p>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {e.online_url && (now || +at - Date.now() < 30 * 60e3) && <a className="btn primary sm" href={e.online_url} target="_blank" rel="noreferrer">Join now</a>}
        {e.form_slug && <Link className="btn primary sm" to={`/forms?form=${e.form_slug}`}>Register</Link>}
        <Link className="btn ghost light sm" to={`/events/${e.slug}`}>Details{e.form_slug ? " & ticket" : ""}</Link>
      </div>
    </div>
  );
}
