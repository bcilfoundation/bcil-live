import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Avatar from "../components/Avatar";
import PersonSheet from "../components/PersonSheet";

type Hit = { id: string; title: string; sub: string; to?: string; icon: string; person?: { name: string; avatar: string | null } };

// One search box for talks, books, the bookshop, groups, programmes and people
export default function Search() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [hits, setHits] = useState<Record<string, Hit[]> | null>(null);
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { box.current?.focus(); }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      setParams(term ? { q: term } : {}, { replace: true });
      const like = `%${term.replace(/[%_,()]/g, " ")}%`;
      const [talks, books, shop, people, groups, events] = await Promise.all([
        supabase.from("talks").select("id, title, program, kind, live_session_id").eq("status", "published").or(`title.ilike.${like},description.ilike.${like},program.ilike.${like}`).limit(8),
        supabase.from("books").select("id, title, author, category").or(`title.ilike.${like},author.ilike.${like},category.ilike.${like}`).limit(6),
        supabase.from("shop_books").select("id, title, author").or(`title.ilike.${like},author.ilike.${like}`).limit(4),
        supabase.from("profiles").select("id, full_name, avatar_url, role").ilike("full_name", like).neq("full_name", "").limit(8),
        supabase.rpc("group_list"),
        supabase.from("event_pages").select("slug, title, subtitle").or(`title.ilike.${like},subtitle.ilike.${like}`).limit(4),
      ]);
      const low = term.toLowerCase();
      setHits({
        "Talks": ((talks.data ?? []) as { id: string; title: string; program: string | null; kind: string; live_session_id: string | null }[]).map((x) => ({ id: x.id, title: x.title, sub: x.live_session_id ? "Live recording" : x.program ?? (x.kind === "audio" ? "Audio talk" : "Video talk"), to: `/library?talk=${x.id}`, icon: x.kind === "audio" ? "🎧" : "▶" })),
        "Reading room": ((books.data ?? []) as { id: string; title: string; author: string | null; category: string }[]).map((x) => ({ id: x.id, title: x.title, sub: [x.author, x.category].filter(Boolean).join(" · "), to: `/reading?book=${x.id}`, icon: "📚" })),
        "Bookshop": ((shop.data ?? []) as { id: string; title: string; author: string }[]).map((x) => ({ id: x.id, title: x.title, sub: `by ${x.author}`, to: "/shop", icon: "🛒" })),
        "Programmes": ((events.data ?? []) as { slug: string; title: string; subtitle: string | null }[]).map((x) => ({ id: x.slug, title: x.title, sub: x.subtitle ?? "Programme", to: `/events/${x.slug}`, icon: "📅" })),
        "Groups": ((groups.data ?? []) as { id: string; name: string; description: string | null; is_member: boolean; member_count: number }[])
          .filter((g) => `${g.name} ${g.description ?? ""}`.toLowerCase().includes(low)).slice(0, 6)
          .map((g) => ({ id: g.id, title: g.name, sub: `${g.member_count} members${g.is_member ? " · you're in" : ""}`, to: g.is_member ? `/chat?room=${g.id}` : `/groups/${g.id}`, icon: "👥" })),
        "People": ((people.data ?? []) as { id: string; full_name: string; avatar_url: string | null; role: string }[]).map((x) => ({ id: x.id, title: x.full_name, sub: x.role === "admin" ? "BCIL team" : x.role === "moderator" ? "Moderator" : x.role === "mentor" ? "Mentor" : "Member", icon: "", person: { name: x.full_name, avatar: x.avatar_url } })),
      });
      setBusy(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const total = hits ? Object.values(hits).reduce((n, l) => n + l.length, 0) : 0;
  return (
    <section className="view">
      <h1>Search</h1>
      <input ref={box} className="search big" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search talks, books, groups, people…" aria-label="Search" />
      {q.trim().length < 2 ? <p className="muted">Type at least 2 letters.</p> : busy && !hits ? <p className="muted">Searching…</p> : hits && total === 0 ? <p className="muted">Nothing found for “{q.trim()}”.</p> : null}
      {hits && Object.entries(hits).filter(([, l]) => l.length).map(([group, list]) => (
        <div key={group}>
          <h2 className="home-h">{group}</h2>
          <div className="list">{list.map((h) => h.person ? (
            <button key={h.id} className="searchhit" onClick={() => setPerson(h.id)}>
              <Avatar name={h.person.name} url={h.person.avatar} size={36} /><span className="grow"><b>{h.title}</b><small className="muted">{h.sub}</small></span>
            </button>
          ) : (
            <Link key={h.id} to={h.to!} className="searchhit">
              <span className="searchico" aria-hidden="true">{h.icon}</span><span className="grow"><b>{h.title}</b><small className="muted">{h.sub}</small></span>
            </Link>
          ))}</div>
        </div>
      ))}
      {person && <PersonSheet userId={person} close={() => setPerson(null)} />}
    </section>
  );
}
