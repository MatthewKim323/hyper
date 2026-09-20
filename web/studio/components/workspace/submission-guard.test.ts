import { describe, expect, it } from "bun:test";
import { createSubmissionGuard } from "./submission-guard";

describe("decision submission guard", () => {
  it("starts one request for concurrent clicks and allows a later explicit action", async () => {
    const guard = createSubmissionGuard();
    let release!: (value: string) => void;
    const first = guard.run(() => new Promise<string>(resolve => { release = resolve; }));
    let duplicateCalled = false;
    expect(await guard.run(async () => { duplicateCalled = true; return "duplicate"; })).toEqual({ submitted: false });
    expect(duplicateCalled).toBe(false);
    release("saved");
    expect(await first).toEqual({ submitted: true, value: "saved" });
    expect(await guard.run(async () => "next")).toEqual({ submitted: true, value: "next" });
  });
  it("releases its lock after failure without automatically retrying a decision", async () => {
    const guard = createSubmissionGuard();
    let calls = 0;
    await expect(guard.run(async () => { calls++; throw new Error("conflict"); })).rejects.toThrow("conflict");
    expect(calls).toBe(1);
    expect(await guard.run(async () => { calls++; return "new explicit choice"; })).toEqual({ submitted: true, value: "new explicit choice" });
    expect(calls).toBe(2);
  });
});
