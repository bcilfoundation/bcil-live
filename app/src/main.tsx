import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import App from "./App";
import "./styles.css";
import { applyTheme } from "./lib/theme";
applyTheme();
import { registerSW } from "virtual:pwa-register";

// Always pick up the newest version: check on load and every 10 minutes, reload when an update is ready
import { isNative } from "./lib/native";
import { listenForAppSignIn } from "./lib/google";
listenForAppSignIn();

const updateSW = isNative ? () => Promise.resolve() : registerSW({
  immediate: true,
  onNeedRefresh() { updateSW(true); },
  onRegisteredSW(_url, reg) { if (reg) setInterval(() => reg.update(), 10 * 60 * 1000); },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
