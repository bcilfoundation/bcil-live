import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { isNative } from "../lib/native";

// Rolling cards at the top of Home: live now, programmes coming up, announcements and the key programmes.
// They move on by themselves every few seconds; people can also swipe or tap the dots.
type Act = { label: string; to?: string; onClick?: () => void };
export type Slide = {
  key: string; eyebrow: string; title: string; sub?: string; image?: string | null; tone?: "navy" | "gold" | "live" | "green" | "purple";
  cta?: Act; cta2?: Act; quote?: boolean;
};

async function openUrl(url: string) {
  if (isNative) { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url }); return; }
  window.open(url, "_blank", "noopener");
}

function Cta({ c, primary }: { c: Act; primary?: boolean }) {
  const cls = `btn sm ${primary ? "spot-btn" : "spot-btn ghost"}`;
  if (c.onClick || !c.to) return <button className={cls} onClick={c.onClick}>{c.label}</button>;
  return c.to.startsWith("/") ? <Link className={cls} to={c.to}>{c.label}</Link>
    : <button className={cls} onClick={() => openUrl(c.to!)}>{c.label}</button>;
}

export default function Spotlight({ slides }: { slides: Slide[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const paused = useRef(false);
  const n = slides.length;

  // follow the card in view as people swipe
  function onScroll() {
    const el = track.current; if (!el) return;
    setI(Math.round(el.scrollLeft / el.clientWidth));
  }
  function go(k: number) {
    const el = track.current; if (!el) return;
    el.scrollTo({ left: k * el.clientWidth, behavior: "smooth" });
  }
  // move on every 5 seconds, unless someone is touching it or the tab is hidden
  useEffect(() => {
    if (n < 2) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = setInterval(() => {
      if (paused.current || document.hidden) return;
      go((i + 1) % n);
    }, 5000);
    return () => clearInterval(t);
  }, [i, n]);

  if (!n) return null;
  return (
    <div className="spot" aria-roledescription="carousel" aria-label="Spotlight"
      onPointerDown={() => { paused.current = true; }} onPointerUp={() => { setTimeout(() => { paused.current = false; }, 4000); }}
      onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }}>
      <div className="spot-track" ref={track} onScroll={onScroll}>
        {slides.map((s, k) => (
          <div key={s.key} className={`spot-card tone-${s.tone ?? "navy"}${s.quote ? " is-quote" : ""}`} role="group" aria-roledescription="slide" aria-label={`${k + 1} of ${n}`}>
            {s.image && <span className="spot-bg" style={{ backgroundImage: `url(${s.image})` }} />}
            <div className="spot-body">
              <span className="spot-eyebrow">{s.eyebrow}</span>
              <b className="spot-title">{s.title}</b>
              {s.sub && <span className="spot-sub">{s.sub}</span>}
              {(s.cta || s.cta2) && <div className="spot-acts">{s.cta && <Cta c={s.cta} primary />}{s.cta2 && <Cta c={s.cta2} />}</div>}
            </div>
          </div>
        ))}
      </div>
      {n > 1 && <div className="spot-dots">{slides.map((s, k) => (
        <button key={s.key} className={k === i ? "on" : ""} aria-label={`Show card ${k + 1}`} aria-current={k === i} onClick={() => go(k)} />
      ))}</div>}
    </div>
  );
}
