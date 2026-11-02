import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { uploadPhoto } from "../lib/media";
import { isNative } from "../lib/native";

type Seller = { area: string; name: string; phone: string };
export type ShopBook = { id: string; title: string; author: string; description: string | null; cover_url: string | null; price_text: string | null; amazon_url: string | null; sellers: Seller[]; published: boolean; sort: number };

const img = (u: string | null) => (!u ? "" : u.startsWith("/") ? `${import.meta.env.BASE_URL}${u.slice(1)}` : u);
const digits = (p: string) => p.replace(/[^\d]/g, "");
const pretty = (p: string) => { const d = digits(p); return d.startsWith("233") ? `+233 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : d.startsWith("1") ? `+1 ${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}` : p; };
async function openLink(url: string) {
  if (isNative) { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url }); return; }
  window.open(url, "_blank", "noopener");
}

// Books written by BCIL people: buy on Amazon, or order from a BCIL contact in Ghana (WhatsApp or call)
export default function Shop() {
  const { isStaff } = useAuth();
  const [books, setBooks] = useState<ShopBook[] | null>(null);
  const [open, setOpen] = useState<ShopBook | null>(null);
  const [editing, setEditing] = useState<ShopBook | "new" | null>(null);
  const load = () => supabase.from("shop_books").select("*").order("sort").order("created_at").then(({ data }) => setBooks((data ?? []) as ShopBook[]));
  useEffect(() => { load(); }, []);

  return (
    <section className="view">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div><h1>Bookshop</h1><p className="muted">Books by BCIL Foundation and our members. Order on Amazon, or get a copy from a contact near you.</p></div>
        {isStaff && <button className="btn primary sm" style={{ whiteSpace: "nowrap" }} onClick={() => setEditing("new")}>+ Add book</button>}
      </div>
      {books === null ? <p className="muted">Loading…</p> : books.length === 0 ? <div className="empty"><b>No books yet</b></div> : (
        <div className="shopgrid">{books.map((b) => (
          <button key={b.id} className="shopcard" onClick={() => setOpen(b)}>
            {b.cover_url ? <img src={img(b.cover_url)} alt="" loading="lazy" /> : <span className="shopcover">📖</span>}
            <b>{b.title}</b><small className="muted">{b.author}</small>
            {b.price_text && <small className="shopprice">{b.price_text}</small>}
            {!b.published && <span className="pill">Hidden</span>}
            <span className="btn primary sm">Get a copy</span>
          </button>
        ))}</div>
      )}

      {open && <BookSheet b={open} isStaff={isStaff} close={() => setOpen(null)} edit={() => { setEditing(open); setOpen(null); }} />}
      {editing && <BookEditor b={editing === "new" ? null : editing} close={() => setEditing(null)} saved={() => { setEditing(null); load(); }} />}
    </section>
  );
}

function BookSheet({ b, isStaff, close, edit }: { b: ShopBook; isStaff: boolean; close: () => void; edit: () => void }) {
  const wa = (s: Seller) => `https://wa.me/${digits(s.phone)}?text=${encodeURIComponent(`Hello ${s.name}, I'd like to get a copy of "${b.title}" by ${b.author}. (From the BCIL Live app)`)}`;
  return (
    <>
      <div className="sheet-back" onClick={close} />
      <div className="sheet tall booksheet" role="dialog" aria-label={b.title}>
        <div className="row" style={{ justifyContent: "space-between" }}><span /><button className="linkbtn" onClick={close}>Close</button></div>
        <div className="bs-head">
          {b.cover_url ? <img src={img(b.cover_url)} alt="" /> : <span className="shopcover">📖</span>}
          <div><h2 style={{ margin: 0 }}>{b.title}</h2><p className="muted" style={{ margin: "4px 0" }}>by {b.author}</p>{b.price_text && <b>{b.price_text}</b>}</div>
        </div>
        {b.description && <p className="prewrap">{b.description}</p>}
        {b.amazon_url && <button className="btn primary" onClick={() => openLink(b.amazon_url!)}>🛒 Buy on Amazon</button>}
        {b.sellers.length > 0 && <>
          <h3 style={{ margin: "6px 0 0" }}>Get a copy near you</h3>
          <div className="sellers">{b.sellers.map((s, i) => (
            <div key={i} className="seller">
              <div className="grow"><b>{s.area}</b><small className="muted">{s.name} · {pretty(s.phone)}</small></div>
              <button className="btn sm wa" onClick={() => openLink(wa(s))} aria-label={`WhatsApp ${s.name}`}>WhatsApp</button>
              <a className="btn ghost sm" href={`tel:+${digits(s.phone)}`} aria-label={`Call ${s.name}`}>Call</a>
            </div>
          ))}</div>
        </>}
        {isStaff && <button className="btn ghost" onClick={edit}>✏️ Edit this book</button>}
      </div>
    </>
  );
}

