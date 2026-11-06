// Opening a shared document for review (with comments) in the app.
import { supabase } from "./supabase";

/** Register the file for review if needed, and return the address of its review page. */
export async function docLink(path: string, name: string, context: "meeting" | "mentorship" | "form", ref: number) {
  const { data, error } = await supabase.rpc("open_document", { p_path: path, p_name: name, p_context: context, p_ref: ref });
  if (error || !data) throw new Error(/function|does not exist/i.test(error?.message ?? "") ? "Document review isn't switched on yet (migration 041)." : error?.message ?? "Could not open the document.");
  return `/doc/${data}`;
}
/** The original file name from a stored path like "user-id/uuid-My_CV.pdf". */
export const fileName = (path: string) => path.replace(/^.*\//, "").replace(/^[0-9a-f-]{36}-/i, "").replace(/_/g, " ");
