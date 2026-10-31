import { supabase } from "./supabase";

// Records several audio tracks mixed into one file (the host plus everyone on stage).
// Tracks can be added and removed while recording, e.g. when a caller is brought on or muted.
export class MixRecorder {
  private ctx = new AudioContext();
  private dest = this.ctx.createMediaStreamDestination();
  private sources = new Map<string, MediaStreamAudioSourceNode>();
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  readonly mime = pickMime();
  startedAt = 0;

  add(id: string, track: MediaStreamTrack | undefined | null) {
    if (!track || this.sources.has(id)) return;
    const src = this.ctx.createMediaStreamSource(new MediaStream([track]));
    src.connect(this.dest);
    this.sources.set(id, src);
  }
  remove(id: string) {
    this.sources.get(id)?.disconnect();
    this.sources.delete(id);
  }
  has(id: string) { return this.sources.has(id); }

  start() {
    this.ctx.resume().catch(() => {});
    this.rec = new MediaRecorder(this.dest.stream, { mimeType: this.mime || undefined, audioBitsPerSecond: 48000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(5000); // a chunk every 5 seconds, so little is lost if something goes wrong
    this.startedAt = Date.now();
  }
  get recording() { return this.rec?.state === "recording"; }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const done = () => {
        for (const s of this.sources.values()) s.disconnect();
        this.ctx.close().catch(() => {});
        resolve(new Blob(this.chunks, { type: this.rec?.mimeType || this.mime || "audio/webm" }));
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
