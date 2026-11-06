// "Download as Word with comments": the original .docx with the review comments added as real Word comments
// in the margin, each on the words it is about. Replies become threaded replies and resolved comments are marked done,
// so the person can edit the document, reply and resolve in Word or Google Docs.
import type { ExportComment } from "./docExport";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";

type Atom = { t: Element | null; start: number; len: number; nl?: boolean };   // t = a w:t text node (null for tabs and breaks)

function el(doc: Document, ns: string, qname: string, attrs: Record<string, string> = {}) {
  const e = doc.createElementNS(ns, qname);
  for (const [k, v] of Object.entries(attrs)) {
    const [pfx] = k.split(":");
    e.setAttributeNS(pfx === "w" ? W : pfx === "w14" ? W14 : pfx === "w15" ? W15 : pfx === "xml" ? "http://www.w3.org/XML/1998/namespace" : null, k, v);
  }
  return e;
}

/** All body text as atoms, with a virtual "\n" between paragraphs. */
function atoms(body: Element) {
  const list: Atom[] = []; let pos = 0;
  const paras = Array.from(body.getElementsByTagNameNS(W, "p"));
  for (const p of paras) {
    const walk = (n: Element) => {
      for (const c of Array.from(n.children)) {
        if (c.namespaceURI === W && c.localName === "t") { const len = (c.textContent ?? "").length; list.push({ t: c, start: pos, len }); pos += len; }
        else if (c.namespaceURI === W && (c.localName === "tab" || c.localName === "br" || c.localName === "cr")) { list.push({ t: null, start: pos, len: 1 }); pos += 1; }
        else if (!(c.namespaceURI === W && (c.localName === "p" || c.localName === "del" || c.localName === "instrText" || c.localName === "delText"))) walk(c);
      }
    };
    walk(p);
    list.push({ t: null, start: pos, len: 1, nl: true }); pos += 1;   // paragraph break
  }
  return list;
}
const rawText = (list: Atom[]) => list.map((a) => (a.t ? a.t.textContent ?? "" : a.nl ? "\n" : " ")).join("");

/** Find a quote in the document text, ignoring differences in spaces and line breaks. Returns raw [start, end). */
function find(raw: string, quote: string): [number, number] | null {
  const map: number[] = []; let norm = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = /\s/.test(raw[i]) ? " " : raw[i];
    if (ch === " " && norm.endsWith(" ")) continue;
    norm += ch; map.push(i);
  }
  const clean = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const q = clean(quote.replace(/\s+/g, " ").trim());
  if (!q) return null;
  const hay = clean(norm);
  const at = hay.indexOf(q);
  if (at < 0) return null;
  return [map[at], map[at + q.length - 1] + 1];
}

/** Split the run holding text node t at character k; returns the run that now starts at that point. */
function splitRun(doc: Document, t: Element, k: number): Element {
  const run = t.parentElement!;
  const text = t.textContent ?? "";
  const after: Element[] = []; let seen = false;
  for (const c of Array.from(run.children)) { if (c === t) { seen = true; continue; } if (seen) after.push(c); }
  const r2 = run.cloneNode(false) as Element;
  const rPr = Array.from(run.children).find((c) => c.localName === "rPr");
  if (rPr) r2.appendChild(rPr.cloneNode(true));
  const t2 = el(doc, W, "w:t", { "xml:space": "preserve" }); t2.textContent = text.slice(k);
  r2.appendChild(t2);
  for (const c of after) r2.appendChild(c);
  t.textContent = text.slice(0, k); t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  run.parentNode!.insertBefore(r2, run.nextSibling);
  return r2;
}

/** Make a boundary at raw offset `at`; returns [run before the boundary, run after it] (either may be null). */
function boundary(doc: Document, body: Element, at: number): { before: Element | null; after: Element | null } {
  const list = atoms(body);
  // first real text atom that ends after `at`
  const a = list.find((x) => x.t && x.start + x.len > at);
  if (!a || !a.t) { const last = [...list].reverse().find((x) => x.t); return { before: last?.t?.parentElement ?? null, after: null }; }
  const k = Math.max(0, at - a.start);
  if (k === 0) {
    const prev = [...list].reverse().find((x) => x.t && x.start + x.len <= at);
    return { before: prev?.t?.parentElement ?? null, after: a.t.parentElement };
  }
  const r2 = splitRun(doc, a.t, k);
  return { before: a.t.parentElement, after: r2 };
}

const paraId = () => (Math.floor(Math.random() * 0x7ffffffe) + 1).toString(16).toUpperCase().padStart(8, "0");
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase();

