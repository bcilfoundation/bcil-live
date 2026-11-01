import { useState } from "react";
import { isNative } from "../lib/native";

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
export const isAndroid = /Android/i.test(ua);
export const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof document !== "undefined" && "ontouchend" in document);
const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
export const APK = `${import.meta.env.BASE_URL}bcil-live.apk`;

// For people using the website on a phone: Android → download the app; iPhone → add to Home Screen.
export default function GetApp({ where = "app" }: { where?: "app" | "signin" }) {
  const key = "bcil.getapp.hide";
  const [hidden, setHidden] = useState(() => { try { return Number(localStorage.getItem(key) || 0) > Date.now(); } catch { return false; } });
  if (isNative || standalone || hidden || !(isAndroid || isIOS)) return null;
  const hide = () => { try { localStorage.setItem(key, String(Date.now() + 14 * 864e5)); } catch { /* ignore */ } setHidden(true); };
  return (
    <div className={`getapp ${where}`} role="note">
      <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" />
      {isAndroid ? <>
        <div className="grow"><b>Get the BCIL Live app</b><small>Free for Android · notifications, live sessions in the background</small></div>
        <a className="btn primary sm" href={APK} download>Download</a>
      </> : <>
        <div className="grow"><b>Add BCIL Live to your Home Screen</b><small>Tap <span aria-label="Share">⬆︎ Share</span> at the bottom of Safari, then <b>Add to Home Screen</b></small></div>
      </>}
      <button className="linkbtn" onClick={hide} aria-label="Hide">✕</button>
    </div>
  );
}
