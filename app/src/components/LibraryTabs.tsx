import { NavLink } from "react-router-dom";

// Talks, the Reading room, the Bookshop and Photos live together under the Library tab
export default function LibraryTabs() {
  return (
    <nav className="chattabs libtabs" aria-label="Library sections">
      <NavLink to="/library"><span aria-hidden>🎧</span>Talks</NavLink>
      <NavLink to="/reading"><span aria-hidden>📚</span>Reading room</NavLink>
      <NavLink to="/shop"><span aria-hidden>🛒</span>Bookshop</NavLink>
      <NavLink to="/photos"><span aria-hidden>📷</span>Photos</NavLink>
    </nav>
  );
}
