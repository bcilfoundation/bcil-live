import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "org.bcilfoundation.live",
  appName: "BCIL Live",
  webDir: "dist",
  // The app opens the live BCIL website, so every website update reaches the app straight away (no reinstall).
  server: { url: "https://live.bcilfoundation.org/", androidScheme: "https", allowNavigation: ["live.bcilfoundation.org", "bcilfoundation.github.io", "*.supabase.co"] },
  android: { backgroundColor: "#1e3f78" },
  ios: { backgroundColor: "#1e3f78", contentInset: "always" },
};
export default config;
