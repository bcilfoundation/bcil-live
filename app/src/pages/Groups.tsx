import { useEffect, useState } from "react";
import ChatTabs from "../components/ChatTabs";
import { Link, useNavigate, useParams } from "react-router-dom";
import { initials, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { uploadPhoto } from "../lib/media";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import { timeAgo } from "../components/TopBar";

export type Group = {
  id: string; name: string; kind: string; category: string; description: string | null; school: string | null;
  cover_url: string | null; read_only: boolean; is_private: boolean; invite_code: string | null;
  member_count: number; is_member: boolean; my_role: string | null;
};
const SECTIONS: [string, string, string][] = [
  ["campus", "Campus Sync", "BCIL on your campus: activities, updates and your campus chat."],
  ["cohort", "Cohorts", "Your programme year group."],
  ["program", "Programmes", "Groups for BCIL programmes."],
  ["general", "Community", "Open to every BCIL member."],
];
const inviteLink = (code: string) => `${location.origin}${import.meta.env.BASE_URL}join/${code}`;

function Cover({ g, big }: { g: Group; big?: boolean }) {
  return g.cover_url
    ? <img className={big ? "gcover big" : "gcover"} src={g.cover_url} alt="" />
    : <span className={`${big ? "gcover big" : "gcover"} cat-${g.category}`} aria-hidden="true">{initials(g.name.replace(/^BCIL\s+/i, "").replace(/\b(UCC|KNUST|UG|UEW|\d+)\b/g, ""))}</span>;
}

// ---------- the list of groups ----------
export default function Groups({ campus = false }: { campus?: boolean }) {
  const { session, isStaff } = useAuth();
  const nav = useNavigate();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const { data, error } = await supabase.rpc("group_list");
    if (error) setError(error.message);
    setGroups((data ?? []) as Group[]);
  }
  useEffect(() => { load(); }, []);

  async function join(g: Group) {
    const { error } = await supabase.from("room_members").insert({ room_id: g.id, user_id: session!.user.id });
    if (error && !/duplicate/i.test(error.message)) { setError("Could not join: " + error.message); return; }
    nav(`/groups/${g.id}`);
  }

  return (
    <section className="view">
      <h1>Chat</h1>
      <ChatTabs />
      <div className="row"><h2 className="grow">{campus ? "Campus Sync" : "Groups"}</h2>
        {isStaff && <button className="btn primary" onClick={() => setCreating(!creating)}>{creating ? "Close" : "+ New group"}</button>}</div>
      {creating && <CreateGroup start={campus ? "campus" : "general"} onCreated={(id) => nav(`/groups/${id}`)} />}
      {error && <p className="err">{error}</p>}
      {groups !== null && !campus && !groups.some((g) => (g.category ?? "general") !== "campus") && (
        <div className="empty"><b>No groups yet</b><span>{isStaff ? "Tap “+ New group” to create one." : "Groups you can join will appear here."}</span></div>
      )}
      {groups === null ? <p className="muted">Loading…</p> : SECTIONS.filter(([cat]) => (cat === "campus") === campus).map(([cat, title, blurb]) => {
        const list = groups.filter((g) => (g.category ?? "general") === cat);
        if (!list.length && cat !== "campus") return null;
        return (
          <div key={cat} className="gsection">
            {!campus && <h2>{title}</h2>}<p className="muted">{blurb}</p>
            {list.length === 0 ? (
              <div className="empty"><b>No Campus Sync pages yet</b><span>{isStaff ? "Tap “+ New group” and choose Campus Sync to add one for each campus." : "Your campus page will appear here soon."}</span></div>
            ) : (
              <div className="gridcards">{list.map((g) => (
                <div key={g.id} className="gcard">
                  <Link to={`/groups/${g.id}`} className="gcard-main">
                    <Cover g={g} />
                    <div className="grow"><b>{g.name}</b>
                      <small className="muted">{[g.school, `${g.member_count} member${g.member_count === 1 ? "" : "s"}`, g.is_private && "Private"].filter(Boolean).join(" · ")}</small>
                      {g.description && <small className="clamp">{g.description}</small>}</div>
                  </Link>
                  {g.is_member
                    ? <Link className="btn ghost sm" to={`/groups/${g.id}`}>Open</Link>
                    : <button className="btn primary sm" onClick={() => join(g)}>Join</button>}
                </div>
              ))}</div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function CreateGroup({ onCreated, start = "campus" }: { onCreated: (id: string) => void; start?: string }) {
  const [name, setName] = useState(""); const [category, setCategory] = useState(start);
  const [school, setSchool] = useState(""); const [description, setDescription] = useState("");
  const [priv, setPriv] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!name.trim()) { setErr("Give the group a name."); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("create_group", { p_name: name.trim(), p_category: category, p_description: description, p_school: school, p_private: priv });
    setBusy(false);
    if (error) setErr(error.message); else onCreated(data as string);
  }
  return (
    <form className="card" onSubmit={save}>
      <b>New group</b>
      <label className="field">Type<select value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="campus">Campus Sync (a campus chapter)</option><option value="cohort">Cohort</option>
        <option value="program">Programme</option><option value="general">Community</option></select></label>
      <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder={category === "campus" ? "e.g. Campus Sync · KNUST" : "e.g. FCB 2027 Cohort"} /></label>
      {category === "campus" && <label className="field">School / campus<input value={school} onChange={(e) => setSchool(e.target.value)} placeholder="e.g. Kwame Nkrumah University of Science and Technology" /></label>}
      <label className="field">About<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this group is for, when you meet…" /></label>
      <label className="check"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private: people join with an invite link</label>
      {err && <p className="err">{err}</p>}
      <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create group"}</button>
    </form>
  );
}

// ---------- joining a private group from an invite link ----------
export function JoinWithLink() {
  const { code } = useParams(); const nav = useNavigate(); const [err, setErr] = useState("");
  useEffect(() => {
    supabase.rpc("join_with_code", { code }).then(({ data, error }) => {
      if (error) setErr("This invite link doesn't work any more. Ask the group leader for a new one.");
      else nav(`/groups/${data}`, { replace: true });
    });
  }, [code]);
  return <section className="view"><h1>Joining group…</h1>{err && <p className="err">{err}</p>}<Link to="/groups">See all groups</Link></section>;
}

// ---------- one group / Campus Sync page ----------
type Ev = { id: number; title: string; starts_at: string; place: string | null; details: string | null; going: number; mine: boolean };
type Post = { id: number; user_id: string; body: string; image_url: string | null; created_at: string; profiles: { full_name: string; avatar_url: string | null } | null };
type Member = { user_id: string; role: string; profiles: { full_name: string; avatar_url: string | null; bio: string | null } | null };

export function GroupPage() {
  const { id } = useParams();
  const { session, isStaff } = useAuth();
  const me = session!.user.id;
  const nav = useNavigate();
  const [g, setG] = useState<Group | null>(null);
  const [tab, setTab] = useState<"activities" | "updates" | "members" | "about">("activities");
  const [events, setEvents] = useState<Ev[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [err, setErr] = useState(""); const [note, setNote] = useState("");

  async function loadGroup() {
    const { data } = await supabase.rpc("group_list");
    setG(((data ?? []) as Group[]).find((x) => x.id === id) ?? null);
  }
  async function loadEvents() {
    const since = new Date(Date.now() - 6 * 3600e3).toISOString();
    const { data } = await supabase.from("group_events").select("id, title, starts_at, place, details, group_event_rsvps(user_id)")
      .eq("room_id", id).gte("starts_at", since).order("starts_at");
    setEvents(((data ?? []) as unknown as (Ev & { group_event_rsvps: { user_id: string }[] })[]).map((e) => ({
      ...e, going: e.group_event_rsvps.length, mine: e.group_event_rsvps.some((r) => r.user_id === me) })));
  }
  async function loadPosts() {
    const { data } = await supabase.from("group_posts").select("id, user_id, body, image_url, created_at, profiles(full_name, avatar_url)")
      .eq("room_id", id).order("created_at", { ascending: false }).limit(50);
    setPosts((data ?? []) as unknown as Post[]);
  }
  async function loadMembers() {
    const { data } = await supabase.from("room_members").select("user_id, role, profiles(full_name, avatar_url, bio)").eq("room_id", id);
    setMembers(((data ?? []) as unknown as Member[]).sort((a, b) => (a.role === b.role ? (a.profiles?.full_name ?? "").localeCompare(b.profiles?.full_name ?? "") : a.role === "leader" ? -1 : 1)));
  }
  useEffect(() => { loadGroup(); loadEvents(); loadPosts(); loadMembers(); }, [id]);

  if (!g) return <section className="view"><Link to="/groups" className="backlink"><Icon name="back" size={18} />Groups</Link><p className="muted">Loading…</p></section>;
  const leader = isStaff || g.my_role === "leader";

  async function join() {
    const { error } = await supabase.from("room_members").insert({ room_id: g!.id, user_id: me });
    if (error && !/duplicate/i.test(error.message)) setErr("Could not join: " + error.message);
    loadGroup(); loadMembers();
  }
  async function leave() {
    if (!window.confirm(`Leave ${g!.name}?`)) return;
    await supabase.from("room_members").delete().eq("room_id", g!.id).eq("user_id", me);
    nav("/groups");
  }
  async function copyInvite() {
    const link = inviteLink(g!.invite_code!);
    try { if (navigator.share) await navigator.share({ title: g!.name, text: `Join ${g!.name} on BCIL Live`, url: link }); else { await navigator.clipboard.writeText(link); setNote("Invite link copied."); } }
    catch { /* share cancelled */ }
  }
  async function rsvp(e: Ev) {
    if (e.mine) await supabase.from("group_event_rsvps").delete().eq("event_id", e.id).eq("user_id", me);
    else await supabase.from("group_event_rsvps").insert({ event_id: e.id, user_id: me });
    loadEvents();
  }
  async function setRole(m: Member, role: string) {
    const { error } = await supabase.from("room_members").update({ role }).eq("room_id", g!.id).eq("user_id", m.user_id);
    if (error) setErr(error.message); else loadMembers();
  }

  return (
    <section className="view">
      <Link to="/groups" className="backlink"><Icon name="back" size={18} />Groups</Link>
      <div className="ghero">
        <Cover g={g} big />
        <div className="grow">
          <span className="eyebrow">{SECTIONS.find(([c]) => c === g.category)?.[1] ?? "Group"}{g.is_private ? " · Private" : ""}</span>
          <h1>{g.name}</h1>
          <p className="muted">{[g.school, `${g.member_count} member${g.member_count === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <div className="row wrap">
        {g.is_member ? <>
          <Link className="btn primary" to={`/chat?room=${g.id}`}><Icon name="chat" size={18} />Group chat</Link>
          {g.invite_code && leader && <button className="btn ghost" onClick={copyInvite}><Icon name="link" size={18} />Invite link</button>}
          {g.my_role !== "leader" && g.kind !== "announcements" && <button className="linkbtn" onClick={leave}>Leave group</button>}
        </> : <button className="btn primary" onClick={join}>Join this group</button>}
      </div>
      {note && <p className="ok">{note}</p>}{err && <p className="err">{err}</p>}

      <div className="seg" role="tablist">
        {(["activities", "updates", "members", "about"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === "activities" && <>
        {leader && <NewEvent roomId={g.id} onSaved={loadEvents} />}
        {events.length === 0 ? <div className="empty"><b>No upcoming activities</b><span>{leader ? "Add your next meeting, outreach or event above." : "Activities will show here when the leaders add them."}</span></div> : (
          <div className="list">{events.map((e) => {
            const d = new Date(e.starts_at);
            return (
              <div key={e.id} className="event">
                <div className="datebox"><small>{d.toLocaleDateString("en-GB", { month: "short" })}</small><b>{d.getDate()}</b></div>
                <div className="grow"><b>{e.title}</b>
                  <small className="muted"><Icon name="calendar" size={14} /> {d.toLocaleString("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit" })}
                    {e.place && <> · <Icon name="pin" size={14} /> {e.place}</>}</small>
                  {e.details && <p className="small">{e.details}</p>}
                  <small className="muted">{e.going} going</small></div>
                <div className="acts">
                  <button className={`btn sm ${e.mine ? "ghost" : "primary"}`} onClick={() => rsvp(e)}>{e.mine ? "✓ Going" : "I'm going"}</button>
                  {leader && <button className="linkbtn" onClick={async () => { if (window.confirm("Delete this activity?")) { await supabase.from("group_events").delete().eq("id", e.id); loadEvents(); } }}>Delete</button>}
                </div>
              </div>
            );
          })}</div>
        )}
      </>}

      {tab === "updates" && <>
        {leader && <NewPost roomId={g.id} onSaved={loadPosts} />}
        {posts.length === 0 ? <div className="empty"><b>No updates yet</b><span>{leader ? "Share photos and news from your activities." : "News and photos from this group will show here."}</span></div> :
          posts.map((p) => (
            <article key={p.id} className="card post">
              <div className="row"><Avatar name={p.profiles?.full_name} url={p.profiles?.avatar_url} size={38} />
                <div className="grow"><b>{p.profiles?.full_name}</b><small className="muted"> · {timeAgo(p.created_at)}</small></div>
                {(p.user_id === me || isStaff) && <button className="linkbtn" onClick={async () => { if (window.confirm("Delete this update?")) { await supabase.from("group_posts").delete().eq("id", p.id); loadPosts(); } }}>Delete</button>}</div>
              <p className="prewrap">{p.body}</p>
              {p.image_url && <img className="postimg" src={p.image_url} alt="" loading="lazy" />}
            </article>
          ))}
      </>}

      {tab === "members" && (
        <div className="list">{members.map((m) => (
          <div key={m.user_id} className="person">
            <Avatar name={m.profiles?.full_name} url={m.profiles?.avatar_url} size={42} />
            <div className="grow"><b>{m.profiles?.full_name || "Member"}</b>{m.role === "leader" && <span className="pill soon">Leader</span>}
              {m.profiles?.bio && <small className="muted clamp">{m.profiles.bio}</small>}</div>
            {isStaff && m.user_id !== me && (m.role === "leader"
              ? <button className="linkbtn" onClick={() => setRole(m, "member")}>Remove leader</button>
              : <button className="linkbtn" onClick={() => setRole(m, "leader")}>Make leader</button>)}
          </div>
        ))}</div>
      )}

      {tab === "about" && <About g={g} leader={leader} onSaved={loadGroup} />}
    </section>
  );
}

function NewEvent({ roomId, onSaved }: { roomId: string; onSaved: () => void }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(""); const [when, setWhen] = useState(""); const [place, setPlace] = useState(""); const [details, setDetails] = useState("");
  const [err, setErr] = useState("");
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}><Icon name="calendar" size={18} />Add an activity</button>;
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!title.trim() || !when) { setErr("Add a title and a date and time."); return; }
    const { error } = await supabase.from("group_events").insert({ room_id: roomId, title: title.trim(), starts_at: new Date(when).toISOString(), place: place.trim() || null, details: details.trim() || null, created_by: session!.user.id });
    if (error) { setErr(error.message); return; }
    setTitle(""); setWhen(""); setPlace(""); setDetails(""); setOpen(false); onSaved();
  }
  return (
    <form className="card" onSubmit={save}>
      <b>New activity</b>
      <label className="field">What<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Monthly meeting · Leadership talk" /></label>
      <div className="row wrap"><label className="field grow">When<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
        <label className="field grow">Where<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Great Hall, Room 12" /></label></div>
      <label className="field">Details <small className="muted">(optional)</small><textarea value={details} onChange={(e) => setDetails(e.target.value)} style={{ minHeight: 70 }} /></label>
      {err && <p className="err">{err}</p>}
      <div className="row"><button className="btn primary">Post activity</button><button type="button" className="linkbtn" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

function NewPost({ roomId, onSaved }: { roomId: string; onSaved: () => void }) {
  const { session } = useAuth();
  const [body, setBody] = useState(""); const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function pick(f?: File) {
    if (!f) return; setBusy(true); setErr("");
    try { setImg(await uploadPhoto(session!.user.id, f)); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!body.trim()) { setErr("Write something first."); return; }
    setBusy(true);
    const { error } = await supabase.from("group_posts").insert({ room_id: roomId, user_id: session!.user.id, body: body.trim(), image_url: img });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setBody(""); setImg(null); onSaved();
  }
  return (
    <form className="card" onSubmit={save}>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share an update or photos from an activity…" aria-label="Update" style={{ minHeight: 80 }} />
      {img && <div className="previmg"><img src={img} alt="" /><button type="button" className="iconbtn sm" onClick={() => setImg(null)} aria-label="Remove photo"><Icon name="x" size={16} /></button></div>}
      {err && <p className="err">{err}</p>}
      <div className="row">
        <label className="btn ghost sm"><Icon name="image" size={16} />{busy ? "Uploading…" : "Photo"}<input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
        <span className="sp" /><button className="btn primary sm" disabled={busy}>Post update</button>
      </div>
    </form>
  );
}

function About({ g, leader, onSaved }: { g: Group; leader: boolean; onSaved: () => void }) {
  const { session } = useAuth();
  const [edit, setEdit] = useState(false);
  const [description, setDescription] = useState(g.description ?? ""); const [school, setSchool] = useState(g.school ?? "");
  const [err, setErr] = useState("");
  async function cover(f?: File) {
    if (!f) return;
    try { const url = await uploadPhoto(session!.user.id, f, 1600); await supabase.from("rooms").update({ cover_url: url }).eq("id", g.id); onSaved(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function save() {
    const { error } = await supabase.from("rooms").update({ description: description.trim() || null, school: school.trim() || null }).eq("id", g.id);
    if (error) setErr(error.message); else { setEdit(false); onSaved(); }
  }
  if (edit) return (
    <div className="card">
      <label className="field">School / campus<input value={school} onChange={(e) => setSchool(e.target.value)} /></label>
      <label className="field">About<textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      {err && <p className="err">{err}</p>}
      <div className="row"><button className="btn primary" onClick={save}>Save</button><button className="linkbtn" onClick={() => setEdit(false)}>Cancel</button></div>
    </div>
  );
  return (
    <div className="card">
      <p className="prewrap">{g.description || "No description yet."}</p>
      {g.school && <p className="muted">{g.school}</p>}
      {err && <p className="err">{err}</p>}
      {leader && <div className="row wrap"><button className="btn ghost sm" onClick={() => setEdit(true)}><Icon name="pencil" size={16} />Edit details</button>
        <label className="btn ghost sm"><Icon name="image" size={16} />Cover photo<input type="file" accept="image/*" hidden onChange={(e) => cover(e.target.files?.[0])} /></label></div>}
    </div>
  );
}
