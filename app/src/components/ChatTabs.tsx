import { NavLink } from "react-router-dom";

// Chat, Groups (incl. Campus Sync) and Friends live together under the Chat tab
export default function ChatTabs() {
  return (
    <div className="seg chattabs" role="tablist">
      <NavLink to="/chat" role="tab">💬 Messages</NavLink>
      <NavLink to="/groups" role="tab">👥 Groups</NavLink>
      <NavLink to="/friends" role="tab">🤝 Friends</NavLink>
    </div>
  );
}
