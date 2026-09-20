"use client";

// Bulk source upload. The server takes one file per request, so a batch is a client-side queue
// uploaded in sequence: a failure on one file never cancels the rest, and each row keeps its own
// outcome so a partial batch is legible instead of collapsing to one error.
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { MAX_UPLOAD_BYTES, uploadSource } from "@/lib/backend/client";

type Row = {
  key: string;
  name: string;
  size: number;
  state: "queued" | "uploading" | "done" | "error";
  detail?: string;
};

const ACCEPT = ".csv,.pdf,.txt,.json,.md,.xlsx,.xls,text/csv,application/pdf";

function readable(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SourceUpload({ onUploaded }: { onUploaded?: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const live = useRef(true);

  useEffect(() => () => { live.current = false; abort.current?.abort(); }, []);

  const send = useCallback(async (files: File[]) => {
    if (!files.length || busy) return;
    const queued: Row[] = files.map((file, index) => ({
      key: `${Date.now()}-${index}-${file.name}`, name: file.name, size: file.size,
      state: file.size > MAX_UPLOAD_BYTES ? "error" : "queued",
      detail: file.size > MAX_UPLOAD_BYTES ? "Over the 20 MB limit" : undefined,
    }));
    setRows(queued);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const update = (key: string, patch: Partial<Row>) =>
      setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)));

    let any = false;
    for (const [index, file] of files.entries()) {
      const row = queued[index];
      if (row.state === "error" || controller.signal.aborted) continue;
      update(row.key, { state: "uploading" });
      try {
        const source = await uploadSource(file, { signal: controller.signal });
        if (!live.current) return;
        any = true;
        // Indexing is queued, not finished: the worker embeds and indexes afterwards.
        update(row.key, { state: "done", detail: source.record_count ? `${source.record_count} records · indexing` : "Indexing" });
      } catch (reason) {
        if (!live.current || controller.signal.aborted) return;
        update(row.key, { state: "error", detail: (reason as Error).message });
      }
    }
    if (!live.current) return;
    setBusy(false);
    abort.current = null;
    // Refresh the surrounding lists once, after the batch, rather than per file.
    if (any) onUploaded?.();
  }, [busy, onUploaded]);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void send(files);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void send(Array.from(event.dataTransfer.files ?? []));
  }

  const done = rows.filter(r => r.state === "done").length;
  const failed = rows.filter(r => r.state === "error").length;

  return <section className="ws-upload" aria-label="Upload sources">
    <div className="ws-upload__zone" data-dragging={dragging || undefined} data-busy={busy || undefined}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}>
      <p className="ws-upload__lead">{busy ? "Uploading…" : "Drop files here"}</p>
      <p className="ws-upload__hint">CSV, PDF, XLSX, JSON or text · up to 20 MB each</p>
      <button type="button" className="ws-upload__pick" onClick={() => fileInput.current?.click()} disabled={busy}>
        Choose files
      </button>
      <input ref={fileInput} type="file" multiple accept={ACCEPT} onChange={choose}
        aria-label="Choose source files to upload" hidden />
    </div>

    {rows.length > 0 && <>
      <div className="ws-source-actions">
        <span className="ws-eyebrow">
          {done} uploaded{failed ? ` · ${failed} failed` : ""}{busy ? ` · ${rows.length - done - failed} left` : ""}
        </span>
        {busy
          ? <button type="button" className="ws-link" onClick={() => abort.current?.abort()}>Stop</button>
          : <button type="button" className="ws-link" onClick={() => setRows([])}>Clear</button>}
      </div>
      <ul className="ws-rows ws-upload__rows">
        {rows.map(row => <li key={row.key} data-state={row.state}>
          <div>
            <span className="ws-upload__name">{row.name}</span>
            <small>{readable(row.size)}{row.detail ? ` · ${row.detail}` : ""}</small>
          </div>
          <span className="ws-upload__state" aria-live="polite">
            {row.state === "done" ? "Uploaded" : row.state === "error" ? "Failed" : row.state === "uploading" ? "Uploading…" : "Queued"}
          </span>
        </li>)}
      </ul>
    </>}
  </section>;
}
