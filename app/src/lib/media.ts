import { supabase } from "./supabase";

// Shrink a photo on the phone before uploading (saves mobile data), then store it in the media bucket.
export async function uploadPhoto(userId: string, file: File, maxSide = 1200): Promise<string> {
  const blob = await shrink(file, maxSide);
  const path = `${userId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("media").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

async function shrink(file: File, maxSide: number): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("Could not read that photo."))), "image/jpeg", 0.85));
  } finally { URL.revokeObjectURL(url); }
}
