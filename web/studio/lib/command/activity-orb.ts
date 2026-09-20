import type { OrbState } from "thinking-orbs";

const MOVING: Record<string, OrbState> = {
  idle: "composing", composing: "composing", connected: "composing",
  running: "working", working: "working", processing: "working", active: "working", syncing: "working", generating: "working", publishing: "working",
  thinking: "solving", solving: "solving", researching: "searching", searching: "searching",
  queued: "connecting", launching: "connecting", connecting: "connecting", reconnecting: "connecting", loading: "connecting", authorizing: "connecting", recovering: "connecting",
  listening: "listening", speaking: "weaving", weaving: "weaving", shaping: "shaping",
};

/** Composing is the living resting state, including when work needs human input. */
export function activityOrb(status: string): OrbState {
  const key = status.toLowerCase();
  const state = Object.hasOwn(MOVING, key) ? MOVING[key] : undefined;
  return state ?? "composing";
}
