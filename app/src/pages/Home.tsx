import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { biteDay, shareBite } from "./Quotes";
import { EVENT_COLS, bgFor, countdown, img, isOnNow, nextSession, sessions, when, type Ev } from "../lib/events";

type Quote = { id: number; body: string; author: string; show_on: string };
type Session = { id: string; title: string; starts_at: string; status: string };
type NewItem = { id: string; title: string; sub: string; cover: string | null; to: string; at: string; icon: string };
const NEW_FOR_DAYS = 7;   // new books and talks stay on Home this long


export default function Home() {
  const { profile } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [next, setNext] = useState<Session | null>(null);
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [, tick] = useState(0);
  const [fresh, setFresh] = useState<NewItem[]>([]);
  const [photoLater, setPhotoLater] = useState(() => { try { return Date.now() - Number(localStorage.getItem("bcil.photo.later") || 0) < 7 * 864e5; } catch { return false; } });
  const [registered, setRegistered] = useState<Set<string>>(new Set());   // form slugs I've filled in
  const [openForms, setOpenForms] = useState<Set<string>>(new Set());     // registration forms that are open

  useEffect(() => {
    supabase.from("quotes").select("id, body, author, show_on").lte("show_on", biteDay()).order("show_on", { ascending: false }).limit(1)
      .maybeSingle().then(({ data }) => setQuote(data as Quote | null));
    supabase.from("live_sessions").select("id, title, starts_at, status").neq("status", "ended")
      .order("starts_at").limit(1).maybeSingle().then(({ data }) => setNext(data as Session | null));
    supabase.from("event_pages").select(EVENT_COLS).eq("listed", true).then(({ data }) => setEvents((data ?? []) as Ev[]));
    supabase.from("forms").select("slug").eq("is_open", true).then(({ data }) => setOpenForms(new Set(((data ?? []) as { slug: string }[]).map((f) => f.slug))));
    supabase.from("form_responses").select("forms(slug)").then(({ data }) =>
      setRegistered(new Set(((data ?? []) as unknown as { forms: { slug: string } | null }[]).map((r) => r.forms?.slug ?? "").filter(Boolean))));
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

  return (
    <section className="view home">
      <p className="hello">{hello}, {profile?.full_name.split(" ")[0] || "friend"} 👋</p>

      {/* a short welcome from the founder */}
      <div className="founder">
        <img src={`${import.meta.env.BASE_URL}team/solomon-agbesi.jpg`} alt="" loading="lazy" />
        <p>“Welcome to BCIL Foundation. Learn, grow and connect here. We want you to do better than us and impact those after you.”<small>Solomon Agbesi, Founder</small></p>
      </div>

      {/* today's Daily Bite: first thing on Home; like and share right here */}
      {quote && <BiteCard q={quote} />}

      {/* nudge: add a profile photo so chats and live rooms feel personal */}
      {profile && !profile.avatar_url && !photoLater && (
        <div className="nudge">
          <span className="nudge-ava" aria-hidden="true">📷</span>
          <span className="grow"><b>Add a profile photo</b><small className="muted">So friends recognise you in chats and live sessions.</small></span>
          <button className="btn primary sm" onClick={() => window.dispatchEvent(new Event("bcil-edit-profile"))}>Add</button>
          <button className="linkbtn" aria-label="Not now" onClick={() => { try { localStorage.setItem("bcil.photo.later", String(Date.now())); } catch { /* ignore */ } setPhotoLater(true); }}>✕</button>
        </div>
      )}

      {/* live now / next live session */}
      {next && (
        <Link to="/live" className="card row">
          <span className={`pill ${next.status === "live" ? "live" : "soon"}`}>{next.status === "live" ? "LIVE" : "Next live"}</span>
          <div className="grow"><b>{next.title}</b><br /><small className="muted">{new Date(next.starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></div>
        </Link>
      )}

      {/* coming up: every programme as a compact row with its buttons (fits on one screen) */}
      {upcoming.length > 0 && <>
        <h2 className="home-h">Coming up</h2>
        <div className="prog-list">{upcoming.map(({ e, at }) => (
          <ProgrammeRow key={e.slug} e={e} at={at} registered={!!e.form_slug && registered.has(e.form_slug)} canRegister={!!e.form_slug && openForms.has(e.form_slug)} />
        ))}</div>
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


    </section>
  );
}

function BiteCard({ q }: { q: Quote }) {
  const { session } = useAuth();
  const me = session!.user.id;
  const [l, setL] = useState({ n: 0, mine: false });
  useEffect(() => {
    supabase.from("quote_likes").select("user_id").eq("quote_id", q.id).then(({ data }) => {
      const list = (data ?? []) as { user_id: string }[]; setL({ n: list.length, mine: list.some((r) => r.user_id === me) });
    });
    supabase.from("quote_reads").insert({ user_id: me, quote_id: q.id }).then(() => {}, () => {});
  }, [q.id]);
  async function like() {
    const cur = l; setL({ n: cur.n + (cur.mine ? -1 : 1), mine: !cur.mine });
    const r = cur.mine ? await supabase.from("quote_likes").delete().eq("quote_id", q.id).eq("user_id", me)
      : await supabase.from("quote_likes").insert({ quote_id: q.id, user_id: me });
    if (r.error) setL(cur);
  }
  return (
    <div className="quote-mini">
      <span className="eyebrow">Daily Bite</span>
      <p>“{q.body}”</p>
      <small>— {q.author}</small>
      <div className="bite-acts">
        <button className={`likebtn${l.mine ? " on" : ""}`} onClick={like} aria-pressed={l.mine} aria-label={l.mine ? "Unlike" : "Like"}>{l.mine ? "❤️" : "🤍"} {l.n || ""}</button>
        <button className="btn ghost sm light" onClick={() => shareBite(q)}>Share</button>
        <Link to="/quotes" className="bite-past">Past bites</Link>
      </div>
    </div>
  );
}

function ProgrammeRow({ e, at, registered, canRegister }: { e: Ev; at: Date; registered: boolean; canRegister: boolean }) {
  const n = sessions(e).length, idx = sessions(e).findIndex((d) => +d === +at) + 1;
  const now = isOnNow(at);
  const soon = now || +at - Date.now() < 30 * 60e3;
  return (
    <div className="prog-row">
      <span className="prog-thumb" style={{ backgroundImage: `url(${img(e.hero_url, bgFor(e.slug))})` }} />
      <div className="grow">
        <b>{e.title}</b>
        <small className="muted">{when(at)}{n > 1 ? ` · session ${idx} of ${n}` : ""}</small>
        <div className="prog-acts">
          <Link className="btn ghost sm" to={`/events/${e.slug}`}>Details</Link>
          {e.online_url && soon && <a className="btn primary sm" href={e.online_url} target="_blank" rel="noreferrer">Join now</a>}
          {registered ? <Link className="btn primary sm" to={`/events/${e.slug}`}>🎟 My ticket</Link>
            : canRegister && <Link className="btn primary sm" to={`/forms?form=${e.form_slug}`}>Register · free</Link>}
        </div>
      </div>
      <span className={`prog-count${now ? " now" : ""}`}>{now ? "● On now" : countdown(at)}</span>
    </div>
  );
}
