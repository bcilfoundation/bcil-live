import { useEffect, useMemo, useState } from "react";
import ChatTabs from "../components/ChatTabs";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";

type Person = { id: string; full_name: string; avatar_url: string | null; bio: string | null; role: string };
type Friendship = { id: number; requester: string; addressee: string; status: "pending" | "accepted" };

const ROLE_LABEL: Record<string, string> = { admin: "BCIL team", moderator: "Moderator", mentor: "Mentor" };

export default function Friends() {
  const { session } = useAuth();
  const me = session!.user.id;
  const nav = useNavigate();
  const [tab, setTab] = useState<"friends" | "requests" | "find">("friends");
  const [links, setLinks] = useState<Friendship[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const { data } = await supabase.from("friendships").select("id, requester, addressee, status");
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

  // search everyone by name (or show newest members when the box is empty)
  useEffect(() => {
    if (tab !== "find") return;
    const t = setTimeout(async () => {
      let query = supabase.from("profiles").select("id, full_name, avatar_url, bio, role").neq("id", me).neq("full_name", "");
      if (q.trim()) query = query.ilike("full_name", `%${q.trim().replace(/[%_]/g, "")}%`);
      const { data } = await query.order("created_at", { ascending: false }).limit(40);
      setResults((data ?? []) as Person[]);
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

  function Row({ p, children }: { p?: Person; children: React.ReactNode }) {
    if (!p) return null;
    return (
      <div className="person">
        <Avatar name={p.full_name} url={p.avatar_url} size={46} />
        <div className="grow"><b>{p.full_name}</b>{ROLE_LABEL[p.role] && <span className="pill soon">{ROLE_LABEL[p.role]}</span>}
          {p.bio && <small className="muted clamp">{p.bio}</small>}</div>
        <div className="acts">{children}</div>
      </div>
    );
  }

  return (
    <section className="view">
      <h1>Chat</h1>
      <ChatTabs />
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
          <Row key={f.id} p={people[other(f)]}>
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" aria-label="Search people" />
          {results.length === 0 ? <p className="muted">{q ? "No one found with that name." : "Loading…"}</p> : (
            <div className="list">{results.map((p) => {
              const f = linkWith[p.id];
              return (
                <Row key={p.id} p={p}>
                  {!f && <button className="btn primary sm" onClick={() => add(p.id)}><Icon name="userplus" size={16} />Add friend</button>}
                  {f?.status === "accepted" && <button className="btn ghost sm" onClick={() => message(p.id)}>Message</button>}
                  {f?.status === "pending" && f.requester === me && <span className="muted small">Request sent</span>}
                  {f?.status === "pending" && f.addressee === me && <button className="btn primary sm" onClick={() => accept(f)}>Accept</button>}
                </Row>
              );
            })}</div>
          )}
        </>
      )}
    </section>
  );
}
