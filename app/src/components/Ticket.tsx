import { useEffect, useState } from "react";

// A registration's QR ticket. The desk scans it on the day (Admin → Scan tickets).
export default function Ticket({ ticket, title, checkedIn }: { ticket: string; title: string; checkedIn?: boolean }) {
  const [src, setSrc] = useState("");
  useEffect(() => { import("qrcode").then((Q) => Q.toDataURL(ticket, { width: 320, margin: 1 }).then(setSrc)); }, [ticket]);
  return (
    <div className="ticket">
      {src ? <img src={src} alt="Your QR ticket" /> : <p className="muted">Making your ticket…</p>}
      <b>{title}</b>
      {checkedIn ? <span className="pill paid">✓ Checked in</span>
        : <small className="muted">Show this at the registration desk. Screenshot it in case there's no internet at the venue.</small>}
    </div>
  );
}

/** The ticket in a pop-up card */
export function TicketSheet({ ticket, title, checkedIn, close }: { ticket: string; title: string; checkedIn?: boolean; close: () => void }) {
  return (
    <>
      <div className="sheet-back" onClick={close} />
      <div className="sheet" role="dialog" aria-label="Your ticket">
        <div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>🎟 Your ticket</h3><button className="linkbtn" onClick={close}>Close</button></div>
        <Ticket ticket={ticket} title={title} checkedIn={checkedIn} />
      </div>
    </>
  );
}
