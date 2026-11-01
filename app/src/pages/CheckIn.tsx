import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

type Result = { ok: boolean; name?: string; form_title?: string; already?: boolean; paid?: boolean; fee?: boolean; status?: string; error?: string };

// For BCIL staff on the event day: scan a member's QR ticket to check them in
export default function CheckIn() {
  const { isStaff } = useAuth();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [on, setOn] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [manual, setManual] = useState("");
  const [count, setCount] = useState(0);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const busy = useRef(false);

  const check = async (code: string) => {
    const t = code.trim();
    if (!/^[0-9a-f-]{36}$/i.test(t)) { setResult({ ok: false, error: "That isn't a BCIL ticket." }); return; }
    busy.current = true;
    const { data, error } = await supabase.rpc("check_in", { p_ticket: t });
    busy.current = false;
    if (error) { setResult({ ok: false, error: error.message.replace(/^.*?: /, "") }); return; }
    const r = (data as Result[])[0];
    setResult({ ...r, ok: true });
    if (!r.already) setCount((n) => n + 1);
    navigator.vibrate?.(r.already ? [80, 60, 80] : 120);
  };

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null; let raf = 0; let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current!; v.srcObject = stream; v.setAttribute("playsinline", "true"); await v.play();
        const { default: jsQR } = await import("jsqr");
        const tick = () => {
          if (stop) return;
          const c = canvas.current!;
          if (v.videoWidth && !busy.current) {
            c.width = v.videoWidth; c.height = v.videoHeight;
            const ctx = c.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, c.width, c.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            // the same ticket is only checked once every 4 seconds
            if (code?.data && (code.data !== last.current.code || Date.now() - last.current.at > 4000)) {
              last.current = { code: code.data, at: Date.now() }; check(code.data);
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch { setResult({ ok: false, error: "Allow camera access to scan tickets, or type the code below." }); setOn(false); }
    })();
    return () => { stop = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [on]);

  if (!isStaff) return <section className="view"><p className="muted">Only BCIL staff can check people in.</p></section>;
  return (
    <section className="view checkin">
      <h1>Check-in</h1>
      <p className="muted">Point the camera at a member's QR ticket. {count > 0 && <b>{count} checked in on this phone.</b>}</p>
      <div className="scanbox">
        <video ref={video} muted playsInline style={{ display: on ? "block" : "none" }} />
        {!on && <button className="btn primary" onClick={() => { setResult(null); setOn(true); }}>📷 Start scanning</button>}
        <canvas ref={canvas} hidden />
      </div>
      {on && <button className="btn ghost" onClick={() => setOn(false)}>Stop camera</button>}
      {result && (
        <div className={`checkres ${!result.ok ? "bad" : result.already ? "warn" : "good"}`} role="status">
          {!result.ok ? <><b>✖ {result.error}</b></> : <>
            <b>{result.already ? "⚠️ Already checked in" : "✅ Welcome!"}</b>
            <span className="big">{result.name}</span>
            <small>{result.form_title}{result.status && result.status !== "received" ? ` · ${result.status}` : ""}</small>
            {result.fee && <small>{result.paid ? "💳 Fee paid" : "💳 Fee NOT paid yet"}</small>}
          </>}
        </div>
      )}
      <form className="row" style={{ gap: 8, marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); check(manual); setManual(""); }}>
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Or type/paste a ticket code" aria-label="Ticket code" />
        <button className="btn ghost">Check</button>
      </form>
    </section>
  );
}
