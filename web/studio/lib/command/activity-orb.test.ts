import { expect, test } from "bun:test";
import { activityOrb } from "./activity-orb";

test("active work, queued work and voice use distinct motion", () => {
  expect(activityOrb("RUNNING")).toBe("working");
  expect(activityOrb("queued")).toBe("connecting");
  expect(activityOrb("speaking")).toBe("weaving");
  expect(activityOrb("listening")).toBe("listening");
});

test("idle connections use the composing resting state", () => {
  expect(activityOrb("idle")).toBe("composing");
  expect(activityOrb("connected")).toBe("composing");
});

test("waiting and finished work keep the composing idle motion instead of indicating work", () => {
  for (const status of ["attention", "failed", "completed", "cancelled", "needs_input", "launch_uncertain", "disconnected", "unauthorized", "waiting", "new_provider_status", "constructor", ""]) {
    expect(activityOrb(status)).toBe("composing");
  }
});
