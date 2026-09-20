import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { chainLabel, createWalletSession, EMPTY_WALLET, walletAddress, walletChain, type WalletProvider, type WalletState } from "./browser-wallet";

const ALICE = `0x${"a".repeat(40)}`;
const BOB = `0x${"b".repeat(40)}`;
const CHARLIE = `0x${"c".repeat(40)}`;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
class Provider implements WalletProvider {
  calls: { method: string; result: ReturnType<typeof deferred> }[] = [];
  listeners = new Map<string, Set<(value: unknown) => void>>();
  added = 0;
  removed = 0;
  request({ method }: { method: string }) { const result = deferred(); this.calls.push({ method, result }); return result.promise; }
  on(event: string, handler: (value: unknown) => void) { this.added++; if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event)!.add(handler); }
  removeListener(event: string, handler: (value: unknown) => void) { this.removed++; this.listeners.get(event)?.delete(handler); }
  emit(event: string, value: unknown) { this.listeners.get(event)?.forEach(handler => handler(value)); }
  get activeListeners() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}
function harness() {
  const provider = new Provider();
  const states: WalletState[] = [];
  const session = createWalletSession(provider, state => states.push(state));
  return { provider, states, session, latest: () => states.at(-1)! };
}
async function connect(h: ReturnType<typeof harness>) {
  const connected = h.session.connect();
  h.provider.calls.at(-1)!.result.resolve([ALICE]);
  await flush();
  assert.equal(h.provider.calls.at(-1)!.method, "eth_chainId");
  h.provider.calls.at(-1)!.result.resolve("0x1");
  await connected;
}

