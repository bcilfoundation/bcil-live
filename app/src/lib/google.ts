import { supabase } from "./supabase";
import { isNative } from "./native";

// "Continue with Google".
// Website / home-screen app: go to Google and come back to live.bcilfoundation.org.
// Android app: Google does not allow sign-in inside an app's web view, so we open the phone's
// browser and Google sends the person back to the app through org.bcilfoundation.live://auth.
const APP_RETURN = "org.bcilfoundation.live://auth";

export async function signInWithGoogle() {
  if (!isNative) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL, queryParams: { prompt: "select_account" } },
    });
    if (error) throw error;
    return;
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: APP_RETURN, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
  });
  if (error) throw error;
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: data.url, presentationStyle: "popover" });
}

/** In the Android app, finish a Google sign-in when the browser hands back to us. Call once at start-up. */
export async function listenForAppSignIn() {
  if (!isNative) return;
  const { App } = await import("@capacitor/app");
  App.addListener("appUrlOpen", async ({ url }) => {
    if (!url.startsWith(APP_RETURN)) return;
    const u = new URL(url.replace(APP_RETURN, "https://x/auth"));
    const code = u.searchParams.get("code");
    try { (await import("@capacitor/browser")).Browser.close(); } catch { /* already closed */ }
    if (code) await supabase.auth.exchangeCodeForSession(code);
  });
}
