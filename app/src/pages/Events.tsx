import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { EVENT_COLS, bgFor, countdown, img, nextSession, sessions, when, type Ev } from "../lib/events";

// All BCIL programmes: upcoming (soonest first) and past. Staff can add a new one.
export default function Events() {
  const { isStaff } = useAuth();
  const nav = useNavigate();
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let q = supabase.from("event_pages").select(EVENT_COLS);
    if (!isStaff) q = q.eq("listed", true);
    q.then(({ data }) => setEvents((data ?? []) as Ev[]));
  }, [isStaff]);
  const withNext = (events ?? []).map((e) => ({ e, at: nextSession(e), last: sessions(e).slice(-1)[0] ?? null }));
  const upcoming = withNext.filter((x) => x.at).sort((a, b) => +a.at! - +b.at!);
  const past = withNext.filter((x) => !x.at).sort((a, b) => +(b.last ?? 0) - +(a.last ?? 0));

  async function create() {
    const title = window.prompt("Name of the programme (e.g. Operation 4.0 Series 2027)");
    if (!title?.trim()) return;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);
    const { error } = await supabase.from("event_pages").insert({ slug, title: title.trim(), listed: false, dates: [], schedule: [], speakers: [] });
    if (error) { setErr(error.message); return; }
    nav(`/events/${slug}?edit=1`);
  }

  const Card = ({ e, at, last }: { e: Ev; at: Date | null; last: Date | null }) => (
    <Link to={`/events/${e.slug}`} className="prog-row">
      <span className="prog-thumb" style={{ backgroundImage: `url(${img(e.hero_url, bgFor(e.slug))})` }} />
      <div className="grow"><b>{e.title}{!e.listed && <span className="pill" style={{ marginLeft: 6 }}>Hidden</span>}</b>
        <small className="muted">{at ? when(at, true) : last ? `Ended ${last.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "No date yet"}{e.venue ? ` · ${e.venue}` : ""}</small></div>
      {at && <span className="prog-count">{countdown(at)}</span>}
    </Link>
  );
  return (
    <section className="view">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1>Programmes</h1>
        {isStaff && <button className="btn primary sm" onClick={create}>+ New programme</button>}
      </div>
      {err && <p className="err">{err}</p>}
      {events === null ? <p className="muted">Loading…</p> : <>
        <h2 className="home-h">Upcoming</h2>
        {upcoming.length ? <div className="prog-list">{upcoming.map((x) => <Card key={x.e.slug} {...x} />)}</div> : <p className="muted">Nothing scheduled right now.</p>}
        {past.length > 0 && <><h2 className="home-h">Past</h2><div className="prog-list">{past.map((x) => <Card key={x.e.slug} {...x} />)}</div></>}
      </>}
    </section>
  );
}
