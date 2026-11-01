import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import Avatar from "./Avatar";
import Icon from "./Icon";

type Person = { id: string; full_name: string; avatar_url: string | null; bio: string | null; role: string };
type Link = { id: number; requester: string; addressee: string; status: "pending" | "accepted" };
const ROLE_LABEL: Record<string, string> = { admin: "BCIL team", moderator: "Moderator", mentor: "Mentor" };

// Tap someone's name or photo in a chat or live room: see who they are, add them as a friend or message them.
export default function PersonSheet({ userId, close }: { userId: string; close: () => void }) {
  const { session } = useAuth();
  const me = session!.user.id;
  const nav = useNavigate();
  const [p, setP] = useState<Person | null>(null);
  const [link, setLink] = useState<Link | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: person }, { data: f }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, avatar_url, bio, role").eq("id", userId).maybeSingle(),
      supabase.from("friendships").select("id, requester, addressee, status")
        .or(`and(requester.eq.${me},addressee.eq.${userId}),and(requester.eq.${userId},addressee.eq.${me})`).maybeSingle(),
    ]);
    setP(person as Person | null);
    setLink((f as Link | null) ?? null);
  };
  useEffect(() => { load(); }, [userId]);

  async function act(label: string, run: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true); setError("");
    const { error } = await run();
    setBusy(false);
    if (error) setError(`${label} didn't work: ${/row-level security/i.test(error.message) ? "this connection isn't allowed. Under-18 members can connect with BCIL staff and mentors only." : /duplicate/i.test(error.message) ? "there is already a request between you." : error.message}`);
    else load();
  }
  async function message() {
    setBusy(true); setError("");
    const { data, error } = await supabase.rpc("start_dm", { other: userId });
    setBusy(false);
    if (error) setError(error.message); else { close(); nav(`/chat?room=${data}`); }
  }

  return (
    <>
      <div className="sheet-back" onClick={close} />
      <div className="sheet personsheet" role="dialog" aria-label="Profile">
        {!p ? <p className="muted">Loading…</p> : <>
          <div className="ps-head">
            <Avatar name={p.full_name} url={p.avatar_url} size={72} />
            <div className="grow"><h3>{p.full_name || "Member"}</h3>
              {ROLE_LABEL[p.role] && <span className="pill soon">{ROLE_LABEL[p.role]}</span>}</div>
            <button className="linkbtn" onClick={close} aria-label="Close">✕</button>
          </div>
          {p.bio ? <p className="prewrap">{p.bio}</p> : <p className="muted">No bio yet.</p>}
          {error && <p className="err" role="alert">{error}</p>}
          {userId === me ? <p className="muted">This is you. Edit your profile from the menu.</p> : (
            <div className="ps-acts">
              {link === null && <button className="btn primary" disabled={busy} onClick={() => act("Friend request", () => supabase.from("friendships").insert({ requester: me, addressee: userId }))}><Icon name="userplus" size={18} />Add friend</button>}
              {link?.status === "pending" && link.requester === me && <><span className="muted">Friend request sent</span>
                <button className="btn ghost" disabled={busy} onClick={() => act("Cancel", () => supabase.from("friendships").delete().eq("id", link.id))}>Cancel request</button></>}
              {link?.status === "pending" && link.addressee === me && <button className="btn primary" disabled={busy} onClick={() => act("Accept", () => supabase.from("friendships").update({ status: "accepted" }).eq("id", link.id))}>Accept friend request</button>}
              {link?.status === "accepted" && <><span className="ok">✓ Friends</span><button className="btn primary" disabled={busy} onClick={message}>Message</button></>}
            </div>
          )}
        </>}
      </div>
    </>
  );
}
