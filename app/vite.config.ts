import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The PWA plugin makes the app installable ("Add to Home Screen") and work on slow networks.
// BASE_PATH lets the app live in a sub-folder, e.g. /bcil-live/ on GitHub Pages
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "BCIL Live",
        short_name: "BCIL Live",
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
