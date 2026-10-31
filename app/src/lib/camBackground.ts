// Camera backgrounds for video sessions (blur, a colour, or a picture), using Agora's virtual background extension.
// The extension is large, so it only loads the first time someone picks a background.
import type { ICameraVideoTrack } from "agora-rtc-sdk-ng";

export type CamBg = { id: string; label: string; type: "none" | "blur" | "color" | "img"; blur?: number; color?: string; src?: string };

const B = import.meta.env.BASE_URL;
export const CAM_BGS: CamBg[] = [
  { id: "none", label: "None", type: "none" },
  { id: "blur1", label: "Light blur", type: "blur", blur: 1 },
  { id: "blur3", label: "Strong blur", type: "blur", blur: 3 },
  { id: "navy", label: "BCIL navy", type: "color", color: "#13294b" },
  { id: "gold", label: "Gold", type: "color", color: "#c9a227" },
  { id: "stage", label: "FCB curtain", type: "img", src: `${B}fcb/bg-stage.jpg` },
  { id: "hall", label: "FCB hall", type: "img", src: `${B}fcb/bg-hall.jpg` },
];

const KEY = "bcil.camBg";
export function savedCamBg(): CamBg {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v?.id) return v; } catch { /* storage unavailable */ }
  return CAM_BGS[0];
}
export function saveCamBg(bg: CamBg) { try { localStorage.setItem(KEY, JSON.stringify(bg)); } catch { /* too big or blocked */ } }

type Processor = {
  init: () => Promise<void>; enable: () => Promise<void>; disable: () => Promise<void>;
  setOptions: (o: Record<string, unknown>) => void; unpipe: () => void;
};
let ready: Promise<Processor | null> | null = null;

async function getProcessor(): Promise<Processor | null> {
  if (!ready) ready = (async () => {
    const [{ default: AgoraRTC }, { default: VirtualBackgroundExtension }] = await Promise.all([
      import("agora-rtc-sdk-ng"), import("agora-extension-virtual-background"),
    ]);
    const ext = new VirtualBackgroundExtension();
    if (!ext.checkCompatibility()) return null;
    AgoraRTC.registerExtensions([ext]);
    const p = ext.createProcessor() as unknown as Processor;
    await p.init();
    return p;
  })().catch((e) => { console.warn("virtual background failed", e); ready = null; return null; });
  return ready;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = no; i.src = src; });
}

let pipedTo: ICameraVideoTrack | null = null;

/** Apply a background to the camera. Returns false if this phone or browser can't do it. */
export async function applyCamBg(track: ICameraVideoTrack, bg: CamBg): Promise<boolean> {
  if (bg.type === "none") {
    if (pipedTo === track) { const p = await getProcessor(); await p?.disable().catch(() => {}); }
    return true;
  }
  const p = await getProcessor();
  if (!p) return false;
  if (pipedTo !== track) {
    try { p.unpipe(); } catch { /* not piped yet */ }
    track.pipe(p as never).pipe(track.processorDestination);
    pipedTo = track;
  }
  if (bg.type === "blur") p.setOptions({ type: "blur", blurDegree: bg.blur ?? 2 });
  else if (bg.type === "color") p.setOptions({ type: "color", color: bg.color });
  else p.setOptions({ type: "img", source: await loadImage(bg.src!), fit: "cover" });
  await p.enable();
  return true;
}

/** Shrink a photo the person picks to 1280x720 so it works as a background and can be remembered. */
export async function photoToBg(file: File): Promise<CamBg> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
    const s = Math.max(1280 / img.width, 720 / img.height);
    const w = img.width * s, h = img.height * s;
    c.getContext("2d")!.drawImage(img, (1280 - w) / 2, (720 - h) / 2, w, h);
    return { id: "custom", label: "My photo", type: "img", src: c.toDataURL("image/jpeg", 0.8) };
  } finally { URL.revokeObjectURL(url); }
}
