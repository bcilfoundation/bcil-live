// Appearance: auto (follow the phone), light or dark. Saved on this device.
export type Theme = "auto" | "light" | "dark";
const KEY = "bcil-theme";
export function getTheme(): Theme {
  try { const t = localStorage.getItem(KEY); if (t === "light" || t === "dark") return t; } catch { /* ignore */ }
  return "auto";
}
export function applyTheme(t: Theme = getTheme()) {
  const dark = t === "dark" || (t === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b1628" : "#1e3f78");
}
export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  applyTheme(t);
}
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme());
