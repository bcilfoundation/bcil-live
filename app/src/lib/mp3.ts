import { Mp3Encoder } from "@breezystack/lamejs";

// MP3 plays on every phone and computer (iPhone included), shows its length and can be skipped through,
// unlike the WebM files browsers record by default. Speech is encoded mono at 22–24 kHz.

const toInt16 = (f: Float32Array) => {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); out[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return out;
};

/** Encodes audio to MP3 bit by bit while it is being recorded. */
export class Mp3Stream {
  private enc: Mp3Encoder;
  private parts: Uint8Array[] = [];
  private half: boolean;
  readonly rate: number;
  constructor(inputRate: number, kbps = 48) {
    this.half = inputRate >= 44100;        // 48 kHz → 24 kHz, 44.1 kHz → 22.05 kHz: plenty for voices
    this.rate = this.half ? inputRate / 2 : inputRate;
    this.enc = new Mp3Encoder(1, this.rate, kbps);
  }
  push(input: Float32Array) {
    let f = input;
    if (this.half) {
      f = new Float32Array(input.length >> 1);
      for (let i = 0; i < f.length; i++) f[i] = (input[2 * i] + input[2 * i + 1]) / 2;
    }
    const s = toInt16(f);
    for (let i = 0; i < s.length; i += 1152) {
      const out = this.enc.encodeBuffer(s.subarray(i, i + 1152));
      if (out.length) this.parts.push(new Uint8Array(out));
    }
  }
  finish(): Blob {
    const out = this.enc.flush();
    if (out.length) this.parts.push(new Uint8Array(out));
    return new Blob(this.parts as BlobPart[], { type: "audio/mpeg" });
  }
  get size() { return this.parts.reduce((n, p) => n + p.length, 0); }
}

/** Turn an existing recording (e.g. WebM) into an MP3. onProgress gets 0–1. */
export async function convertToMp3(file: Blob, onProgress?: (p: number) => void): Promise<{ blob: Blob; seconds: number }> {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC({ sampleRate: 22050 });
  let audio: AudioBuffer;
  try { audio = await ctx.decodeAudioData(await file.arrayBuffer()); }
  catch { throw new Error("This browser can't read the recording. Try Chrome on a laptop or Android."); }
  finally { ctx.close().catch(() => {}); }
  // mix to mono
  const n = audio.length, mono = new Float32Array(n);
  for (let c = 0; c < audio.numberOfChannels; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / audio.numberOfChannels; }
  const enc = new Mp3Stream(audio.sampleRate);
  const step = audio.sampleRate * 20;     // 20 seconds at a time, so the page stays responsive
  for (let i = 0; i < n; i += step) {
    enc.push(mono.subarray(i, i + step));
    onProgress?.(Math.min(1, (i + step) / n));
    await new Promise((r) => setTimeout(r, 0));
  }
  return { blob: enc.finish(), seconds: Math.round(audio.duration) };
}
