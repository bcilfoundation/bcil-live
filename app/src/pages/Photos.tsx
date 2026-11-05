import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { uploadPhoto } from "../lib/media";
import LibraryTabs from "../components/LibraryTabs";

type Album = { id: number; title: string; subtitle: string | null; taken_on: string | null; photos: string[]; sort: number };
const src = (u: string) => (u.startsWith("/") ? `${import.meta.env.BASE_URL}${u.slice(1)}` : u);

// Photos from BCIL programmes, one album per programme. Staff add albums and photos here.
export default function Photos() {
  const { isStaff } = useAuth();
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [open, setOpen] = useState<Album | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => supabase.from("albums").select("*").order("sort").order("taken_on", { ascending: false })
    .then(({ data }) => { const list = (data ?? []) as Album[]; setAlbums(list); setOpen((cur) => cur && (list.find((a) => a.id === cur.id) ?? null)); });
  useEffect(() => { load(); }, []);

  if (open) return (
    <section className="view">
      <button className="linkbtn" onClick={() => setOpen(null)}>← All albums</button>
      <h1 style={{ marginTop: 6 }}>{open.title}</h1>
      {open.subtitle && <p className="muted">{open.subtitle} · {open.photos.length} photos</p>}
      <div className="photogrid">{open.photos.map((u, i) => (
        <button key={u} className="plainbtn" onClick={() => setView(i)} aria-label={`Photo ${i + 1}`}><img src={src(u)} alt="" loading="lazy" /></button>))}</div>
      {isStaff && <AddPhotos album={open} done={load} />}
      {view !== null && <div className="lightbox" role="dialog" aria-label="Photo" onClick={() => setView(null)}>
        <img src={src(open.photos[view])} alt="" />
        <button className="lightbox-x" aria-label="Close">✕</button>
        {view > 0 && <button className="lightbox-nav prev" aria-label="Previous" onClick={(e) => { e.stopPropagation(); setView(view - 1); }}>‹</button>}
        {view < open.photos.length - 1 && <button className="lightbox-nav next" aria-label="Next" onClick={(e) => { e.stopPropagation(); setView(view + 1); }}>›</button>}
      </div>}
    </section>
  );

  return (
    <section className="view">
      <LibraryTabs />
      <h1>Photos</h1>
      <p className="muted">Moments from BCIL programmes.</p>
      {albums === null ? <p className="muted">Loading…</p> : albums.length === 0 ? <p className="muted">No albums yet.</p> : (
        <div className="albumgrid">{albums.map((a) => (
          <button key={a.id} className="albumcard" onClick={() => setOpen(a)}>
            {a.photos[0] ? <img src={src(a.photos[0])} alt="" loading="lazy" /> : <span className="newart">📷</span>}
            <b>{a.title}</b><small className="muted">{[a.subtitle, `${a.photos.length} photos`].filter(Boolean).join(" · ")}</small>
          </button>))}</div>)}
      {isStaff && (adding ? <NewAlbum done={() => { setAdding(false); load(); }} /> : <button className="linkbtn" onClick={() => setAdding(true)}>+ New album</button>)}
    </section>
  );
}

function NewAlbum({ done }: { done: () => void }) {
  const [title, setTitle] = useState(""); const [subtitle, setSubtitle] = useState(""); const [err, setErr] = useState("");
  async function save() {
    if (!title.trim()) { setErr("Give the album a name."); return; }
    const { error } = await supabase.from("albums").insert({ title: title.trim(), subtitle: subtitle.trim() || null });
    if (error) setErr(error.message); else done();
  }
  return (<div className="card" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
    <b>New album</b>
    <input placeholder="Programme, e.g. Finding Campus Balance 2027" value={title} onChange={(e) => setTitle(e.target.value)} />
    <input placeholder="When, e.g. January 2027" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
    {err && <p className="err">{err}</p>}
    <div className="row" style={{ gap: 8 }}><button className="btn primary sm" onClick={save}>Create</button><button className="btn ghost sm" onClick={done}>Cancel</button></div>
  </div>);
}

function AddPhotos({ album, done }: { album: Album; done: () => void }) {
  const { session } = useAuth();
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  async function add(files: FileList | null) {
    if (!files?.length) return; setErr("");
    const urls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setBusy(`Uploading ${i + 1} of ${files.length}…`);
      try { urls.push(await uploadPhoto(session!.user.id, files[i], 1600)); } catch (e) { setErr((e as Error).message); }
    }
    const { error } = await supabase.from("albums").update({ photos: [...album.photos, ...urls] }).eq("id", album.id);
    setBusy(""); if (error) setErr(error.message); else done();
  }
  async function remove() {
    if (!window.confirm(`Delete the album “${album.title}”? The photos stay in storage.`)) return;
    await supabase.from("albums").delete().eq("id", album.id); location.reload();
  }
  return (<div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
    <label className="btn primary sm">{busy || "+ Add photos"}<input type="file" accept="image/*" multiple hidden disabled={!!busy} onChange={(e) => add(e.target.files)} /></label>
    <button className="btn ghost sm" onClick={remove}>Delete album</button>
    {err && <p className="err">{err}</p>}
  </div>);
}