export async function wordWithComments(o: { name: string; url: string; comments: ExportComment[] }) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await (await fetch(o.url)).arrayBuffer());
  const parse = (s: string) => new DOMParser().parseFromString(s, "application/xml");
  const ser = (d: Document) => new XMLSerializer().serializeToString(d);
  const docXml = parse(await zip.file("word/document.xml")!.async("string"));
  const body = docXml.getElementsByTagNameNS(W, "body")[0];

  // existing comments (if the file already had some): keep them, number ours after them
  const cPath = "word/comments.xml", xPath = "word/commentsExtended.xml";
  const cXml = zip.file(cPath) ? parse(await zip.file(cPath)!.async("string")) : parse(`<w:comments xmlns:w="${W}" xmlns:w14="${W14}"/>`);
  const xXml = zip.file(xPath) ? parse(await zip.file(xPath)!.async("string")) : parse(`<w15:commentsEx xmlns:w15="${W15}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w15"/>`);
  let nextId = Math.max(-1, ...Array.from(cXml.getElementsByTagNameNS(W, "comment")).map((c) => Number(c.getAttributeNS(W, "id") ?? c.getAttribute("w:id")) || 0)) + 1;

  const addComment = (c: ExportComment, parentPara?: string) => {
    const id = nextId++, pid = paraId();
    const node = el(cXml, W, "w:comment", { "w:id": String(id), "w:author": c.author, "w:date": new Date(c.created_at).toISOString().replace(/\.\d+Z$/, "Z"), "w:initials": initials(c.author) });
    c.body.split(/\n/).forEach((line, i, all) => {
      const p = el(cXml, W, "w:p");
      if (i === all.length - 1) p.setAttributeNS(W14, "w14:paraId", pid);   // Word ties threads and "done" to the last paragraph
      const r = el(cXml, W, "w:r"); const t = el(cXml, W, "w:t", { "xml:space": "preserve" }); t.textContent = line;
      r.appendChild(t); p.appendChild(r); node.appendChild(p);
    });
    cXml.documentElement.appendChild(node);
    const ex = el(xXml, W15, "w15:commentEx", { "w15:paraId": pid, "w15:done": c.resolved ? "1" : "0" });
    if (parentPara) ex.setAttributeNS(W15, "w15:paraIdParent", parentPara);
    xXml.documentElement.appendChild(ex);
    return { id, pid };
  };
  const mark = (ids: number[], from: number, to: number) => {
    // end first, so the start offset stays valid
    const end = boundary(docXml, body, to);
    let endAt = end.before;
    const start = boundary(docXml, body, from);
    const startAt = start.after;
    if (start.before && start.before === endAt) endAt = start.after;   // start and end were in the same run
    if (!startAt || !endAt) return false;
    for (const id of ids) {
      startAt.parentNode!.insertBefore(el(docXml, W, "w:commentRangeStart", { "w:id": String(id) }), startAt);
    }
    let anchor: Node = endAt;
    for (const id of ids) {
      const e = el(docXml, W, "w:commentRangeEnd", { "w:id": String(id) });
      anchor.parentNode!.insertBefore(e, anchor.nextSibling); anchor = e;
      const r = el(docXml, W, "w:r"); r.appendChild(el(docXml, W, "w:commentReference", { "w:id": String(id) }));
      anchor.parentNode!.insertBefore(r, anchor.nextSibling); anchor = r;
    }
    return true;
  };

  const threads = o.comments.filter((c) => !c.parent_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const firstText = () => { const raw = rawText(atoms(body)); const m = raw.match(/\S[^\n]*/); return m ? [m.index!, m.index! + m[0].length] as [number, number] : null; };
  for (const t of threads) {
    const raw = rawText(atoms(body));
    let range = t.quote ? find(raw, t.quote) : null;
    let c = t;
    if (!range) {
      // general comments (or text that changed) go on the first line of the document
      range = firstText();
      if (t.quote) c = { ...t, body: `On "${t.quote.slice(0, 120)}": ${t.body}` };
    }
    const replies = o.comments.filter((r) => r.parent_id === t.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const top = addComment(c);
    const ids = [top.id, ...replies.map((r) => addComment({ ...r, resolved: t.resolved }, top.pid).id)];
    if (range) mark(ids, range[0], range[1]);
  }

  zip.file("word/document.xml", ser(docXml));
  zip.file(cPath, ser(cXml));
  zip.file(xPath, ser(xXml));

  // register the comment parts with the package
  const rels = parse(await zip.file("word/_rels/document.xml.rels")!.async("string"));
  const has = (type: string) => Array.from(rels.getElementsByTagNameNS(PKG, "Relationship")).some((r) => r.getAttribute("Type") === type);
  const addRel = (type: string, target: string) => {
    if (has(type)) return;
    const ids = Array.from(rels.getElementsByTagNameNS(PKG, "Relationship")).map((r) => Number((r.getAttribute("Id") ?? "").replace(/\D/g, "")) || 0);
    const r = rels.createElementNS(PKG, "Relationship");
    r.setAttribute("Id", `rId${Math.max(0, ...ids) + 1}`); r.setAttribute("Type", type); r.setAttribute("Target", target);
    rels.documentElement.appendChild(r);
  };
  addRel("http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments", "comments.xml");
  addRel("http://schemas.microsoft.com/office/2011/relationships/commentsExtended", "commentsExtended.xml");
  zip.file("word/_rels/document.xml.rels", ser(rels));
  const ct = parse(await zip.file("[Content_Types].xml")!.async("string"));
  const addCt = (part: string, type: string) => {
    if (Array.from(ct.getElementsByTagNameNS(CT, "Override")).some((x) => x.getAttribute("PartName") === part)) return;
    const x = ct.createElementNS(CT, "Override"); x.setAttribute("PartName", part); x.setAttribute("ContentType", type); ct.documentElement.appendChild(x);
  };
  addCt("/word/comments.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml");
  addCt("/word/commentsExtended.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml");
  zip.file("[Content_Types].xml", ser(ct));

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${o.name.replace(/\.[^.]+$/, "")} - with comments.docx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
