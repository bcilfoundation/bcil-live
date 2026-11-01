import { useState } from "react";
import { useAuth } from "../lib/auth";
import { saveGiver, type Giver } from "../lib/pay";

// Asked before someone's first payment in a visit: are you 18 or older? Under-18s confirm a parent or guardian knows.
export default function GiverCheck({ onDone, onCancel }: { onDone: (g: Giver) => void; onCancel: () => void }) {
  const { profile } = useAuth();
  const markedMinor = !!profile?.is_minor;
  const [adult, setAdult] = useState<boolean | null>(markedMinor ? false : null);
  const [ok, setOk] = useState(false);
  const done = () => { const g = { adult: !!adult, guardian_ok: !adult && ok }; saveGiver(g); onDone(g); };
  return (
    <div className="givercheck">
      <h3>Before you give</h3>
      {!markedMinor && (
        <div className="seg" role="radiogroup" aria-label="Your age">
          <button type="button" role="radio" aria-checked={adult === true} onClick={() => setAdult(true)}>I'm 18 or older</button>
          <button type="button" role="radio" aria-checked={adult === false} onClick={() => setAdult(false)}>I'm under 18</button>
        </div>
      )}
      {adult === false && <>
        <label className="choice"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> My parent or guardian knows I'm giving to BCIL Foundation.</label>
        <p className="muted small">Members under 18 can give up to GH₵ 20 a day. Thank you for wanting to help!</p>
      </>}
      <p className="muted small">100% of your gift goes to BCIL Foundation's programmes. Gifts can't be refunded once paid, except for mistakes. Email info@bcilfoundation.org.</p>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" disabled={adult === null || (adult === false && !ok)} onClick={done}>Continue</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
