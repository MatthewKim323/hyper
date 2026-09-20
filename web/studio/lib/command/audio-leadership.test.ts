import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createAudioLeadership } from "./audio-leadership";

const settled = () => new Promise<void>(resolve => setTimeout(resolve, 0));
type Request = (name: string, options: LockOptions, callback: () => Promise<void>) => Promise<void>;
const manager = (request: Request) => ({ request } as unknown as Pick<LockManager, "request">);

test("a rejected request releases its owner so the next gesture can acquire audio", async () => {
  let requests = 0, errors = 0;
  const changes: boolean[] = [];
  const owner = createAudioLeadership({ name: "cfo", visible: () => true, onChange: next => changes.push(next), onError: () => { errors++; },
    locks: manager(async (_name, options, callback) => {
      requests++;
      assert.equal(options.steal, undefined, "Retry must not steal a different tab's active audio.");
      if (requests === 1) throw new Error("Lock manager unavailable");
      await callback();
    }),
  });
  owner.acquire(); await settled();
  assert.equal(errors, 1); assert.deepEqual(changes, [false]);
  owner.acquire(); await settled();
  assert.equal(requests, 2); assert.equal(changes.at(-1), true);
  owner.acquire(); assert.equal(requests, 2);
  owner.dispose(); await settled();
  assert.equal(changes.at(-1), false);
});

test("a synchronous request failure is recoverable too", async () => {
  let requests = 0, errors = 0;
  const owner = createAudioLeadership({ name: "cfo", visible: () => true, onChange: () => {}, onError: () => { errors++; },
    locks: manager(() => { requests++; throw new Error("Unavailable"); }),
  });
  owner.acquire(); await settled(); owner.acquire(); await settled();
  assert.equal(requests, 2); assert.equal(errors, 2); owner.dispose();
});

test("a previous released callback cannot clear a newer owner's leadership", async () => {
  let finishOld: (() => void) | undefined, requests = 0, errors = 0;
  const changes: boolean[] = [];
  const owner = createAudioLeadership({ name: "cfo", visible: () => true, onChange: next => changes.push(next), onError: () => { errors++; },
    locks: manager(async (_name, _options, callback) => {
      const request = ++requests;
      await callback();
      if (request === 1) await new Promise<void>(resolve => { finishOld = resolve; });
    }),
  });
  owner.acquire(); owner.release(); await settled();
  owner.acquire(); assert.equal(changes.at(-1), true);
  const count = changes.length; finishOld?.(); await settled();
  assert.equal(changes.length, count); assert.equal(errors, 0);
  owner.dispose(); await settled();
});

test("hidden and disposed sessions cannot acquire; canceled waiters do not report a failure", async () => {
  let visible = false, requests = 0, errors = 0;
  const owner = createAudioLeadership({ name: "cfo", visible: () => visible, onChange: () => {}, onError: () => { errors++; },
    locks: manager((_name, options) => {
      requests++;
      return new Promise<void>((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError"))));
    }),
  });
  owner.acquire(); assert.equal(requests, 0);
  visible = true; owner.acquire(); owner.dispose(); await settled(); owner.acquire();
  assert.equal(requests, 1); assert.equal(errors, 0);
});
