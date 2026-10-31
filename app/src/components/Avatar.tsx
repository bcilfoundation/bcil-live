import { initials } from "../lib/supabase";

export default function Avatar({ name, url, size = 40 }: { name?: string | null; url?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  return url
    ? <img className="avatar" src={url} alt="" style={style} />
    : <span className="avatar" style={style} aria-hidden="true">{initials(name ?? "")}</span>;
}
