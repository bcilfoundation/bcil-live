import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { uploadPhoto } from "../lib/media";
import { isNative } from "../lib/native";

type Post = { id: string; title: string; body: string | null; image_url: string | null; link_url: string | null; link_label: string | null; ends_on: string | null; published: boolean; sort: number };
const today = () => new Date().toISOString().slice(0, 10);

// Announcements with flyers on Home. Staff add, edit and remove them right here.
export default function HomePosts() {
  const { isStaff } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [editing, setEditing] = useState<Post | "new" | null>(null);
  const [flyer, setFlyer] = useState<string | null>(null);
  const load = () => supabase.from("home_posts").select("*").order("sort").order("created_at", { ascending: false })
    .then(({ data }) => setPosts(((data ?? []) as Post[]).filter((p) => isStaff || (p.published && (!p.ends_on || p.ends_on >= today())))));
  useEffect(() => { load(); }, [isStaff]);

  async function open(url: string) {
    if (url.startsWith("/")) { location.href = `${import.meta.env.BASE_URL}${url.slice(1)}`; return; }
    if (isNative) { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url }); return; }
    window.open(url, "_blank", "noopener");
  }

  if (!posts.length && !isStaff) return null;
  return (
    <div className="homeposts">
      {posts.map((p) => {
        const hidden = !p.published || (!!p.ends_on && p.ends_on < today());
        return (
          <div key={p.id} className={`hpost${hidden ? " hidden" : ""}`}>
            {p.image_url && <button className="plainbtn hpost-img" onClick={() => setFlyer(p.image_url)} aria-label="View flyer"><img src={p.image_url} alt="" loading="lazy" /></button>}
            <div className="grow">
              <span className="eyebrow">📢 Announcement{hidden ? " · hidden from members" : ""}</span>
              <b>{p.title}</b>
              {p.body && <p>{p.body}</p>}
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {p.link_url && <button className="btn primary sm" onClick={() => open(p.link_url!)}>{p.link_label || "Learn more"}</button>}
                {isStaff && <button className="btn ghost sm" onClick={() => setEditing(p)}>✏️ Edit</button>}
              </div>
            </div>
          </div>
        );
      })}
      {isStaff && <button className="linkbtn hpost-add" onClick={() => setEditing("new")}>+ Add an announcement to Home</button>}
      {flyer && <div className="lightbox" role="dialog" aria-label="Flyer" onClick={() => setFlyer(null)}><img src={flyer} alt="" /><button className="lightbox-x" aria-label="Close">✕</button></div>}
      {editing && <Editor p={editing === "new" ? null : editing} close={() => setEditing(null)} saved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function Editor({ p, close, saved }: { p: Post | null; close: () => void; saved: () => void }) {
  const { session } = useAuth();
  const [f, setF] = useState({ title: p?.title ?? "", body: p?.body ?? "", image_url: p?.image_url ?? "", link_url: p?.link_url ?? "", link_label: p?.link_label ?? "", ends_on: p?.ends_on ?? "", published: p?.published ?? true, sort: p?.sort ?? 100 });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function pick(file?: File) {
    if (!file) return; setBusy(true); setErr("");
    try { const url = await uploadPhoto(session!.user.id, file, 1600); setF((x) => ({ ...x, image_url: url })); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  async function save() {
    if (!f.title.trim()) { setErr("Add a title."); return; }
    let link = f.link_url.trim();
    if (link && !link.startsWith("/") && !/^https?:\/\//.test(link)) link = "https://" + link;
    setBusy(true); setErr("");
    const row = { title: f.title.trim(), body: f.body.trim() || null, image_url: f.image_url || null, link_url: link || null, link_label: f.link_label.trim() || null,
      ends_on: f.ends_on || null, published: f.published, sort: Number(f.sort) || 100 };
    const { error } = p ? await supabase.from("home_posts").update(row).eq("id", p.id) : await supabase.from("home_posts").insert(row);
    setBusy(false);
    if (error) setErr(error.message); else saved();
  }
  async function remove() {
    if (!p || !window.confirm(`Remove “${p.title}” from Home?`)) return;
    const { error } = await supabase.from("home_posts").delete().eq("id", p.id);
    if (error) setErr(error.message); else saved();
  }
  return (
    <>
      <div className="sheet-back" onClick={close} />
      <div className="sheet tall" role="dialog" aria-label="Announcement">
        <div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>{p ? "Edit announcement" : "New announcement on Home"}</h3><button className="linkbtn" onClick={close}>Close</button></div>
        <label className="field">Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. FCB 2027 registration is open" /></label>
        <label className="field">Message <small className="muted">(optional, keep it short)</small><textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          {f.image_url && <img src={f.image_url} alt="" style={{ width: 60, height: 80, objectFit: "cover", borderRadius: 6 }} />}
          <label className="btn ghost sm">{busy ? "Uploading…" : f.image_url ? "Change flyer" : "Add a flyer"}<input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
          {f.image_url && <button className="linkbtn" onClick={() => setF({ ...f, image_url: "" })}>Remove flyer</button>}
        </div>
        <div className="grid2">
          <label className="field">Button text <small className="muted">(optional)</small><input value={f.link_label} onChange={(e) => setF({ ...f, link_label: e.target.value })} placeholder="e.g. Register now" /></label>
          <label className="field">Button link <small className="muted">(optional)</small><input value={f.link_url} onChange={(e) => setF({ ...f, link_url: e.target.value })} placeholder="/register/fcb27-registration or https://…" inputMode="url" /></label>
        </div>
        <label className="field">Show until <small className="muted">(optional; it hides itself after this day)</small><input type="date" value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /> Show it on Home</label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" disabled={busy} onClick={save}>Save</button>
          {p && <button className="btn ghost" style={{ color: "var(--live)" }} disabled={busy} onClick={remove}>Remove</button>}
        </div>
      </div>
    </>
  );
}
