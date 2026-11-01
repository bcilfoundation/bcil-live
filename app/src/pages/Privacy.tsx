import { Link } from "react-router-dom";

// Public page (no sign-in needed). Linked from the app stores and the sign-in screen.
export default function Privacy() {
  return (
    <section className="view legal">
      <img src={`${import.meta.env.BASE_URL}logo-wordmark.webp`} alt="BCIL Foundation" style={{ height: 40, width: "auto", alignSelf: "flex-start" }} />
      <h1>Privacy policy</h1>
      <p className="muted">BCIL Live · BCIL Foundation LBG · Last updated 31 October 2026</p>

      <h2>Who we are</h2>
      <p>BCIL Live is the app and website of BCIL Foundation LBG, a non-profit organisation working with students in Ghana. This policy explains what information the app collects, why, and the choices you have. Contact us any time at <a href="mailto:info@bcilfoundation.org">info@bcilfoundation.org</a>.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Account details:</b> your name, and the email address or phone number you sign in with.</li>
        <li><b>Profile:</b> the photo and short bio you choose to add.</li>
        <li><b>What you post:</b> chat and direct messages, live-room comments, group updates and photos, activity RSVPs, notes, comments on talks, friend connections, and form responses (for example, programme registrations).</li>
        <li><b>Live audio and video:</b> when you call in to a live session or turn on your camera in a video session, your voice or video is streamed to people in the room in real time. Live sessions are not recorded unless the host announces a recording at the start.</li>
        <li><b>Giving and fees:</b> if you give or pay a fee (for example, a certificate fee) through the app, the amount, purpose and payment status. Payment details (Mobile Money number or card) are handled by our payment provider, Paystack, not stored by us.</li>
        <li><b>Activity:</b> which talks you listen to and for how long, live sessions you attend, and quotes you read or like. BCIL staff use this to see what helps members most and to recognise active members.</li>
        <li><b>Technical:</b> basic information needed to keep you signed in and deliver notifications. We do not use advertising trackers.</li>
      </ul>

      <h2>How we use it</h2>
      <p>To run the app: sign you in, show your posts and messages to the people they are meant for, run live sessions, send you notifications you have turned on, manage programme registrations, and keep the community safe (moderators can review reported content). We do not sell your information or use it for advertising.</p>

      <h2>Who processes it for us</h2>
      <ul>
        <li><b>Supabase</b> (database, sign-in and file storage, hosted in the European Union)</li>
        <li><b>Agora</b> (real-time audio for live sessions)</li>
        <li><b>GitHub Pages</b> (hosting the app's website)</li>
        <li><b>Paystack</b> (payments, when giving is turned on)</li>
        <li><b>Hostinger</b> (sending sign-in code emails)</li>
      </ul>

      <h2>Young people</h2>
      <p>BCIL programmes include students under 18. Members marked as under 18 can only connect and exchange direct messages with BCIL staff and mentors, and all community spaces are moderated. Anyone can report a message or a person from within the app.</p>

      <h2>How long we keep it</h2>
      <p>We keep your information while your account is open. When you delete your account, your profile, messages, posts, friendships and other content are deleted. Records of gifts are kept for the foundation's financial accounts, but are no longer linked to you.</p>

      <h2 id="delete">Deleting your account</h2>
      <p>In the app, tap your name (top right) → <b>Delete my account</b>. This is immediate and permanent. If you cannot sign in, email <a href="mailto:info@bcilfoundation.org?subject=Delete%20my%20BCIL%20Live%20account">info@bcilfoundation.org</a> from the email address on your account and we will delete it within 7 days.</p>

      <h2>Your rights</h2>
      <p>Under Ghana's Data Protection Act, 2012 (Act 843) and other laws that may apply to you, you can ask to see, correct or delete your information. Email us and we will respond within 30 days.</p>

      <h2>Changes</h2>
      <p>If we change this policy we will update the date above and tell members in the app.</p>
      <p><Link to="/">← Back to BCIL Live</Link></p>
    </section>
  );
}
