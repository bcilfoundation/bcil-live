import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

// "Send me the monthly newsletter": one tap puts a member on the email list (and off again)
export default function NewsletterSwitch() {
  const { session, profile, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!profile || profile.newsletter === undefined) return null;
  const on = !!profile.newsletter;
  async function flip() {
    setBusy(true);
    await supabase.from("profiles").update({ newsletter: !on }).eq("id", session!.user.id);
    await refreshProfile(); setBusy(false);
  }
  return (
    <label className="card nlswitch">
      <span className="grow"><b>📬 Monthly newsletter</b><small className="muted">{on ? "You'll get it by email at the start of each month." : "The month's theme, programme news and the best Daily Bite, by email once a month."}</small></span>
      <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={flip} aria-label="Send me the monthly newsletter" />
    </label>
  );
}
