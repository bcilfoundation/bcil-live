import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { shrink } from "../lib/media";
import { coverFromPdf, openPdf, renderPage } from "../lib/pdf";
import Icon from "../components/Icon";

export type Book = { id: string; title: string; author: string | null; category: string; description: string | null; cover_url: string | null; file_url: string; pages: number | null; published: boolean; created_at: string };
type Progress = { book_id: string; page: number; updated_at: string };

export const CATEGORIES = ["Mentorship", "Faith", "Career", "Leadership", "Study skills", "Wellbeing"];
const NEW_DAYS = 14;

export default function Reading() {
  const { session, isStaff } = useAuth();
  const uid = session!.user.id;
  const [books, setBooks] = useState<Book[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [params, setParams] = useSearchParams();
  const openId = params.get("book");
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const [{ data: b }, { data: p }] = await Promise.all([
      supabase.from("books").select("*").order("created_at", { ascending: false }),
      supabase.from("book_progress").select("book_id, page, updated_at").eq("user_id", uid),
    ]);
    setBooks((b as Book[]) || []);
    setProgress(Object.fromEntries(((p as Progress[]) || []).map((x) => [x.book_id, x])));
    setLoaded(true);
  };
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => books.filter((b) =>
    (cat === "All" || b.category === cat) &&
    (!q.trim() || `${b.title} ${b.author || ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [books, cat, q]);
  const reading = books.filter((b) => progress[b.id]).sort((a, b) => progress[b.id].updated_at.localeCompare(progress[a.id].updated_at)).slice(0, 6);
  // shelves: the usual ones first, then any shelf the team made up, as long as it has books
  const shelves = [...new Set([...CATEGORIES, ...books.map((b) => b.category).filter(Boolean)])];
  const cats = ["All", ...shelves.filter((c) => books.some((b) => b.category === c))];
  const open = books.find((b) => b.id === openId);

  return (
    <section className="view reading">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div><h1>Reading room</h1><p className="muted">Books and guides for mentorship. Read them right here in the app.</p></div>
        {isStaff && <button className="btn primary sm" style={{ whiteSpace: "nowrap" }} onClick={() => setAdding(true)}>+ Add book</button>}
      </div>

      {reading.length > 0 && <>
        <h2 className="shelf-h">Continue reading</h2>
        <div className="shelf-row">{reading.map((b) => <Cover key={b.id} b={b} p={progress[b.id]} onOpen={() => setParams({ book: b.id })} />)}</div>
      </>}

      <div className="row shelf-tools">
        <input className="search" placeholder="Search title or author" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {cats.length > 2 && <div className="chips">{cats.map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}</div>}

      <div className="shelf">
        {shown.map((b) => <Cover key={b.id} b={b} p={progress[b.id]} onOpen={() => setParams({ book: b.id })} />)}
      </div>
      {loaded && books.length === 0 && <div className="card empty">
        <b>The shelf is empty for now.</b>
        <p className="muted">{isStaff ? "Tap “Add a book” to upload a PDF. Mentees will see it here." : "Books for the mentorship programme will appear here soon."}</p>
      </div>}
      {loaded && books.length > 0 && shown.length === 0 && <p className="muted">No books match.</p>}

      {adding && <AddBook uid={uid} shelves={shelves} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
      {open && <Reader book={open} uid={uid} start={progress[open.id]?.page || 1} isStaff={isStaff} shelves={shelves}
        onClose={() => { setParams({}); load(); }} onDeleted={() => { setParams({}); load(); }} />}
    </section>
  );
}

function Cover({ b, p, onOpen }: { b: Book; p?: Progress; onOpen: () => void }) {
  const isNew = Date.now() - new Date(b.created_at).getTime() < NEW_DAYS * 864e5;
  const pct = p && b.pages ? Math.round((p.page / b.pages) * 100) : 0;
  return (
    <button className="book" onClick={onOpen} title={b.title}>
      <span className="bookcover">
        {b.cover_url ? <img src={b.cover_url} alt="" loading="lazy" /> : <span className="nocover">{b.title}</span>}
        {isNew && !p && <span className="newbadge">NEW</span>}
        {!b.published && <span className="newbadge draft">DRAFT</span>}
        {p && b.pages ? <span className="bookbar"><i style={{ width: `${pct}%` }} /></span> : null}
      </span>
      <b>{b.title}</b>
      <small className="muted">{p ? `Page ${p.page}${b.pages ? ` of ${b.pages}` : ""}` : b.author || b.category}</small>
    </button>
  );
}

function Reader({ book, uid, start, isStaff, shelves, onClose, onDeleted }: { book: Book; uid: string; start: number; isStaff: boolean; shelves: string[]; onClose: () => void; onDeleted: () => void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(start);
  const [zoom, setZoom] = useState(1);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const saveT = useRef<number>();
  const touch = useRef<number | null>(null);

  useEffect(() => {
    let close: (() => void) | null = null; let gone = false;
    openPdf(book.file_url).then(({ doc: x, close: c }) => {
      if (gone) { c(); return; }
      close = c; setDoc(x); setPage((p) => Math.min(Math.max(1, p), x.numPages));
      if (!book.pages && isStaff) supabase.from("books").update({ pages: x.numPages }).eq("id", book.id).then(() => {});
    }).catch(() => setErr("This book could not be opened. Check your connection and try again."));
    document.body.style.overflow = "hidden";
    return () => { gone = true; close?.(); document.body.style.overflow = ""; };
  }, [book.id]);

  useEffect(() => {
    if (!doc || !canvas.current || !box.current) return;
    let task: { cancel: () => void } | null = null; let live = true;
    const w = Math.min(box.current.clientWidth - 16, 900) * zoom;
    renderPage(doc, page, canvas.current, w).then((t) => { if (!live) t.cancel(); task = t; }).catch(() => {});
    box.current.scrollTo({ top: 0 });
    window.clearTimeout(saveT.current);
    saveT.current = window.setTimeout(() => {
      supabase.from("book_progress").upsert({ user_id: uid, book_id: book.id, page, updated_at: new Date().toISOString() }).then(() => {});
    }, 800);
    return () => { live = false; task?.cancel(); };
  }, [doc, page, zoom]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft") prev(); else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });

  const total = doc?.numPages || book.pages || 0;
  const next = () => setPage((p) => (total ? Math.min(total, p + 1) : p + 1));
  const prev = () => setPage((p) => Math.max(1, p - 1));

  const remove = async () => {
    if (!confirm(`Remove “${book.title}” from the reading room?`)) return;
    await supabase.from("books").delete().eq("id", book.id);
    onDeleted();
  };
  const moveShelf = async () => {
    const v = window.prompt(`Move “${book.title}” to which shelf?\n\nShelves: ${shelves.join(", ")}\n\nType one of these or a new shelf name.`, book.category)?.trim().replace(/\s+/g, " ");
    if (!v || v === book.category) return;
    await supabase.from("books").update({ category: v.slice(0, 40) }).eq("id", book.id); onClose();
  };
  const togglePublish = async () => { await supabase.from("books").update({ published: !book.published }).eq("id", book.id); onClose(); };

  return (
    <div className="reader" role="dialog" aria-label={book.title}>
      <header className="reader-top">
        <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="back" /></button>
        <div className="grow"><b>{book.title}</b>{book.author && <small className="muted"> · {book.author}</small>}</div>
        <button className="iconbtn" onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))} aria-label="Zoom out">−</button>
        <button className="iconbtn" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Zoom in">+</button>
        <button className="iconbtn" onClick={() => setInfo((v) => !v)} aria-label="About this book">ⓘ</button>
      </header>
      {info && <div className="reader-info">
        {book.description && <p>{book.description}</p>}
        <p className="muted">{book.category}{total ? ` · ${total} pages` : ""}</p>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <a className="btn ghost" href={book.file_url} target="_blank" rel="noreferrer" download>Download PDF</a>
          {isStaff && <button className="btn ghost" onClick={moveShelf}>Change shelf</button>}
          {isStaff && <button className="btn ghost" onClick={togglePublish}>{book.published ? "Hide from members" : "Publish"}</button>}
          {isStaff && <button className="btn ghost danger" onClick={remove}>Remove book</button>}
        </div>
      </div>}
      <div className="reader-page" ref={box}
        onTouchStart={(e) => { touch.current = zoom === 1 ? e.touches[0].clientX : null; }}
        onTouchEnd={(e) => { if (touch.current == null) return; const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 60) (dx < 0 ? next : prev)(); touch.current = null; }}>
        {err ? <p className="err">{err}</p> : !doc ? <p className="muted">Opening the book…</p> : null}
        <canvas ref={canvas} />
      </div>
      <footer className="reader-bottom">
        <button className="btn ghost" onClick={prev} disabled={page <= 1}>‹ Previous</button>
        <span>{total ? <>Page <input className="pagebox" inputMode="numeric" value={page} onChange={(e) => { const n = parseInt(e.target.value); if (n >= 1 && n <= total) setPage(n); }} /> of {total}</> : `Page ${page}`}</span>
        <button className="btn ghost" onClick={next} disabled={!!total && page >= total}>Next ›</button>
      </footer>
    </div>
  );
}

function AddBook({ uid, shelves, onClose, onDone }: { uid: string; shelves: string[]; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setErr("");
    const f = new FormData(e.currentTarget);
    const pdf = f.get("pdf") as File; const cover = f.get("cover") as File;
    const title = String(f.get("title") || "").trim();
    if (!title) return setErr("Give the book a title.");
    const shelf = String(f.get("category") || "").trim().replace(/\s+/g, " ");
    if (!shelf) return setErr("Pick a shelf or type a new one.");
    if (!pdf || !pdf.size) return setErr("Choose the PDF file.");
    if (pdf.type && pdf.type !== "application/pdf") return setErr("The book must be a PDF file.");
    if (pdf.size > 50 * 1024 * 1024) return setErr("That PDF is bigger than 50 MB. Please compress it first (e.g. ilovepdf.com/compress_pdf).");
    try {
      const stamp = `${uid}/${Date.now()}`;
      setBusy("Uploading the PDF…");
      const up = await supabase.storage.from("books").upload(`${stamp}.pdf`, pdf, { contentType: "application/pdf" });
      if (up.error) throw up.error;
      const file_url = supabase.storage.from("books").getPublicUrl(`${stamp}.pdf`).data.publicUrl;
      setBusy("Making the cover…");
      let coverBlob: Blob; let pages: number | null = null;
      if (cover && cover.size) coverBlob = await shrink(cover, 600);
      else { const c = await coverFromPdf(pdf); coverBlob = c.blob; pages = c.pages; }
      const cu = await supabase.storage.from("books").upload(`${stamp}-cover.jpg`, coverBlob, { contentType: "image/jpeg" });
      const cover_url = cu.error ? null : supabase.storage.from("books").getPublicUrl(`${stamp}-cover.jpg`).data.publicUrl;
      setBusy("Saving…");
      const published = f.get("published") === "on";
      const { data: saved, error } = await supabase.from("books").insert({
        title, author: String(f.get("author") || "").trim() || null, category: shelf,
        description: String(f.get("description") || "").trim() || null, file_url, cover_url, pages,
        published, created_by: uid,
      }).select("id").single();
      if (error) throw error;
      if (published && f.get("notify") === "on")
        await supabase.rpc("notify_everyone", { p_kind: "book", p_body: `📚 New in the Reading room: ${title}`, p_link: `/reading?book=${saved.id}` });
      onDone();
    } catch (x) { setErr((x as Error).message || "Upload failed. Try again."); setBusy(""); }
  };
  return (
    <div className="rr-back" onClick={onClose}>
      <form className="rr-sheet stack" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Add a book</h2>
        <label className="field">Title<input name="title" required /></label>
        <label className="field">Author<input name="author" /></label>
        <label className="field">Shelf <small className="muted">(pick one, or type a new shelf name)</small>
          <input name="category" list="rr-shelves" defaultValue="Mentorship" maxLength={40} autoComplete="off" onFocus={(e) => e.currentTarget.select()} />
          <datalist id="rr-shelves">{shelves.map((c) => <option key={c} value={c} />)}</datalist></label>
        <label className="field">Short description (optional)<textarea name="description" rows={3} /></label>
        <label className="field">PDF file (up to 50 MB)<input name="pdf" type="file" accept="application/pdf,.pdf" required /></label>
        <label className="field">Cover image (optional; we use the first page if you skip this)<input name="cover" type="file" accept="image/*" /></label>
        <label className="choice"><input type="checkbox" name="published" defaultChecked /> Show it to members now</label>
        <label className="choice"><input type="checkbox" name="notify" defaultChecked /> Tell everyone (a notification on their phones). It also shows on Home for 7 days.</label>
        <p className="muted small">Only upload books BCIL has the right to share: your own guides, free or public-domain books, or books whose author has given permission.</p>
        {err && <p className="err">{err}</p>}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" disabled={!!busy}>{busy || "Upload"}</button>
          <button type="button" className="btn ghost" onClick={onClose} disabled={!!busy}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
