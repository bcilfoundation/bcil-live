import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The PWA plugin makes the app installable ("Add to Home Screen") and work on slow networks.
// BASE_PATH lets the app live in a sub-folder, e.g. /bcil-live/ on GitHub Pages
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  define: { __APP_VERSION__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")) },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        importScripts: ["push-sw.js"],          // phone notifications (public/push-sw.js)
        navigateFallbackDenylist: [/^\/bcil-live\.apk$/, /^\/privacy/, /^\/bite-relay/, /^\/npo-licence/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // big optional parts (PDF reader, camera backgrounds, FCB photos) download only when used, to save mobile data
        globIgnores: ["**/pdf*.{js,mjs}", "**/agora-extension-virtual-background*", "**/fcb/**"],
      },
      manifest: {
        name: "BCIL Foundation",
        short_name: "BCIL",
        description: "Live sessions, talks, daily quotes and community from BCIL Foundation",
        theme_color: "#1e3f78",
        background_color: "#ffffff",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
