"use client";

import { useEffect, useRef, useState } from "react";
import { getBackendToken } from "@/lib/backend/auth";

/** Originals stay behind the same authenticated source route as their extracted text. */
export default function OriginalSourceDownload({ sourceId, filename }: { sourceId: string; filename: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function download() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError("");
    try {
      const token = await getBackendToken();
      if (!token) throw new Error("Sign in again to download this source.");
      if (controller.signal.aborted) return;
      const response = await fetch(`/api/onboarding/sources/${encodeURIComponent(sourceId)}/download`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Sign in again to download this source." : "The original could not be downloaded. Try again.");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { if (!controller.signal.aborted) setError((reason as Error).message); }
    finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return <div><button type="button" className="ws-link" disabled={busy} onClick={() => void download()}>{busy ? "Preparing original…" : "Download original"}</button>{error && <p className="ws-warning" role="status">{error}</p>}</div>;
}
