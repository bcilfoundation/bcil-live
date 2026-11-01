import { supabase } from "./supabase";

// Counts real listening time (only while audio is actually playing) and sends it in small batches.
export class ListenTracker {
  private pending = 0;
  private lastTime: number | null = null;
  private timer: number | undefined;
  constructor(private talkId: string) {
    this.timer = window.setInterval(() => this.flush(false), 30000);
  }
  /** call from the audio element's timeupdate */
  tick(a: HTMLAudioElement) {
    if (a.paused || a.seeking) { this.lastTime = null; return; }
    if (this.lastTime !== null) {
      const d = a.currentTime - this.lastTime;
      if (d > 0 && d < 5) this.pending += d / (a.playbackRate || 1);   // real seconds, ignore skips
    }
    this.lastTime = a.currentTime;
  }
  pause() { this.lastTime = null; this.flush(false); }
  async flush(completed: boolean) {
    const secs = Math.round(this.pending);
    if (secs < 1 && !completed) return;
    this.pending -= secs;
    await supabase.rpc("log_listen", { p_talk: this.talkId, p_seconds: Math.min(secs, 120), p_completed: completed }).then(() => {}, () => {});
  }
  stop() { window.clearInterval(this.timer); this.flush(false); }
}

/** A video was opened (YouTube doesn't tell us how long people watch inside the frame). */
export const logOpen = (talkId: string) => supabase.rpc("log_listen", { p_talk: talkId, p_seconds: 0, p_completed: false }).then(() => {}, () => {});
