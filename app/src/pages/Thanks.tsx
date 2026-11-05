// Paystack sends people here after paying. It is public, so it also works in the phone's browser.
export default function Thanks() {
  const live = new URLSearchParams(window.location.search).get("kind") === "live_gift";
  return (
    <section className="view" style={{ maxWidth: 520, margin: "40px auto", textAlign: "center" }}>
      <div style={{ fontSize: 56 }}>💛</div>
      <h1>Thank you!</h1>
      <p>Your gift to BCIL Foundation is being confirmed. {live ? "It will appear in the live room in a moment." : "You'll see it under My donations."}</p>
      <p className="muted">You can close this page and go back to BCIL Foundation.</p>
      <a className="btn primary" href="/">Open BCIL Foundation</a>
    </section>
  );
}
