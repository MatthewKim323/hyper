import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { BackendError, poll } from "./client";

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function withClock(run: (clock: {
  readonly count: number; readonly delay: number | undefined; hidden: boolean; next(): Promise<void>;
}) => Promise<void>) {
  const originals = new Map(["setTimeout", "clearTimeout", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let sequence = 0;
  const scheduled = new Map<number, { callback: () => void; delay: number }>();
  const doc = { hidden: false };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: (callback: () => void, delay: number) => { const id = ++sequence; scheduled.set(id, { callback, delay }); return id; } });
  Object.defineProperty(globalThis, "clearTimeout", { configurable: true, value: (id: number) => { scheduled.delete(id); } });
  try {
    await run({
      get count() { return scheduled.size; },
      get delay() { return scheduled.values().next().value?.delay; },
      get hidden() { return doc.hidden; },
      set hidden(value) { doc.hidden = value; },
      async next() { const entry = scheduled.entries().next().value; assert.ok(entry, "a next poll must be scheduled"); scheduled.delete(entry[0]); entry[1].callback(); await flush(); },
    });
  } finally {
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}

describe("backend polling lifecycle", () => {
  test("stopping a request suppresses both late success and late failure without scheduling another timer", async () => {
    for (const rejected of [false, true]) {
      await withClock(async clock => {
        const pending = deferred<string>();
        const data: string[] = [], errors: Error[] = [];
        let requests = 0;
        const stop = poll(() => { requests++; return pending.promise; }, value => data.push(value), { onError: error => errors.push(error) });
        assert.equal(requests, 1);
        assert.equal(clock.count, 0);
        stop(); stop();
        if (rejected) pending.reject(new Error("late backend response")); else pending.resolve("stale workspace");
        await flush();
        assert.deepEqual(data, []);
        assert.deepEqual(errors, []);
        assert.equal(clock.count, 0);
        assert.equal(requests, 1);
      });
    }
  });

  test("runs one request at a time and removes a scheduled timeout on unmount", async () => {
    await withClock(async clock => {
      const requests: ReturnType<typeof deferred<number>>[] = [];
      const data: number[] = [];
      const stop = poll(() => { const request = deferred<number>(); requests.push(request); return request.promise; }, value => data.push(value), { everyMs: 2000 });
      assert.equal(clock.count, 0, "there is no next timer while a request is outstanding");
      requests[0].resolve(1);
      await flush();
      assert.deepEqual(data, [1]);
      assert.equal(clock.count, 1);
      assert.equal(clock.delay, 2000);
      await clock.next();
      assert.equal(requests.length, 2);
      assert.equal(clock.count, 0);
      requests[1].resolve(2);
      await flush();
      assert.equal(clock.count, 1);
      stop();
      assert.equal(clock.count, 0);
    });
  });

  test("waits while a page is hidden and resumes without overlapping requests", async () => {
    await withClock(async clock => {
      clock.hidden = true;
      const request = deferred<string>();
      let calls = 0;
      const stop = poll(() => { calls++; return request.promise; }, () => {});
      assert.equal(calls, 0);
      assert.equal(clock.delay, 4000);
      await clock.next();
      assert.equal(calls, 0);
      assert.equal(clock.count, 1);
      clock.hidden = false;
      await clock.next();
      assert.equal(calls, 1);
      assert.equal(clock.count, 0);
      stop();
      request.resolve("hidden then visible");
      await flush();
      assert.equal(clock.count, 0);
    });
  });

  test("backs off to a capped interval after errors and resets its interval after recovery", async () => {
    await withClock(async clock => {
      let pending = deferred<number>();
      const errors: Error[] = [];
      const stop = poll(() => pending.promise, () => {}, { onError: error => errors.push(error) });
      for (const expected of [8000, 16000, 32000, 60000, 60000]) {
        pending.reject(new BackendError(503, "Temporarily unavailable"));
        await flush();
        assert.equal(clock.delay, expected);
        pending = deferred<number>();
        await clock.next();
      }
      pending.resolve(1);
      await flush();
      assert.equal(clock.delay, 4000);
      assert.equal(errors.length, 5);
      stop();
      assert.equal(clock.count, 0);
    });
  });

  test("401 ends the polling session after delivering the sign-in error once", async () => {
    await withClock(async clock => {
      const errors: Error[] = [];
      const stop = poll(async () => { throw new BackendError(401, "Expired session"); }, () => assert.fail("no data for an expired session"), { onError: error => errors.push(error) });
      await flush();
      assert.equal(errors.length, 1);
      assert.equal(clock.count, 0);
      stop();
    });
  });

  test("consumer cancellation from a data or error callback cannot leave a retry timer", async () => {
    for (const rejected of [false, true]) {
      await withClock(async clock => {
        const request = deferred<number>();
        let stop = () => {};
        let callbacks = 0;
        const cancel = () => { callbacks++; stop(); };
        stop = poll(() => request.promise, cancel, { onError: cancel });
        if (rejected) request.reject(new Error("offline")); else request.resolve(1);
        await flush();
        assert.equal(callbacks, 1);
        assert.equal(clock.count, 0);
      });
    }
  });
});
