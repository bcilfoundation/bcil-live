import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { isNative } from "../lib/native";
import HomePosts from "../components/HomePosts";
import { useStories } from "../components/Stories";
import Spotlight, { type Slide } from "../components/Spotlight";
import PersonSheet from "../components/PersonSheet";
import type { SpotlightRow } from "../components/CelebrationsAdmin";
import { biteDay, shareBite } from "./Quotes";
import { EVENT_COLS, bgFor, countdown, img, isOnNow, nextSession, sessions, when, type Ev } from "../lib/events";

type Quote = { id: number; body: string; author: string; show_on: string };
type Session = { id: string; title: string; starts_at: string; status: string };
type Post = { id: string; title: string; body: string | null; image_url: string | null; link_url: string | null; link_label: string | null; ends_on: string | null; published: boolean };
type NewItem = { id: string; title: string; sub: string; cover: string | null; to: string; at: string; icon: string };
const NEW_FOR_DAYS = 7;   // new books and talks stay on Home this long


export default function Home() {
  const { profile, isStaff, session } = useAuth();
  const [bdays, setBdays] = useState<{ id: string; full_name: string; avatar_url: string | null }[]>([]);
  const [stars, setStars] = useState<SpotlightRow[]>([]);
  const [person, setPerson] = useState<string | null>(null);     // birthday: open their profile to send wishes
  const [star, setStar] = useState<SpotlightRow | null>(null);   // spotlight: read their story
  const [posts, setPosts] = useState<Post[]>([]);
  const [manage, setManage] = useState(false);   // staff: show the announcements list to add or edit
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
    const today = new Date().toISOString().slice(0, 10);
    supabase.from("home_posts").select("id, title, body, image_url, link_url, link_label, ends_on, published").eq("published", true).order("sort").order("created_at", { ascending: false })
      .then(({ data }) => setPosts(((data ?? []) as Post[]).filter((p) => !p.ends_on || p.ends_on >= today)));
    supabase.rpc("birthdays_today").then(({ data }) => setBdays((data ?? []) as typeof bdays));
    supabase.rpc("current_spotlights").then(({ data }) => setStars((data ?? []) as SpotlightRow[]));
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

  // the rolling Spotlight: live now, the next programmes, announcements, then Plan 2027 and Meet Solomon
  const stories = useStories();
  const slides: Slide[] = [{ key: "founder", tone: "green", quote: true, image: `${import.meta.env.BASE_URL}team/solomon-agbesi.jpg`, eyebrow: "From our founder",
    title: "“Welcome to BCIL Foundation. Learn, grow and connect here. We want you to do better than us and impact those after you.”", sub: "Solomon Agbesi, Founder" }];
  // birthdays today and this week's Spotlight come right after the founder's message
  bdays.slice(0, 5).forEach((b) => {
    const mine = b.id === session?.user.id, first = b.full_name.split(" ")[0];
    slides.push(mine
      ? { key: "bday-" + b.id, tone: "gold", image: b.avatar_url, eyebrow: "🎂 Happy birthday", title: `Happy birthday, ${first}!`, sub: "Everyone at BCIL Foundation is celebrating you today. Have a wonderful year." }
      : { key: "bday-" + b.id, tone: "gold", image: b.avatar_url, eyebrow: "🎂 Birthday today", title: `It's ${b.full_name}'s birthday!`, sub: `Send ${first} a birthday wish.`, cta: { label: "🎉 Send wishes", onClick: () => setPerson(b.id) } });
  });
  stars.forEach((st) => slides.push({ key: "star-" + st.id, tone: "purple", image: st.photo_url, eyebrow: "⭐ Spotlight of the week", title: st.name,
    sub: [st.role, st.headline].filter(Boolean).join(" · "), cta: st.story ? { label: "Read their story", onClick: () => setStar(st) } : st.link_url ? { label: "Read more", to: st.link_url } : undefined }));
  if (next) slides.push(next.status === "live"
    ? { key: "live", tone: "live", eyebrow: "● Live now", title: next.title, sub: "Tap to listen, watch and join in", cta: { label: "Join now", to: "/live" } }
    : { key: "live", tone: "navy", eyebrow: "Next live session", title: next.title, sub: new Date(next.starts_at).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }), cta: { label: "Open Live", to: "/live" } });
  upcoming.slice(0, 5).forEach(({ e, at }) => {
    const reg = !!e.form_slug && registered.has(e.form_slug), canReg = !!e.form_slug && openForms.has(e.form_slug);
    slides.push({ key: "ev-" + e.slug, tone: "navy", image: img(e.hero_url, bgFor(e.slug)), eyebrow: isOnNow(at) ? "● On now" : `Coming up · ${countdown(at)}`,
      title: e.title, sub: [when(at), e.venue].filter(Boolean).join(" · "),
      cta: reg ? { label: "🎟 My ticket", to: `/events/${e.slug}` } : canReg ? { label: "Register · free", to: `/forms?form=${e.form_slug}` } : { label: "Details", to: `/events/${e.slug}` },
      cta2: reg || canReg ? { label: "Details", to: `/events/${e.slug}` } : undefined });
  });
  posts.forEach((p) => slides.push({ key: "post-" + p.id, tone: "purple", image: p.image_url, eyebrow: "📢 Announcement", title: p.title, sub: p.body ?? undefined,
    cta: p.link_url ? { label: p.link_label || "Learn more", to: p.link_url } : undefined }));
  (stories ?? []).forEach((p) => slides.push({ key: "story-" + p.id, tone: "navy", image: p.image, eyebrow: `Story · ${new Date(p.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
    title: p.title, sub: p.excerpt, cta: { label: "Read the story", to: p.link } }));
  slides.push({ key: "plan", tone: "gold", eyebrow: "New · BCIL mentorship", title: "Plan 2027", sub: "Write your one-year plan, goal by goal, and get feedback from BCIL mentors.", cta: { label: "Start my plan", to: "/plan" } });
  slides.push({ key: "meet", tone: "green", image: `${import.meta.env.BASE_URL}team/solomon-agbesi.jpg`, eyebrow: "Book a session", title: "Meet Solomon", sub: "Pick a time from his calendar and send your CV or plan for review.", cta: { label: "Book a time", to: "/meet" } });

  return (
    <section className="view home">
      <p className="hello">{hello}, {profile?.full_name.split(" ")[0] || "friend"} 👋</p>

      <Spotlight slides={slides} />
      {isStaff && <button className="linkbtn hpost-add" onClick={() => setManage((m) => !m)}>{manage ? "Done with announcements" : "✏️ Add or edit announcements"}</button>}
      {isStaff && manage && <HomePosts />}

      {/* nudge: add a profile photo so chats and live rooms feel personal */}
      {profile && !profile.avatar_url && !photoLater && (
        <div className="nudge">
          <span className="nudge-ava" aria-hidden="true">📷</span>
          <span className="grow"><b>Add a profile photo</b><small className="muted">So friends recognise you in chats and live sessions.</small></span>
          <button className="btn primary sm" onClick={() => window.dispatchEvent(new Event("bcil-edit-profile"))}>Add</button>
          <button className="linkbtn" aria-label="Not now" onClick={() => { try { localStorage.setItem("bcil.photo.later", String(Date.now())); } catch { /* ignore */ } setPhotoLater(true); }}>✕</button>
        </div>
      )}

      {/* today's Daily Bite: like, comment and share right here */}
      {quote && <BiteCard q={quote} />}

      {/* the essentials, so nobody has to dig through menus */}
      <NeedBook />

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

      {person && <PersonSheet userId={person} close={() => setPerson(null)} />}
      {star && <div className="lightbox starsheet" role="dialog" aria-label={`Spotlight: ${star.name}`} onClick={() => setStar(null)}>
        <div className="card" onClick={(e) => e.stopPropagation()}>
          {star.photo_url && <img src={star.photo_url} alt="" />}
          <span className="eyebrow">⭐ Spotlight of the week</span>
          <h2>{star.name}</h2>{star.role && <p className="muted">{star.role}</p>}
          <p><b>{star.headline}</b></p>{star.story && <p className="prewrap">{star.story}</p>}
          <div className="row" style={{ gap: 8 }}>{star.link_url && <button className="btn ghost sm" onClick={() => window.open(star.link_url!, "_blank", "noopener")}>Read more</button>}
            <button className="btn primary sm" onClick={() => setStar(null)}>Close</button></div>
        </div>
      </div>}

      <FollowBcil />
      <p className="home-tag">Grooming Generational Leaders · #BCILFoundation</p>
    </section>
  );
}

// "What do you need?": the essential places, on a card marked with the hexagon from the BCIL logo
const NEEDS: [string, string, string, string][] = [
  ["📝", "Plan 2027", "Write your one-year plan", "/plan"], ["📅", "Meet Solomon", "Book a session", "/meet"],
  ["🎓", "Find a mentor", "Get paired with a mentor", "/forms?form=mentorship-mentee"], ["🤝", "Become a mentor", "Guide a student", "/forms?form=mentorship-mentor"],
  ["🎧", "Watch and listen", "Talks and recordings", "/library"], ["🏫", "Campus Sync", "BCIL on your campus", "/campus"],
  ["🙋", "Volunteer for FCB", "Serve at FCB 2027", "/forms?form=fcb27-volunteer"], ["🎁", "Give", "Support the work", "/donate"],
];
function NeedBook() {
  return (
    <div className="needhex">
      <svg className="needhex-mark" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,4 92,27 92,73 50,96 8,73 8,27" fill="none" stroke="#fff" strokeWidth="7" /><polygon points="50,24 74,37 74,63 50,76 26,63 26,37" fill="none" stroke="#fff" strokeWidth="4" /></svg>
      <h2 className="need-h">What do you need?</h2>
      <div className="need-grid">
        {NEEDS.map(([ic, label, , to]) => (
          <Link key={label} to={to} className="need-item">
            <span className="hex" aria-hidden="true">{ic}</span>
            <b className="need-label">{label}</b>
          </Link>
        ))}
      </div>
    </div>
  );
}

// our social media, right on Home so people find it without going to About
const SOCIALS: [string, string, string, string][] = [
  ["Facebook", "BCIL Foundation LBG", "https://www.facebook.com/share/1AXRApBrbN/", "f"],
  ["Instagram", "@bcilfoundation", "https://www.instagram.com/bcilfoundation", "ig"],
  ["TikTok", "@bcil_foundation", "https://www.tiktok.com/@bcil_foundation", "tt"],
  ["YouTube", "@BCILFoundation", "https://youtube.com/@bcilfoundation", "yt"],
  ["LinkedIn", "BCIL FOUNDATION", "https://www.linkedin.com/company/102104920", "in"],
  ["Website", "bcilfoundation.org", "https://bcilfoundation.org", "web"],
];
const SOCIAL_ICON: Record<string, JSX.Element> = {
  f: <path d="M14 8h3V4h-3c-2.8 0-4 1.8-4 4.3V10H7v4h3v8h4v-8h3l1-4h-4V8.6c0-.4.3-.6.6-.6z" fill="currentColor" />,
  ig: <><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor" /></>,
  tt: <path d="M14 3h3c.3 2 1.6 3.4 4 3.6v3.2c-1.5 0-2.9-.4-4-1.2v6.6A5.8 5.8 0 1 1 11 9.6v3.3a2.6 2.6 0 1 0 3 2.6z" fill="currentColor" />,
  yt: <><rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="currentColor" /><path d="M10 9v6l5-3z" fill="var(--panel, #fff)" /></>,
  in: <><rect x="3" y="9" width="4" height="12" fill="currentColor" /><circle cx="5" cy="5" r="2.2" fill="currentColor" /><path d="M10 9h4v1.8c.7-1.2 2-2.1 4-2.1 3 0 4 2 4 5V21h-4v-6.4c0-1.5-.5-2.5-1.9-2.5-1.5 0-2.1 1.1-2.1 2.5V21h-4z" fill="currentColor" /></>,
  web: <><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" stroke="currentColor" strokeWidth="2" /></>,
};
function FollowBcil() {
  async function open(url: string) {
    if (isNative) { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url }); return; }
    window.open(url, "_blank", "noopener");
  }
  return (
    <>
      <h2 className="home-h follow-h">Follow BCIL Foundation</h2>
      <div className="follow-row">{SOCIALS.map(([name, , url, ic]) => (
        <button key={name} className={`follow-ic ic-${ic}`} onClick={() => open(url)} aria-label={`BCIL Foundation on ${name}`} title={name}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">{SOCIAL_ICON[ic]}</svg>
        </button>
      ))}</div>
    </>
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
        <Link to="/quotes" className="btn ghost sm light" aria-label="Comments">💬 Comment</Link>
        <button className="btn ghost sm light" onClick={() => shareBite(q)}>Share</button>
        <Link to="/quotes" className="bite-past">Past bites</Link>
      </div>
    </div>
  );
}
