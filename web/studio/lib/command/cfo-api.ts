import { getBackendToken } from "../backend/auth";

export class CfoApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "CfoApiError"; }
}
export async function cfoRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getBackendToken();
  init.signal?.throwIfAborted();
  if (!token) throw new CfoApiError(401, "Sign in to hear your CFO.");
  const response = await fetch(`/api/onboarding${path}`, { ...init, cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  if (!response.ok) {
    let message = response.status === 401 || response.status === 403 ? "Your workspace access needs to be refreshed." : "The CFO service is unavailable. Your updates remain in history.";
    try { const body = await response.json(); if (typeof body.detail === "string") message = body.detail.slice(0, 500); } catch { /* Keep the safe status message. */ }
    throw new CfoApiError(response.status, message);
  }
  return response;
}
export async function cfoJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await cfoRequest(path, init)).json() as Promise<T>;
}