describe("browser wallet account visibility lifecycle", () => {
  test("deduplicates pending connection requests and only asks for address/network visibility", async () => {
    const h = harness();
    const pending = h.session.connect();
    await h.session.connect();
    assert.equal(h.provider.calls.length, 1);
    assert.equal(h.latest().pending, true);
    assert.equal(h.provider.activeListeners, 0, "initial provider events are represented by the returned account list");
    h.provider.calls[0].result.resolve([ALICE]);
    await flush();
    assert.equal(h.latest().address, ALICE);
    assert.equal(h.provider.activeListeners, 3);
    h.provider.calls[1].result.resolve("0x2105");
    await pending;
    assert.equal(h.latest().chain, "0x2105");
    assert.equal(h.latest().pending, false);
    assert.deepEqual(h.provider.calls.map(call => call.method), ["eth_requestAccounts", "eth_chainId"]);
    h.session.dispose();
  });

  test("hiding an in-flight request allows a new connection and cannot resurrect the old account", async () => {
    const h = harness();
    const old = h.session.connect();
    h.session.hide();
    assert.deepEqual(h.latest(), EMPTY_WALLET);
    const current = h.session.connect();
    h.provider.calls[1].result.resolve([BOB]);
    await flush();
    h.provider.calls[2].result.resolve("0xa");
    await current;
    h.provider.calls[0].result.resolve([ALICE]);
    await old;
    assert.equal(h.latest().address, BOB);
    assert.equal(h.latest().chain, "0xa");
    assert.equal(h.provider.calls.length, 3);
    h.session.dispose();
  });

  test("account changes invalidate older responses; current network events outrank delayed chain reads", async () => {
    const h = harness();
    await connect(h);
    h.provider.emit("accountsChanged", [BOB]);
    const oldChain = h.provider.calls.at(-1)!;
    h.provider.emit("accountsChanged", [CHARLIE]);
    const chain = h.provider.calls.at(-1)!;
    assert.equal(h.latest().address, CHARLIE);
    h.provider.emit("chainChanged", "0x89");
    chain.result.resolve("0x1");
    oldChain.result.resolve("0xa");
    await flush();
    assert.equal(h.latest().address, CHARLIE);
    assert.equal(h.latest().chain, "0x89", "a stale RPC cannot overwrite a newer network event");
    h.provider.emit("accountsChanged", []);
    assert.deepEqual(h.latest(), EMPTY_WALLET);
    h.session.dispose();
  });

  test("hiding removes listeners and ignores already queued provider callbacks without making new RPCs", async () => {
    const h = harness();
    await connect(h);
    const queued = [...h.provider.listeners.values()].flatMap(set => [...set]);
    h.session.hide();
    assert.equal(h.provider.activeListeners, 0);
    const publications = h.states.length;
    queued.forEach(handler => handler([BOB]));
    assert.equal(h.states.length, publications);
    assert.equal(h.provider.calls.length, 2);
    await connect(h);
    assert.equal(h.provider.activeListeners, 3, "reconnecting reinstalls each listener once");
    const currentPublications = h.states.length;
    const currentRequests = h.provider.calls.length;
    queued.forEach(handler => handler([BOB]));
    assert.equal(h.states.length, currentPublications, "queued callbacks from the previous subscription stay invalid after reconnect");
    assert.equal(h.provider.calls.length, currentRequests);
    h.session.dispose();
    h.session.dispose();
    assert.equal(h.provider.added, 6);
    assert.equal(h.provider.removed, 6);
  });

  test("unmounting during account or chain requests suppresses late results and further connections", async () => {
    for (const phase of ["accounts", "chain"]) {
      const h = harness();
      const pending = h.session.connect();
      if (phase === "chain") { h.provider.calls[0].result.resolve([ALICE]); await flush(); }
      const queued = [...h.provider.listeners.values()].flatMap(set => [...set]);
      h.session.dispose();
      const publications = h.states.length;
      const requests = h.provider.calls.length;
      queued.forEach(handler => handler([BOB]));
      h.provider.calls.at(-1)!.result.resolve(phase === "accounts" ? [ALICE] : "0x1");
      await pending;
      await h.session.connect();
      assert.equal(h.states.length, publications);
      assert.equal(h.provider.calls.length, requests);
      assert.equal(h.provider.activeListeners, 0);
    }
  });

  test("rejection is recoverable, does not subscribe, and exposes no arbitrary provider error text", async () => {
    for (const [code, message] of [[4001, "Connection cancelled"], [-32002, "already open"], [12345, "Could not connect"]] as const) {
      const h = harness();
      const pending = h.session.connect();
      h.provider.calls[0].result.reject({ code, message: "raw provider details" });
      await pending;
      assert.ok(h.latest().error?.includes(message));
      assert.equal(h.latest().pending, false);
      assert.equal(h.latest().address, null);
      assert.equal(h.provider.activeListeners, 0);
      await connect(h);
      assert.equal(h.latest().error, null);
      assert.equal(h.latest().address, ALICE);
      h.session.dispose();
    }
  });

  test("disconnect invalidates a pending chain read and clears address access", async () => {
    const h = harness();
    await connect(h);
    h.provider.emit("accountsChanged", [BOB]);
    const chain = h.provider.calls.at(-1)!;
    h.provider.emit("disconnect", { code: 4900 });
    chain.result.reject(new Error("offline"));
    await flush();
    assert.equal(h.latest().address, null);
    assert.equal(h.latest().chain, null);
    assert.ok(h.latest().error?.includes("disconnected"));
    assert.ok(h.provider.calls.every(call => ["eth_requestAccounts", "eth_chainId"].includes(call.method)), "no signing or transaction RPC is allowed");
    h.session.dispose();
  });

  test("request-only providers work without leaking non-removable event subscriptions", async () => {
    const provider = new Provider();
    let subscriptions = 0;
    const states: WalletState[] = [];
    const session = createWalletSession({ request: args => provider.request(args), on: () => { subscriptions++; } }, state => states.push(state));
    const pending = session.connect();
    provider.calls[0].result.resolve([ALICE]);
    await flush();
    provider.calls[1].result.resolve("0x1");
    await pending;
    assert.equal(states.at(-1)!.address, ALICE);
    assert.equal(subscriptions, 0);
    session.dispose();
  });

  test("validates account/network payloads before display", () => {
    assert.equal(walletAddress([ALICE]), ALICE);
    for (const value of [ALICE, [], ["0x123"], [null], ["<script>"]]) assert.equal(walletAddress(value), null);
    for (const value of [1, "", "1", "0x", "0xz", `0x${"1".repeat(65)}`]) assert.equal(walletChain(value), null);
    assert.equal(walletChain("0x89"), "0x89");
    assert.equal(chainLabel("0x2105"), "Base");
    assert.equal(chainLabel("0x270f"), "Chain 9999");
    assert.equal(chainLabel(null), "Network unavailable");
  });
});
