import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Quote = { id: number; show_on: string; theme: string; body: string; author: string; reflection: string | null };
const THEMES = ["All", "Integrity", "Mentorship", "Persistence", "Impact", "Responsibility", "Excellence"];

export default function Quotes() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [i, setI] = useState(0);
  const [theme, setTheme] = useState("All");

  useEffect(() => {
    // the database only returns quotes up to today, newest first
    supabase.from("quotes").select("*").order("show_on", { ascending: false }).limit(120)
      .then(({ data }) => setQuotes((data ?? []) as Quote[]));
  }, []);

  const q = quotes[i];
  async function copy() {
    if (!q) return;
    const text = `“${q.body}” — ${q.author} | BCIL Foundation Daily Quote`;
    if (navigator.share) await navigator.share({ text }).catch(() => {});
    else { await navigator.clipboard.writeText(text); alert("Quote copied. Paste it on WhatsApp or your status."); }
  }

  const past = quotes.filter((x) => theme === "All" || x.theme === theme);
  return (
    <section className="view">
      <h1>Daily Quotes</h1>
      {q ? (
        <div className="quote">
          <span className="eyebrow">{i === 0 ? "Today · " : ""}{new Date(q.show_on + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · {q.theme}</span>
          <blockquote>“{q.body}”</blockquote>
          <cite>— {q.author}</cite>
          {q.reflection && <p className="muted">Reflect: {q.reflection}</p>}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn primary" onClick={copy}>Share</button>
            {i < quotes.length - 1 && <button className="btn ghost" onClick={() => setI(i + 1)}>← Earlier</button>}
            {i > 0 && <button className="btn ghost" onClick={() => setI(i - 1)}>Later →</button>}
          </div>
        </div>
      ) : <div className="empty"><b>No quotes yet</b>Admins add them from the Admin page.</div>}
      <h2>Past quotes</h2>
      <div className="chips">{THEMES.map((t) => <button key={t} className="chip" aria-pressed={t === theme} onClick={() => setTheme(t)}>{t}</button>)}</div>
      <div className="grid2">{past.map((x) => (
        <div className="card" key={x.id}><span className="eyebrow">{x.theme}</span><b>“{x.body}”</b><small className="muted">— {x.author}</small></div>
      ))}</div>
    </section>
  );
}
