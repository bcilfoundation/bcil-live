import { supabase } from "./supabase";
import { Mp3Stream } from "./mp3";

// Records several audio tracks mixed into one file (the host plus everyone on stage).
// Tracks can be added and removed while recording, e.g. when a caller is brought on or muted.
// The mix is encoded to MP3 as it goes (plays everywhere, downloadable); a WebM copy is kept as a backup.
export class MixRecorder {
  private ctx = new AudioContext();
  private dest = this.ctx.createMediaStreamDestination();
  private mix = this.ctx.createGain();
  private proc: ScriptProcessorNode | null = null;
  private silent = this.ctx.createGain();
  private mp3: Mp3Stream | null = null;
  private sources = new Map<string, MediaStreamAudioSourceNode>();
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  readonly mime = pickMime();
  startedAt = 0;

  add(id: string, track: MediaStreamTrack | undefined | null) {
    if (!track || this.sources.has(id)) return;
    const src = this.ctx.createMediaStreamSource(new MediaStream([track]));
    src.connect(this.mix);
    this.sources.set(id, src);
  }
  remove(id: string) {
    this.sources.get(id)?.disconnect();
    this.sources.delete(id);
  }
  has(id: string) { return this.sources.has(id); }

  start() {
    this.ctx.resume().catch(() => {});
    this.mix.connect(this.dest);
    try {
      this.mp3 = new Mp3Stream(this.ctx.sampleRate);
      this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
      this.proc.onaudioprocess = (e) => { try { this.mp3?.push(new Float32Array(e.inputBuffer.getChannelData(0))); } catch { this.mp3 = null; } };
      this.silent.gain.value = 0;
      this.mix.connect(this.proc); this.proc.connect(this.silent); this.silent.connect(this.ctx.destination);
    } catch { this.mp3 = null; }
    this.rec = new MediaRecorder(this.dest.stream, { mimeType: this.mime || undefined, audioBitsPerSecond: 48000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(5000); // a chunk every 5 seconds, so little is lost if something goes wrong
    this.startedAt = Date.now();
  }
  get recording() { return this.rec?.state === "recording"; }
  /** the mixed sound of the room, so a video recording can use it too */
  get audioTrack(): MediaStreamTrack | null { return this.dest.stream.getAudioTracks()[0] ?? null; }

  /** Stops and returns the MP3 when it worked, otherwise the WebM backup. */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const done = () => {
        for (const s of this.sources.values()) s.disconnect();
        if (this.proc) { this.proc.onaudioprocess = null; this.proc.disconnect(); }
        this.ctx.close().catch(() => {});
        const mp3 = this.mp3 && this.mp3.size > 2000 ? this.mp3.finish() : null;
        resolve(mp3 ?? new Blob(this.chunks, { type: this.rec?.mimeType || this.mime || "audio/webm" }));
      };
      if (!this.rec || this.rec.state === "inactive") return done();
      this.rec.onstop = done;
      this.rec.stop();
    });
  }
}

// Simple one-microphone recorder for recording a talk on the phone
export class MicRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  readonly mime = pickMime();

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.rec = new MediaRecorder(this.stream, { mimeType: this.mime || undefined, audioBitsPerSecond: 64000 });
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(5000);
  }
  pause() { this.rec?.pause(); }
  resume() { this.rec?.resume(); }
  get state() { return this.rec?.state ?? "inactive"; }
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const done = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: this.rec?.mimeType || this.mime || "audio/webm" }));
      };
      if (!this.rec || this.rec.state === "inactive") return done();
      this.rec.onstop = done;
      this.rec.stop();
    });
  }
  cancel() { this.rec?.stop(); this.stream?.getTracks().forEach((t) => t.stop()); }
}

function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav" };

// Upload an audio recording or file to the "audio" bucket and return its public link
export async function uploadAudio(userId: string, file: Blob, name = "talk"): Promise<string> {
  const type = (file.type || "audio/webm").split(";")[0];
  if (file.size > 50 * 1024 * 1024) throw new Error("This audio is over 50 MB. Please upload a shorter or smaller file (MP3 or M4A works best).");
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "talk";
  const path = `${userId}/${Date.now()}-${safe}.${EXT[type] ?? "webm"}`;
  const { error } = await supabase.storage.from("audio").upload(path, file, { contentType: type, upsert: false });
  if (error) throw error;
  return supabase.storage.from("audio").getPublicUrl(path).data.publicUrl;
}

// Read how long an audio file is (in seconds); returns null if the browser can't tell
export function audioDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const finish = (v: number | null) => { URL.revokeObjectURL(url); resolve(v); };
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration)) return finish(Math.round(a.duration));
      // webm from MediaRecorder reports Infinity until we seek to the end
      a.currentTime = 1e9;
      a.ontimeupdate = () => { a.ontimeupdate = null; finish(Number.isFinite(a.duration) ? Math.round(a.duration) : null); };
    };
    a.onerror = () => finish(null);
    a.src = url;
    setTimeout(() => finish(null), 8000);
  });
}

