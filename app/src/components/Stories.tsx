import { useEffect, useState } from "react";
import { isNative } from "../lib/native";

type Post = { id: number; link: string; title: string; excerpt: string; image: string | null; date: string };
const API = "https://bcilfoundation.org/wp-json/wp/v2/posts?per_page=3&_embed=wp:featuredmedia&_fields=id,link,title,excerpt,date,_links,_embedded";
const strip = (h: string) => { const d = document.createElement("div"); d.innerHTML = h; return (d.textContent ?? "").trim(); };

async function open(url: string) {
  if (isNative) { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url }); return; }
  window.open(url, "_blank", "noopener");
}

/** The newest posts from the Stories page on bcilfoundation.org */
export function useStories() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  useEffect(() => {
    fetch(API).then((r) => r.json()).then((list: { id: number; link: string; date: string; title: { rendered: string }; excerpt: { rendered: string };
      _embedded?: { "wp:featuredmedia"?: { source_url?: string; media_details?: { sizes?: { medium_large?: { source_url: string }; medium?: { source_url: string } } } }[] } }[]) =>
      setPosts(list.map((p) => {
        const m = p._embedded?.["wp:featuredmedia"]?.[0];
        return { id: p.id, link: p.link, date: p.date, title: strip(p.title.rendered), excerpt: strip(p.excerpt.rendered),
          image: m?.media_details?.sizes?.medium_large?.source_url ?? m?.media_details?.sizes?.medium?.source_url ?? m?.source_url ?? null };
      }))).catch(() => setPosts([]));
  }, []);
  return posts;
}

export default function Stories() {
  const posts = useStories();
  if (!posts?.length) return null;
  return (<>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
      <h2 className="home-h">Stories</h2>
      <button className="linkbtn" onClick={() => open("https://bcilfoundation.org/stories/")}>See all ›</button>
    </div>
    <div className="newrow">{posts.map((p) => (
      <button key={p.id} className="newcard storycard" onClick={() => open(p.link)}>
        {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="newart" aria-hidden="true">📰</span>}
        <b>{p.title}</b><small className="muted">{new Date(p.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small>
      </button>
    ))}</div>
  </>);
}
