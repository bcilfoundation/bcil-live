import { useEffect, useRef } from "react";

// Shows the NPO licence inside the app, with a close button, so people can always get back.
export default function LicenceViewer({ onClose }: { onClose: () => void }) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const onClose = () => close.current();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // the phone's Back button closes the viewer instead of leaving the app
    history.pushState({ licence: 1 }, "");
    const back = () => onClose();
    window.addEventListener("keydown", esc); window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("keydown", esc); window.removeEventListener("popstate", back);
      if (history.state?.licence) history.back();
    };
  }, []);
  return (
    <div className="lic-view" role="dialog" aria-label="NPO licence" onClick={onClose}>
      <div className="lic-bar" onClick={(e) => e.stopPropagation()}>
        <b>NPO licence</b>
        <button className="btn sm primary" onClick={onClose}>✕ Close</button>
      </div>
      <img src="/npo-licence.jpg" alt="BCIL Foundation NPO licence, No. NPOS/CR02/LN04364/26" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
