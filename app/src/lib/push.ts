import { supabase } from "./supabase";

// Phone notifications (Web Push). Works in Chrome/Edge/Firefox and on iPhone once the app is on the home screen.
export const pushSupported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

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
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

export async function enablePush(userId: string): Promise<void> {
  if (!pushSupported()) throw new Error(/iPhone|iPad/.test(navigator.userAgent)
    ? "On iPhone, add BCIL Live to your home screen first (Share → Add to Home Screen), then open it from there and try again."
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
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
