import { supabase } from "./supabase";
import { isNative } from "./native";

// Fingerprint / Face ID sign-in, using passkeys. Works in the browser and the app installed from the website.
// The downloaded Android app needs a new build before its screen can show the fingerprint prompt, so it is hidden there.
export async function passkeySupported(): Promise<boolean> {
  if (isNative || typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}

export async function myPasskeys(): Promise<{ id: string; name?: string | null; created_at?: string }[]> {
  try {
    const { data, error } = await supabase.auth.passkey.list();
    if (error) return [];
    const list = (data as unknown as { passkeys?: unknown[] } | unknown[]) ?? [];
    return (Array.isArray(list) ? list : (list.passkeys ?? [])) as { id: string; name?: string | null; created_at?: string }[];
  } catch { return []; }
}

export async function addPasskey(): Promise<string | null> {
  const ua = navigator.userAgent;
  const device = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android phone" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows computer" : "This device";
  const { error } = await supabase.auth.registerPasskey({ name: device } as never);
  if (!error) { try { localStorage.setItem("bcil.passkey", "1"); } catch { /* */ } return null; }
  const m = error.message || "";
  if (/cancel|abort|not allowed|NotAllowed/i.test(m)) return "Fingerprint setup was cancelled.";
  if (/exists/i.test(m)) { try { localStorage.setItem("bcil.passkey", "1"); } catch { /* */ } return null; }
  return "Could not turn on fingerprint sign-in. " + m;
}

export async function removePasskey(id: string) {
  await supabase.auth.passkey.delete({ passkeyId: id } as never);
  try { localStorage.removeItem("bcil.passkey"); } catch { /* */ }
}
