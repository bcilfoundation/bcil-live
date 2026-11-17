import { useEffect, useMemo, useState } from "react";
import Tick from "../components/Tick";
import ChatTabs from "../components/ChatTabs";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";

type Person = { id: string; full_name: string; avatar_url: string | null; bio: string | null; role: string; mutual?: number };
type Friendship = { id: number; requester: string; addressee: string; status: "pending" | "accepted"; created_at?: string };

const ROLE_LABEL: Record<string, string> = { admin: "BCIL team", moderator: "Moderator", mentor: "Mentor" };

export default function Friends() {
  const { session, isStaff } = useAuth();
  const me = session!.user.id;
  const nav = useNavigate();
  const [tab, setTab] = useState<"friends" | "requests" | "find">("friends");
  const [links, setLinks] = useState<Friendship[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [error, setError] = useState("");
  const [mentors, setMentors] = useState<{ id: string; full_name: string; avatar_url: string | null; room_id: string | null }[]>([]);
  useEffect(() => { supabase.rpc("my_mentors").then(({ data }) => setMentors((data ?? []) as never)); }, []);

  async function load() {
    const { data } = await supabase.from("friendships").select("id, requester, addressee, status, created_at");
    const list = (data ?? []) as Friendship[];
    setLinks(list);
    const ids = [...new Set(list.map((f) => (f.requester === me ? f.addressee : f.requester)))];
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("id, full_name, avatar_url, bio, role").in("id", ids);
      setPeople((cur) => ({ ...cur, ...Object.fromEntries(((ps ?? []) as Person[]).map((p) => [p.id, p])) }));
    }
  }
  useEffect(() => {
    load();
    const ch = supabase.channel(`friends:${me}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // search by name (respecting each person's "who can find me"), or show people you may know when the box is empty
  useEffect(() => {
    if (tab !== "find") return;
    const t = setTimeout(async () => {
      const term = q.trim();
      const { data } = term.length >= 2 ? await supabase.rpc("find_people", { p_q: term }) : await supabase.rpc("people_you_may_know");
      setResults(((data ?? []) as Person[]).map((p) => ({ ...p, bio: null })));
    }, 250);
    return () => clearTimeout(t);
  }, [q, tab]);

  const other = (f: Friendship) => (f.requester === me ? f.addressee : f.requester);
  const friends = links.filter((f) => f.status === "accepted");
  const incoming = links.filter((f) => f.status === "pending" && f.addressee === me);
  const outgoing = links.filter((f) => f.status === "pending" && f.requester === me);
  const linkWith = useMemo(() => Object.fromEntries(links.map((f) => [other(f), f])), [links]);

  async function act(label: string, p: PromiseLike<{ error: { message: string } | null }>) {
    setError("");
    const { error } = await p;
    if (error) setError(`${label} didn't work: ${/row-level security/i.test(error.message) ? "this connection isn't allowed. Under-18 members can connect with BCIL staff and mentors only." : /duplicate/i.test(error.message) ? "there is already a request between you." : error.message}`);
    else load();
  }
  const add = (id: string) => act("Friend request", supabase.from("friendships").insert({ requester: me, addressee: id }));
  const accept = (f: Friendship) => act("Accept", supabase.from("friendships").update({ status: "accepted" }).eq("id", f.id));
  const remove = (f: Friendship, label = "Remove") => act(label, supabase.from("friendships").delete().eq("id", f.id));
  async function message(id: string) {
    setError("");
    const { data, error } = await supabase.rpc("start_dm", { other: id });
    if (error) setError(error.message); else nav(`/chat?room=${data}`);
  }

  function Row({ p, children, sub }: { p?: Person; children: React.ReactNode; sub?: string }) {
    if (!p) return null;
    return (
      <div className="person">
        <Avatar name={p.full_name} url={p.avatar_url} size={46} />
        <div className="grow"><b>{p.full_name}<Tick id={p.id} size={14} /></b>{ROLE_LABEL[p.role] && <span className="pill soon">{ROLE_LABEL[p.role]}</span>}
          {sub ? <small className="muted">{sub}</small> : p.bio && <small className="muted clamp">{p.bio}</small>}</div>
        <div className="acts">{children}</div>
      </div>
    );
  }

  return (
    <section className="view">
      <h1>Chat</h1>
      <ChatTabs />
      {mentors.map((m) => (
        <div key={m.id} className="card mentorcard">
          <Avatar name={m.full_name} url={m.avatar_url} size={56} />
          <div className="grow"><small className="muted">Your mentor</small><b>{m.full_name}<Tick id={m.id} size={15} /></b>
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <button className="btn ghost sm" onClick={() => (m.room_id ? nav(`/chat?room=${m.room_id}`) : message(m.id))}><Icon name="chat" size={16} />Message</button>
              <button className="btn ghost sm" onClick={() => nav("/mentorship")}>Mentorship</button>
            </div></div>
        </div>))}
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === "friends"} onClick={() => setTab("friends")}>My friends{friends.length ? ` · ${friends.length}` : ""}</button>
        <button role="tab" aria-selected={tab === "requests"} onClick={() => setTab("requests")}>Requests{incoming.length ? <span className="count inline">{incoming.length}</span> : ""}</button>
        <button role="tab" aria-selected={tab === "find"} onClick={() => setTab("find")}>Find people</button>
      </div>
      {error && <p className="err" role="alert">{error}</p>}

      {tab === "friends" && (friends.length === 0 ? (
        <div className="empty"><b>No friends yet</b><span>Find people from BCIL programmes and campuses and add them.</span>
          <button className="btn primary" onClick={() => setTab("find")}><Icon name="userplus" size={18} />Find people</button></div>
      ) : (
        <div className="list">{friends.map((f) => (
          <Row key={f.id} p={people[other(f)]} sub={f.created_at ? `Friends since ${new Date(f.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: new Date(f.created_at).getFullYear() === new Date().getFullYear() ? undefined : "numeric" })}` : undefined}>
            <button className="btn primary sm" onClick={() => message(other(f))}>Message</button>
            <button className="linkbtn" onClick={() => window.confirm("Remove this friend?") && remove(f)}>Remove</button>
          </Row>))}</div>
      ))}

      {tab === "requests" && (
        <>
          <h2>Waiting for you</h2>
          {incoming.length === 0 ? <p className="muted">No new requests.</p> : (
            <div className="list">{incoming.map((f) => (
              <Row key={f.id} p={people[other(f)]}>
                <button className="btn primary sm" onClick={() => accept(f)}>Accept</button>
                <button className="btn ghost sm" onClick={() => remove(f, "Decline")}>Decline</button>
              </Row>))}</div>
          )}
          <h2>You sent</h2>
          {outgoing.length === 0 ? <p className="muted">No requests sent.</p> : (
            <div className="list">{outgoing.map((f) => (
              <Row key={f.id} p={people[other(f)]}><button className="btn ghost sm" onClick={() => remove(f, "Cancel")}>Cancel request</button></Row>))}</div>
          )}
        </>
      )}

      {tab === "find" && (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name" aria-label="Search people" />
          {q.trim().length < 2 && <h3 className="setsub">People you may know</h3>}
          {results.length === 0 ? <p className="muted">{q.trim().length >= 2 ? "No one found with that name." : "As you add friends, people you may know show here."}</p> : (
            <div className="list">{results.map((p) => {
              const f = linkWith[p.id];
              return (
                <Row key={p.id} p={p} sub={p.mutual ? `${p.mutual} friend${p.mutual > 1 ? "s" : ""} in common` : undefined}>
                  {!f && <button className="btn primary sm" onClick={() => add(p.id)}><Icon name="userplus" size={16} />Add friend</button>}
                  {isStaff && f?.status !== "accepted" && <button className="btn ghost sm" onClick={() => message(p.id)}>Message</button>}
                  {f?.status === "accepted" && <button className="btn ghost sm" onClick={() => message(p.id)}>Message</button>}
                  {f?.status === "pending" && f.requester === me && <span className="muted small">Request sent</span>}
                  {f?.status === "pending" && f.addressee === me && <button className="btn primary sm" onClick={() => accept(f)}>Accept</button>}
                </Row>
              );
            })}</div>
          )}
        </>
      )}
      <h3 className="setsub">Privacy</h3>
      <div className="card setlist">
        <button className="setrow" onClick={() => nav("/settings/privacy")}><span className="seticon">👁</span><span className="grow">Who can find me and blocked people</span><span className="chev">›</span></button>
      </div>
    </section>
  );
}
