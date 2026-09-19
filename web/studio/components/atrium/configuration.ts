/** The onboarding integration owns this configuration; no backend needs are inferred here. */
export const ATRIUM_STATIONS_EVENT = "hyper:workspace-stations";
const STORAGE_KEY = "hyper.workspace.stations.v1";

export type WorkspaceSection = "overview" | "cases" | "evidence" | "activity" | "review" | "timeline" | "benchmarks";
export type AtriumStation = { id: string; label: string; template: string; section?: WorkspaceSection };
export type AtriumStationConfiguration = { stations: readonly AtriumStation[] } | { count: number };
export const DEFAULT_STATIONS: readonly AtriumStation[] = [
  { id: "accounts-payable", label: "Accounts Payable", template: "accounts-payable", section: "cases" },
  { id: "wallet-identity", label: "Wallet Identity", template: "wallet-identity", section: "activity" },
  { id: "audit-evidence", label: "Audit & Evidence", template: "audit-evidence", section: "evidence" },
  { id: "training-arena", label: "Training Arena", template: "training-arena", section: "timeline" },
  { id: "approvals", label: "Approvals", template: "approvals", section: "review" },
  { id: "benchmarks", label: "Benchmarks", template: "crystal-stack", section: "benchmarks" },
];
const SECTIONS = new Set(["overview", "cases", "evidence", "activity", "review", "timeline", "benchmarks"]);
const listeners = new Set<() => void>();
let current: readonly AtriumStation[] = DEFAULT_STATIONS;

export function parseAtriumConfiguration(value: unknown): readonly AtriumStation[] | null {
  if (!value || typeof value !== "object") return null;
  const config = value as Record<string, unknown>;
  if ("count" in config) {
    if (typeof config.count !== "number" || !Number.isInteger(config.count) || config.count < 1 || config.count > 12) return null;
    return Array.from({ length: config.count }, (_, index) => DEFAULT_STATIONS[index] ? { ...DEFAULT_STATIONS[index] } : {
      id: `workspace-${index + 1}`, label: `Workspace ${index + 1}`, template: ["crystal-tall", "crystal-wide", "crystal-orbit", "crystal-stack", "crystal-clear"][(index - DEFAULT_STATIONS.length) % 5],
    });
  }
  if (!Array.isArray(config.stations) || config.stations.length < 1 || config.stations.length > 12) return null;
  const ids = new Set<string>();
  const stations: AtriumStation[] = [];
  for (const item of config.stations) {
    if (!item || typeof item !== "object") return null;
    if (typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id)) return null;
    if (typeof item.label !== "string" || !item.label.trim() || item.label.length > 80) return null;
    if (typeof item.template !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.template)) return null;
    if (item.section !== undefined && !SECTIONS.has(item.section)) return null;
    ids.add(item.id);
    stations.push({ id: item.id, label: item.label.trim(), template: item.template, ...(item.section ? { section: item.section } : {}) });
  }
  return stations;
}

function accept(stations: readonly AtriumStation[]) {
  current = stations;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ stations })); } catch { /* Session configuration remains usable without storage. */ }
  listeners.forEach(update => update());
}

/** Call with the real station list after onboarding, or a chosen count from 1 to 12. */
export function configureAtriumStations(configuration: AtriumStationConfiguration): void {
  const stations = parseAtriumConfiguration(configuration);
  if (!stations) throw new Error("Choose 1 to 12 valid, uniquely named workspace stations.");
  if (typeof window === "undefined") return;
  accept(stations);
  window.dispatchEvent(new CustomEvent(ATRIUM_STATIONS_EVENT, { detail: { stations } }));
}

export const getAtriumStations = () => current;
export const getDefaultAtriumStations = () => DEFAULT_STATIONS;
export const subscribeAtriumStations = (update: () => void) => { listeners.add(update); return () => { listeners.delete(update); }; };

// This module is imported by the onboarding gate, so configuration arriving before
// completion is retained even though the actual atrium renderer is not mounted yet.
if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) current = parseAtriumConfiguration(JSON.parse(saved)) ?? DEFAULT_STATIONS;
  } catch { /* Invalid stored values fall back to the initial stations. */ }
  window.addEventListener(ATRIUM_STATIONS_EVENT, event => {
    const stations = parseAtriumConfiguration((event as CustomEvent<unknown>).detail);
    if (stations && JSON.stringify(stations) !== JSON.stringify(current)) accept(stations);
  });
  window.addEventListener("storage", event => {
    if (event.key !== STORAGE_KEY) return;
    try {
      current = event.newValue ? parseAtriumConfiguration(JSON.parse(event.newValue)) ?? DEFAULT_STATIONS : DEFAULT_STATIONS;
      listeners.forEach(update => update());
    } catch { /* Keep the current layout if another tab writes invalid data. */ }
  });
}
