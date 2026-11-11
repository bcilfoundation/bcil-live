import { NavLink } from "react-router-dom";

// Messages, Groups, Campus Sync and Friends live together under the Chat tab. All four fit on screen, no scrolling.
export default function ChatTabs() {
  return (
    <nav className="chattabs" aria-label="Chat sections">
      <NavLink to="/chat"><span aria-hidden>💬</span>Chats</NavLink>
      <NavLink to="/groups"><span aria-hidden>👥</span>Groups</NavLink>
      <NavLink to="/campus"><span aria-hidden>🎓</span>Campus Sync</NavLink>
      <NavLink to="/friends"><span aria-hidden>🤝</span>Friends</NavLink>
    </nav>
  );
}
