import { NavLink } from "react-router-dom";

// Chats, Campus Sync and Friends live together under the Chat tab. Group chats sit in the chat list; "Find groups" there opens the groups page.
export default function ChatTabs() {
  return (
    <nav className="chattabs" aria-label="Chat sections">
      <NavLink to="/chat"><span aria-hidden>💬</span>Chats</NavLink>
      <NavLink to="/campus"><span aria-hidden>🎓</span>Campus Sync</NavLink>
      <NavLink to="/friends"><span aria-hidden>🤝</span>Friends</NavLink>
    </nav>
  );
}
