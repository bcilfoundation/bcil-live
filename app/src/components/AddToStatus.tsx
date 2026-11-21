import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

// "Add to status" from anywhere in the app: a Daily Bite, a Library video, an event.
// Call addToStatus({...}) and this sheet opens with a preview and an optional line of your own.
export type ShareCard = { type: "bite" | "video" | "event"; title: string; sub?: string; image?: string; link: string };
export const addToStatus = (card: ShareCard) => window.dispatchEvent(new CustomEvent("bcil-add-status", { detail: card }));
export const TYPE_LABEL: Record<ShareCard["type"], string> = { bite: "Daily Bite", video: "From the Library", event: "Event" };

export function ShareCardView({ card, line }: { card: ShareCard; line?: string | null }) {
  return (
    <div className={`stshare ${card.type}`}>
      {line && <p className="stshare-line">{line}</p>}
      <div className="stshare-card">
        {card.image && <img src={card.image} alt="" />}
        <div className="stshare-text">
          <span className="eyebrow">{TYPE_LABEL[card.type]}</span>
          <b>{card.title}</b>
          {card.sub && <small>{card.sub}</small>}
        </div>
      </div>
    </div>
  );
}

export default function AddToStatusSheet() {
  const { session } = useAuth();
  const [card, setCard] = useState<ShareCard | null>(null);
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const on = (e: Event) => { setCard((e as CustomEvent<ShareCard>).detail); setLine(""); setMsg(""); };
    window.addEventListener("bcil-add-status", on);
    return () => window.removeEventListener("bcil-add-status", on);
  }, []);
  if (!card || !session) return null;
  async function post() {
    setBusy(true); setMsg("");
    const { error } = await supabase.from("statuses").insert({
      user_id: session!.user.id, kind: "share", link: card!.link, body: line.trim() || null,
      card: { type: card!.type, title: card!.title.slice(0, 300), sub: card!.sub?.slice(0, 200) ?? null, image: card!.image ?? null },
    });
    setBusy(false);
    if (error) { setMsg("Could not add it to your status. Check your connection and try again."); return; }
    setMsg("Added to your status. Your friends can see it for 24 hours.");
    setTimeout(() => setCard(null), 1400);
  }
  return (
    <div className="sheet-back" role="dialog" aria-modal="true" aria-labelledby="ats-h" onClick={() => setCard(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2 id="ats-h">Add to your status</h2>
        <ShareCardView card={card} line={line.trim() || null} />
        <label className="field">Add a line of your own <small className="muted">(optional)</small>
          <input value={line} onChange={(e) => setLine(e.target.value)} maxLength={200} placeholder={card.type === "bite" ? "This one spoke to me" : "Worth watching"} /></label>
        {msg && <p className={/Could not/.test(msg) ? "err" : "muted"}>{msg}</p>}
        <button className="btn primary block" onClick={post} disabled={busy}>{busy ? "Adding…" : "Add to status"}</button>
        <button className="btn ghost block" onClick={() => setCard(null)}>Cancel</button>
      </div>
    </div>
  );
}
