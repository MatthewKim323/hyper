"use client";

// Attach control for the onboarding composer. Onboarding is a voice conversation, so this stays a
// single icon button rather than a drop zone: the point is to let someone hand over their ledgers
// while they talk, not to run a file manager mid-sentence.
//
// Uploading needs a signed-in session, which onboarding does not require, so the button only
// appears once the session exists. Rendering it earlier would offer an action that can only 401.
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { MAX_UPLOAD_BYTES, uploadSource } from "@/lib/backend/client";
import { useAuth } from "@/components/workspace/useBackend";

export default function AttachSources() {
  const auth = useAuth();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  if (!auth.signedIn) return null;

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setNote(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`);
    let done = 0;
    let failed = 0;
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) { failed += 1; continue; }
      try { await uploadSource(file); done += 1; }
      catch { failed += 1; }
      if (!live.current) return;
    }
    if (!live.current) return;
    setBusy(false);
    setNote(done
      ? `${done} file${done === 1 ? "" : "s"} attached · indexing${failed ? ` · ${failed} failed` : ""}`
      : "Upload failed. Try again once you are signed in.");
  }

  return <div className="hyper-onboarding__attach">
    <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}
      aria-label={busy ? "Uploading files" : "Attach financial files"} title="Attach financial files">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
    <input ref={fileInput} type="file" multiple hidden onChange={choose}
      accept=".csv,.pdf,.txt,.json,.md,.xlsx,.xls,text/csv,application/pdf"
      aria-label="Choose financial files to attach" />
    {note && <span className="hyper-onboarding__attach-note" role="status">{note}</span>}
  </div>;
}
