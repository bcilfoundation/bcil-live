import { useState } from "react";

// Emoji panel for the message box. Recently used emojis come first.
const SETS: [string, string, string][] = [
  ["Smileys", "😀", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 😎 🤓 🥳 😏 😌 😴 🤔 🤗 🤭 🫡 🤫 😐 😑 😶 🙄 😬 😮 😯 😲 🥺 😢 😭 😤 😡 🤯 😳 🥵 🥶 😱 😨 😰 😓 🤒 🤕 🤧 😷 🥴 😵 🤐"],
  ["Hands", "👍", "👍 👎 👏 🙌 🙏 🤝 👋 🤚 ✋ 🖐 👌 🤌 🤏 ✌️ 🤞 🫶 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✊ 👊 🤛 🤜 💪 🫵 ✍️ 🙋 🙇 🤷 🤦 💁 🙆 🙅"],
  ["Hearts", "❤️", "❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 ✨ 🌟 ⭐ 🔥 💥 💫"],
  ["Celebrate", "🎉", "🎉 🎊 🎈 🎁 🎂 🍾 🥂 🏆 🥇 🎓 📚 📖 ✏️ 📝 🎤 🎧 🎶 🎵 📸 🎬 💡 📌 📅 ⏰ ✅ ☑️ ❌ ⚠️ 🔔 📣"],
  ["Faith", "🙏", "🙏 ✝️ ⛪ 🕊 🌅 🌄 🌈 ☀️ 🌤 🌙 ⭐ 🌱 🌿 🌳 🌻 🌹 🌸 🍀 💐 🌍 🇬🇭"],
  ["Food", "🍕", "🍕 🍔 🍟 🌭 🍿 🍩 🍪 🍫 🍦 🍉 🍌 🍍 🥭 🍊 🍎 🥑 🍗 🍚 🍛 🍲 🥤 ☕ 🍵 🧃"],
  ["Things", "⚽", "⚽ 🏀 🏈 🎾 🏐 🏃 🚶 🚗 🚌 ✈️ 🏠 🏫 💻 📱 💰 💳 🎒 👔 👗 👟 🧢 ⌚ 🔑 🗓"],
];
const RKEY = "bcil.emoji.recent";

export default function EmojiPanel({ onPick }: { onPick: (e: string) => void }) {
  const [tab, setTab] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(RKEY) || "[]"); } catch { return []; } });
  const pick = (e: string) => {
    onPick(e);
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 24);
    setRecent(next); try { localStorage.setItem(RKEY, JSON.stringify(next)); } catch { /* */ }
  };
  const list = tab === -1 ? recent : SETS[tab][2].split(" ");
  return (
    <div className="emojipanel" role="dialog" aria-label="Emojis" onMouseDown={(e) => e.preventDefault()}>
      <div className="emojitabs" role="tablist">
        {recent.length > 0 && <button type="button" role="tab" aria-selected={tab === -1} onClick={() => setTab(-1)} aria-label="Recent">🕘</button>}
        {SETS.map(([name, icon], i) => <button type="button" key={name} role="tab" aria-selected={tab === i} onClick={() => setTab(i)} aria-label={name}>{icon}</button>)}
      </div>
      <div className="emojigrid">{list.map((e, i) => <button type="button" key={e + i} onClick={() => pick(e)} aria-label={e}>{e}</button>)}</div>
    </div>
  );
}
