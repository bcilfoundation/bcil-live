import { useEffect, useLayoutEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

// A short walkthrough the first time someone signs in. Each step lights up one part of the screen.
// Anyone can watch it again from More → Take the tour.

type Step = { sel?: string[]; title: string; text: string };
const nav = (path: string) => [`.tabbar a[href$="${path}"]`, `.side .menu a[href$="${path}"]`];
const STEPS: Step[] = [
  { title: "Welcome to BCIL Foundation 👋", text: "Here's a quick look around. It takes less than a minute." },
  { sel: [".ststack", ".strow"], title: "Statuses", text: "Tap here to see statuses from the community, or share your own photo or message. Statuses disappear after 24 hours." },
  { sel: [".needcard"], title: "What do you need?", text: "Start here to plan your year, meet Solomon, find a mentor, join Campus Sync, volunteer or give." },
  { sel: nav("/live"), title: "Live", text: "Join live sessions and meetings. You can listen, raise your hand to speak, and catch up on recordings." },
  { sel: nav("/library"), title: "Library", text: "Talks, the reading room and the bookshop." },
  { sel: nav("/chat"), title: "Chats", text: "Message friends, your Campus Sync group and other groups." },
  { sel: nav("/donate"), title: "Donate", text: "Support the work of BCIL Foundation." },
  { sel: nav("/more"), title: "More", text: "Programmes, mentorship, About us and settings, like fingerprint sign-in." },
  { sel: [".mebtn"], title: "Your profile", text: "Add a photo, edit your details, change the appearance and turn alerts on or off." },
  { title: "You're all set", text: "You can take this tour again any time from More." },
];

export function startTour() { window.dispatchEvent(new Event("bcil:tour")); }

function findTarget(sels?: string[]) {
  for (const s of sels ?? []) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(s))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
    }
  }
  return null;
}

export default function Tour() {
  const { profile, session } = useAuth();
  const loc = useLocation();
  const go = useNavigate();
  const [step, setStep] = useState<number | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null);

  // first visit: start once on Home after sign-in
  useEffect(() => {
    if (!session || !profile || step !== null || loc.pathname !== "/") return;
    let seen = !!(profile as { toured_at?: string | null }).toured_at;
    try { seen = seen || !!localStorage.getItem("bcil.toured"); } catch { /* */ }
    if (!seen) { const t = setTimeout(() => setStep(0), 1200); return () => clearTimeout(t); }
  }, [session, profile, loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => { if (loc.pathname !== "/") go("/"); setTimeout(() => setStep(0), 500); };
    window.addEventListener("bcil:tour", on);
    return () => window.removeEventListener("bcil:tour", on);
  }, [loc.pathname, go]);

  const cur = step !== null ? STEPS[step] : null;
  useLayoutEffect(() => {
    if (!cur) return;
    const el = findTarget(cur.sel);
    if (!el) { setBox(null); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const measure = () => setBox(el.getBoundingClientRect());
    const t = setTimeout(measure, 350); measure();
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { (window as unknown as { __tourOn?: boolean }).__tourOn = step !== null; }, [step]);
  function finish() {
    setStep(null);
    (window as unknown as { __tourOn?: boolean }).__tourOn = false;
    setTimeout(() => window.dispatchEvent(new Event("bcil-tour-end")), 0);
    try { localStorage.setItem("bcil.toured", "1"); } catch { /* */ }
    if (session) supabase.from("profiles").update({ toured_at: new Date().toISOString() }).eq("id", session.user.id).then(() => {});
  }
  useEffect(() => {
    if (step === null) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") finish(); if (e.key === "ArrowRight") next(); if (e.key === "ArrowLeft") back(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });
  if (step === null || !cur) return null;
  const next = () => (step + 1 < STEPS.length ? setStep(step + 1) : finish());
  const back = () => step > 0 && setStep(step - 1);

  // put the card below the highlighted part, or above it when it's near the bottom (the tab bar)
  const pad = 6;
  const vh = window.innerHeight, vw = window.innerWidth;
  let cardStyle: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%,-50%)" };
  if (box) {
    const below = box.bottom + 14, cardW = Math.min(340, vw - 24);
    const left = Math.max(12, Math.min(vw - cardW - 12, box.left + box.width / 2 - cardW / 2));
    cardStyle = box.bottom < vh * 0.62 ? { left, top: below, width: cardW } : { left, bottom: vh - box.top + 14, width: cardW };
  }
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="App tour">
      {box ? <div className="tour-hole" style={{ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} />
        : <div className="tour-dim" />}
      <div className="tour-card" style={cardStyle}>
        <small className="tour-count">{step + 1} of {STEPS.length}</small>
        <h3>{cur.title}</h3>
        <p>{cur.text}</p>
        <div className="tour-btns">
          {step + 1 < STEPS.length && <button className="linkbtn" onClick={finish}>Skip tour</button>}
          <span style={{ flex: 1 }} />
          {step > 0 && <button className="btn ghost sm" onClick={back}>Back</button>}
          <button className="btn primary sm" onClick={next} autoFocus>{step === 0 ? "Start" : step + 1 < STEPS.length ? "Next" : "Done"}</button>
        </div>
      </div>
    </div>
  );
}
