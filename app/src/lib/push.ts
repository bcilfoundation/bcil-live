import { supabase } from "./supabase";
import { isNative } from "./native";

// Phone notifications. Website / home-screen app: Web Push (Chrome, Edge, Firefox, iPhone home-screen app).
// Android app: Firebase Cloud Messaging through @capacitor/push-notifications.
// Android app versions built before Firebase was added (google-services.json) would crash if we asked for
// notifications, so only versions from this build onwards use them. Older versions see the update banner.
const MIN_FCM_BUILD = 11;
let nativeOn = false;
const nativeCheck: Promise<boolean> = !isNative ? Promise.resolve(false)
  : import("@capacitor/app").then(({ App }) => App.getInfo()).then((i) => (nativeOn = Number(i.build) >= MIN_FCM_BUILD)).catch(() => false);
export const pushSupported = () =>
  isNative || ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);

const FCM_KEY = "bcil.fcm.token";
async function nativePush() { return (await import("@capacitor/push-notifications")).PushNotifications; }

/** Android app: ask permission, register with Firebase and save this phone's token. */
async function enableNative(userId: string): Promise<void> {
  const P = await nativePush();
  let perm = await P.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await P.requestPermissions();
  if (perm.receive !== "granted") throw new Error("Notifications are turned off for BCIL Foundation. Turn them on in your phone's Settings → Apps → BCIL Foundation → Notifications.");
  await P.createChannel({ id: "bcil", name: "BCIL Foundation", description: "Live sessions, messages and updates", importance: 5, visibility: 1 }).catch(() => {});
  const token = await new Promise<string>((ok, no) => {
    const t = setTimeout(() => no(new Error("Could not connect to notifications. Check your internet and try again.")), 20000);
    P.addListener("registration", (r) => { clearTimeout(t); ok(r.value); });
    P.addListener("registrationError", (e) => { clearTimeout(t); no(new Error(e.error || "Notifications could not start on this phone.")); });
    P.register();
  });
  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: userId, endpoint: `fcm:${token}`, p256dh: "fcm", auth: "fcm", user_agent: "BCIL Foundation Android app" }, { onConflict: "endpoint" });
  if (error) throw error;
  try { localStorage.setItem(FCM_KEY, token); } catch { /* ignore */ }
}

/** Android app: open the right page when someone taps a notification, and keep the token fresh. Call once at start-up. */
export async function startNativePush(userId: string, go: (url: string) => void) {
  if (!(await nativeCheck)) return;
  try {
    const P = await nativePush();
    P.addListener("pushNotificationActionPerformed", (a) => { const url = (a.notification.data as { url?: string })?.url; if (url) go(url); });
    const perm = await P.checkPermissions();
    // first time in the app: ask once; after that only when they switch it on in the menu
    let asked = false; try { asked = !!localStorage.getItem("bcil.fcm.asked"); localStorage.setItem("bcil.fcm.asked", "1"); } catch { /* ignore */ }
    if (perm.receive === "granted" || !asked) await enableNative(userId);
  } catch (e) { console.warn("native push", e); }
}

// The server creates its notification keys on first use; the app only ever sees the public half
async function publicKey(): Promise<string> {
  let { data } = await supabase.rpc("push_public_key");
  if (!data) {
    await supabase.functions.invoke("push", { body: { action: "init" } });
    ({ data } = await supabase.rpc("push_public_key"));
  }
  if (!data) throw new Error("Notifications aren't set up on the server yet. Please try again later.");
  return data as string;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function pushEnabled(): Promise<boolean> {
  if (await nativeCheck) {
    try { const perm = await (await nativePush()).checkPermissions(); return perm.receive === "granted" && !!localStorage.getItem(FCM_KEY); } catch { return false; }
  }
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

export async function enablePush(userId: string): Promise<void> {
  if (await nativeCheck) return enableNative(userId);
  if (isNative) throw new Error("Please update the BCIL Foundation app to get phone notifications (Get the Android app in the menu).");
  if (!pushSupported()) throw new Error(/iPhone|iPad/.test(navigator.userAgent)
    ? "On iPhone, add BCIL Foundation to your home screen first (Share → Add to Home Screen), then open it from there and try again."
    : "This browser can't show notifications. Try Chrome.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked. Allow notifications for live.bcilfoundation.org in your phone or browser settings.");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(await publicKey()) });
  const j = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: userId, endpoint: sub.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, user_agent: navigator.userAgent.slice(0, 200) },
    { onConflict: "endpoint" });
  if (error) throw error;
}

export async function disablePush(): Promise<void> {
  if (await nativeCheck) {
    let token = ""; try { token = localStorage.getItem(FCM_KEY) || ""; localStorage.removeItem(FCM_KEY); } catch { /* ignore */ }
    if (token) await supabase.from("push_subscriptions").delete().eq("endpoint", `fcm:${token}`);
    await (await nativePush()).unregister().catch(() => {});
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
