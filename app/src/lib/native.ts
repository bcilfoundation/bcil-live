import { Capacitor, registerPlugin } from "@capacitor/core";

// Built into the app from build 12: keeps the mic alive when the app is hidden or the screen is off.
const LiveKeep = registerPlugin<{ start(): Promise<void>; stop(): Promise<void> }>("LiveKeep");

// Inside the downloaded Android app, keep the live room running when the phone sleeps or
// another app is opened. Android shows a "BCIL Foundation" notification while this is on.
// On the website (and on iPhone) these do nothing.
export const isNative = Capacitor.isNativePlatform();
const isAndroid = Capacitor.getPlatform() === "android";

const MEDIA_PLAYBACK = 2;   // Android foreground service types
const MICROPHONE = 128;

export async function startLiveService(title: string, speaking: boolean) {
  if (!isAndroid) return;
  try {
    const { ForegroundService } = await import("@capawesome-team/capacitor-android-foreground-service");
    const perm = await ForegroundService.checkPermissions();
    if (perm.display !== "granted") await ForegroundService.requestPermissions();
    await ForegroundService.startForegroundService({
      id: 7001,
      title: speaking ? "You're on air · BCIL Foundation" : "Listening · BCIL Foundation",
      body: title,
      smallIcon: "ic_stat_live",
      serviceType: (speaking ? MICROPHONE | MEDIA_PLAYBACK : MEDIA_PLAYBACK) as never,
      silent: true,
    });
  } catch (e) { console.warn("Live background service did not start", e); }
  try { await LiveKeep.start(); } catch { /* older app build */ }
}

export async function stopLiveService() {
  if (!isAndroid) return;
  try { await LiveKeep.stop(); } catch { /* older app build */ }
  try {
    const { ForegroundService } = await import("@capawesome-team/capacitor-android-foreground-service");
    await ForegroundService.stopForegroundService();
  } catch { /* already stopped */ }
}
