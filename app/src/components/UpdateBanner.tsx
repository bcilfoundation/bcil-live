import { useEffect, useState } from "react";
import { isNative } from "../lib/native";

// Android app only: if a newer app version has been published, offer it in one tap.
// (Most changes reach the app by themselves; a new version is only needed when the app's built-in parts change.)
export default function UpdateBanner() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isNative) return;
    let gone = false;
    (async () => {
      try {
        if (Number(localStorage.getItem("bcil.update.later") || 0) > Date.now()) return;
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        const res = await fetch(`${import.meta.env.BASE_URL}app-version.json?t=${Date.now()}`, { cache: "no-store" });
        const v = await res.json();
        if (!gone && Number(v?.android?.build) > Number(info.build)) setUrl(v.android.url);
      } catch { /* offline or not published yet */ }
    })();
    return () => { gone = true; };
  }, []);
  if (!url) return null;
  const update = async () => { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url }); };
  const later = () => { try { localStorage.setItem("bcil.update.later", String(Date.now() + 864e5)); } catch { /* ignore */ } setUrl(null); };
  return (
    <div className="updatebar" role="status">
      <span>✨ A new version of BCIL Live is ready.</span>
      <button className="btn primary sm" onClick={update}>Update</button>
      <button className="linkbtn" onClick={later} aria-label="Remind me later">Later</button>
    </div>
  );
}
