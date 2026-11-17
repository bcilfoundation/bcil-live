// Appearance: dark (the default), light, or auto (follow the phone). Saved on this device.
export type Theme = "auto" | "light" | "dark";
// New key so everyone starts on the soft dark look once; a choice made after that sticks.
const KEY = "bcil-theme2";
export function getTheme(): Theme {
  try { const t = localStorage.getItem(KEY); if (t === "light" || t === "dark" || t === "auto") return t; } catch { /* ignore */ }
  return "dark";
}
export function applyTheme(t: Theme = getTheme()) {
  const dark = t === "dark" || (t === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#323d50" : "#1e3f78");
}
export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  applyTheme(t);
}
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme());