function BookEditor({ b, close, saved }: { b: ShopBook | null; close: () => void; saved: () => void }) {
  const { session } = useAuth();
  const [f, setF] = useState({
    title: b?.title ?? "", author: b?.author ?? "", description: b?.description ?? "", price_text: b?.price_text ?? "",
    amazon_url: b?.amazon_url ?? "", cover_url: b?.cover_url ?? "", published: b?.published ?? true, sort: b?.sort ?? 100,
    sellers: (b?.sellers ?? []).map((s) => `${s.area} | ${s.name} | ${s.phone}`).join("\n"),
  });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function cover(file?: File) {
    if (!file) return; setBusy(true); setErr("");
    try { setF((x) => ({ ...x, cover_url: "" })); const url = await uploadPhoto(session!.user.id, file, 900); setF((x) => ({ ...x, cover_url: url })); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  async function save() {
    if (!f.title.trim() || !f.author.trim()) { setErr("Add the title and the author."); return; }
    const sellers: Seller[] = [];
    for (const line of f.sellers.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const [area, name, phone] = line.split("|").map((x) => x.trim());
      if (!area || !name || !phone || digits(phone).length < 9) { setErr(`Check this seller line: “${line}”. Write it as: Area | Name | Phone (with country code, e.g. +233 55 123 4567).`); return; }
      sellers.push({ area, name, phone: "+" + digits(phone) });
    }
    if (f.amazon_url && !/^https?:\/\//.test(f.amazon_url.trim())) { setErr("The Amazon link should start with https://"); return; }
    setBusy(true); setErr("");
    const row = { title: f.title.trim(), author: f.author.trim(), description: f.description.trim() || null, price_text: f.price_text.trim() || null,
      amazon_url: f.amazon_url.trim() || null, cover_url: f.cover_url || null, published: f.published, sort: Number(f.sort) || 100, sellers };
    const { error } = b ? await supabase.from("shop_books").update(row).eq("id", b.id) : await supabase.from("shop_books").insert(row);
    setBusy(false);
    if (error) setErr(error.message); else saved();
  }
  async function remove() {
    if (!b || !window.confirm(`Remove “${b.title}” from the Bookshop?`)) return;
    const { error } = await supabase.from("shop_books").delete().eq("id", b.id);
    if (error) setErr(error.message); else saved();
  }
  return (
    <>
      <div className="sheet-back" onClick={close} />
      <div className="sheet tall" role="dialog" aria-label="Edit book">
        <div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>{b ? "Edit book" : "Add a book"}</h3><button className="linkbtn" onClick={close}>Close</button></div>
        <label className="field">Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field">Author<input value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} placeholder="e.g. a BCIL member's name" /></label>
        <label className="field">About the book <small className="muted">(optional)</small><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="field">Price <small className="muted">(optional, e.g. GH₵ 150 · US$ 15)</small><input value={f.price_text} onChange={(e) => setF({ ...f, price_text: e.target.value })} /></label>
        <label className="field">Amazon link <small className="muted">(optional)</small><input value={f.amazon_url} onChange={(e) => setF({ ...f, amazon_url: e.target.value })} placeholder="https://www.amazon.com/dp/…" inputMode="url" /></label>
        <label className="field">Sellers in Ghana and elsewhere <small className="muted">one per line: Area | Name | Phone</small>
          <textarea value={f.sellers} onChange={(e) => setF({ ...f, sellers: e.target.value })} style={{ minHeight: 130 }} placeholder={"Cape Coast (UCC) | Benny Morgan | +233 54 234 3575\nKumasi (KNUST) | Esther | +233 54 037 7475"} /></label>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          {f.cover_url && <img src={img(f.cover_url)} alt="" style={{ width: 54, height: 72, objectFit: "cover", borderRadius: 6 }} />}
          <label className="btn ghost sm">{busy ? "Uploading…" : f.cover_url ? "Change cover" : "Add cover photo"}<input type="file" accept="image/*" hidden onChange={(e) => cover(e.target.files?.[0])} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /> Show it in the Bookshop</label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn primary" disabled={busy} onClick={save}>Save</button>
          {b && <button className="btn ghost" style={{ color: "var(--live)" }} disabled={busy} onClick={remove}>Remove</button>}
        </div>
      </div>
    </>
  );
}