export const clock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
};

// Records the video room: every camera tile on screen is drawn into one 1280x720 picture (with names),
// together with the mixed sound of the room. Runs on the host's device.
export class GridRecorder {
  private canvas = document.createElement("canvas");
  private g = this.canvas.getContext("2d")!;
  private timer = 0;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  readonly mime = pickVideoMime();
  startedAt = 0;
  constructor(private root: () => HTMLElement | null, private audio: MediaStreamTrack | null) {
    this.canvas.width = 1280; this.canvas.height = 720;
  }
  static supported() {
    return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function" && !!pickVideoMime();
  }
  private draw() {
    const g = this.g, W = 1280, H = 720;
    g.fillStyle = "#0b1628"; g.fillRect(0, 0, W, H);
    const tiles = Array.from(this.root()?.querySelectorAll<HTMLElement>(".vtile") ?? []);
    if (!tiles.length) return;
    // a shared screen fills the picture, with the cameras in a strip on the right
    const share = tiles.find((t) => t.classList.contains("vscreen"));
    const boxes: { el: HTMLElement; x: number; y: number; w: number; h: number; fit: "contain" | "cover" }[] = [];
    if (share) {
      const rest = tiles.filter((t) => t !== share).slice(0, 4);
      const sw = rest.length ? 1000 : W;
      boxes.push({ el: share, x: 0, y: 0, w: sw, h: H, fit: "contain" });
      rest.forEach((t, i) => boxes.push({ el: t, x: sw + 4, y: i * (H / 4), w: W - sw - 4, h: H / 4 - 4, fit: "cover" }));
    } else {
      const n = Math.min(tiles.length, 16), cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), gap = 6;
      const w = (W - gap * (cols + 1)) / cols, h = (H - gap * (rows + 1)) / rows;
      tiles.slice(0, 16).forEach((t, i) => boxes.push({ el: t, x: gap + (i % cols) * (w + gap), y: gap + Math.floor(i / cols) * (h + gap), w, h, fit: "cover" }));
    }
    for (const b of boxes) {
      g.save(); g.beginPath(); g.rect(b.x, b.y, b.w, b.h); g.clip();
      g.fillStyle = "#1c2b44"; g.fillRect(b.x, b.y, b.w, b.h);
      const v = b.el.querySelector("video");
      if (v && v.readyState >= 2 && v.videoWidth) {
        const r = b.fit === "cover" ? Math.max(b.w / v.videoWidth, b.h / v.videoHeight) : Math.min(b.w / v.videoWidth, b.h / v.videoHeight);
        const dw = v.videoWidth * r, dh = v.videoHeight * r;
        const mirrored = (v.style.transform || "").includes("rotateY(180") || (v.style.transform || "").includes("scaleX(-1");
        if (mirrored) { g.translate(b.x + b.w / 2, 0); g.scale(-1, 1); g.translate(-(b.x + b.w / 2), 0); }
        g.drawImage(v, b.x + (b.w - dw) / 2, b.y + (b.h - dh) / 2, dw, dh);
        if (mirrored) g.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        const ini = b.el.querySelector(".vnocam .ava")?.textContent ?? "";
        g.fillStyle = "#2c3e63"; const rad = Math.min(b.w, b.h) / 5;
        g.beginPath(); g.arc(b.x + b.w / 2, b.y + b.h / 2, rad, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#fff"; g.font = `700 ${Math.round(rad * 0.8)}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(ini, b.x + b.w / 2, b.y + b.h / 2);
      }
      const name = b.el.querySelector(".vname")?.textContent?.trim();
      if (name) {
        g.font = "600 20px sans-serif"; g.textAlign = "left"; g.textBaseline = "alphabetic";
        const tw = g.measureText(name).width;
        g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(b.x + 8, b.y + b.h - 38, tw + 20, 30);
        g.fillStyle = "#fff"; g.fillText(name, b.x + 18, b.y + b.h - 16);
      }
      g.restore();
    }
  }
  start() {
    this.draw();
    // a timer (not animation frames) so the picture keeps updating even when the tab is in the background
    this.timer = window.setInterval(() => { try { this.draw(); } catch { /* keep going */ } }, 1000 / 15);
    const stream = this.canvas.captureStream(15);
    if (this.audio) stream.addTrack(this.audio);
    this.rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 64000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(5000);
    this.startedAt = Date.now();
  }
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const done = () => { clearInterval(this.timer); resolve(new Blob(this.chunks, { type: (this.rec?.mimeType || this.mime).split(";")[0] })); };
      if (!this.rec || this.rec.state === "inactive") return done();
      this.rec.onstop = done; this.rec.stop();
    });
  }
}
function pickVideoMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}
// Save a file to the person's phone or computer
export function saveToDevice(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
