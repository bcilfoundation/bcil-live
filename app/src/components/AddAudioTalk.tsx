import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { MicRecorder, audioDuration, clock, uploadAudio } from "../lib/recorder";

export const PROGRAMS = ["Finding Campus Balance", "Keys to Success", "Operation 4.0", "Beyond Junior High", "Academic Mentorship", "Daily Bites", "Live sessions", "Campus Sync"];

// Record a talk on this phone/computer, or upload an audio file, and publish it to the Library
export default function AddAudioTalk({ onSaved }: { onSaved?: () => void }) {
  const { session } = useAuth();
  const [mode, setMode] = useState<"record" | "upload">("record");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [state, setState] = useState<"idle" | "recording" | "paused">("idle");
  const [secs, setSecs] = useState(0);
  const [title, setTitle] = useState("");
  const [program, setProgram] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const rec = useRef<MicRecorder | null>(null);

  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => () => { rec.current?.cancel(); if (preview) URL.revokeObjectURL(preview); }, []);

  function useFile(b: Blob | null) {
    if (preview) URL.revokeObjectURL(preview);
    setBlob(b); setPreview(b ? URL.createObjectURL(b) : "");
  }
  async function start() {
    setMsg("");
    try {
      rec.current = new MicRecorder();
      await rec.current.start();
      useFile(null); setSecs(0); setState("recording");
    } catch { setMsg("Could not use the microphone. Allow microphone access for this site and try again."); }
  }
  function pause() { rec.current?.pause(); setState("paused"); }
  function resume() { rec.current?.resume(); setState("recording"); }
  async function stop() {
    const b = await rec.current!.stop();
    setState("idle"); useFile(b);
  }
  function pick(f?: File) {
    setMsg("");
    if (!f) return;
    if (!f.type.startsWith("audio/") && !/\.(mp3|m4a|aac|wav|ogg|webm)$/i.test(f.name)) { setMsg("Please choose an audio file (MP3, M4A, WAV…)."); return; }
    if (f.size > 50 * 1024 * 1024) { setMsg("That file is over 50 MB. Export it as MP3 or M4A to make it smaller."); return; }
    useFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const status = submitter?.value === "draft" ? "draft" : "published";
    if (!blob) { setMsg(mode === "record" ? "Record something first." : "Choose an audio file first."); return; }
    if (!title.trim()) { setMsg("Give the talk a title."); return; }
    setBusy(true); setMsg("Uploading… keep this page open.");
    try {
      const url = await uploadAudio(session!.user.id, blob, title);
      const duration = (await audioDuration(blob)) ?? (mode === "record" ? secs : null);
      const { error } = await supabase.from("talks").insert({
        kind: "audio", audio_url: url, title: title.trim(), program: program.trim() || null, description: description.trim() || null,
        published_on: date || null, duration_seconds: duration, created_by: session!.user.id, status,
      });
      if (error) throw error;
      setMsg(status === "draft" ? "Saved as a draft. Find it under Drafts in the Library." : "Published to the Library."); useFile(null); setTitle(""); setDescription(""); setSecs(0);
      onSaved?.();
    } catch (err) {
      setMsg("Could not save: " + ((err as Error).message ?? "unknown error"));
    } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={save}>
      <h3>Add an audio talk</h3>
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "record"} className={mode === "record" ? "on" : ""} onClick={() => { setMode("record"); useFile(null); }}>🎙 Record now</button>
        <button type="button" role="tab" aria-selected={mode === "upload"} className={mode === "upload" ? "on" : ""} onClick={() => { setMode("upload"); rec.current?.cancel(); setState("idle"); useFile(null); }}>⬆ Upload a file</button>
      </div>

      {mode === "record" ? (
        <div className="recbox">
          <div className={`recdot${state === "recording" ? " on" : ""}`} aria-hidden="true" />
          <div className="rectime" aria-live="polite">{clock(secs)}</div>
          <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
            {state === "idle" && <button type="button" className="btn primary" onClick={start}>{blob ? "Record again" : "● Start recording"}</button>}
            {state === "recording" && <button type="button" className="btn ghost" onClick={pause}>Pause</button>}
            {state === "paused" && <button type="button" className="btn ghost" onClick={resume}>Resume</button>}
            {state !== "idle" && <button type="button" className="btn primary" onClick={stop}>■ Stop</button>}
          </div>
          <small className="muted">Keep the phone close and the screen on. You can pause and continue.</small>
        </div>
      ) : (
        <label className="field">Audio file (MP3, M4A, WAV, up to 50 MB)
          <input type="file" accept="audio/*,.mp3,.m4a,.wav,.aac" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      )}

      {preview && <audio controls src={preview} style={{ width: "100%" }} />}

      <label className="field">Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Keys to Success: planning your semester" /></label>
      <div className="grid2">
        <label className="field">Programme or type (optional)<input list="programs" value={program} onChange={(e) => setProgram(e.target.value)} placeholder="e.g. Keys to Success, Q&A, Devotion" /><datalist id="programs">{PROGRAMS.map((p) => <option key={p} value={p} />)}</datalist></label>
        <label className="field">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <label className="field">Short description (optional)<textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 70 }} /></label>
      <p className="muted" role="status">{msg}</p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn primary" value="publish" disabled={busy || state !== "idle"}>{busy ? "Uploading…" : "Publish to Library"}</button>
        <button className="btn ghost" value="draft" disabled={busy || state !== "idle"}>Save as draft</button>
      </div>
    </form>
  );
}
