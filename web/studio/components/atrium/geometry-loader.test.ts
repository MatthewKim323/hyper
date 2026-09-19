import { strict as assert } from "node:assert";
import { describe, test, type TestContext } from "node:test";
import { BufferGeometry, Float32BufferAttribute, Mesh, Uint8BufferAttribute } from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { createAtriumGeometryLoader } from "./geometry-loader";

type RuntimeDecoder = typeof DRACOLoader.prototype & {
  decodeGeometry(buffer: ArrayBuffer, task: unknown): Promise<BufferGeometry>;
  workerSourceURL: string;
};
const prototype = DRACOLoader.prototype as RuntimeDecoder;

function stubDecoder(t: TestContext, decode: RuntimeDecoder["decodeGeometry"]) {
  const originalDecode = prototype.decodeGeometry;
  const originalDispose = prototype.dispose;
  const calls = { decodes: 0, disposals: 0 };
  prototype.decodeGeometry = function (buffer, task) { calls.decodes++; return decode.call(this, buffer, task); };
  prototype.dispose = function () { calls.disposals++; return this; };
  t.after(() => { prototype.decodeGeometry = originalDecode; prototype.dispose = originalDispose; });
  return calls;
}

function progressEvents(t: TestContext) {
  if (typeof ProgressEvent !== "undefined") return;
  Object.defineProperty(globalThis, "ProgressEvent", { configurable: true, value: class extends Event {
    constructor(type: string, data: object) { super(type); Object.assign(this, data); }
  } });
  t.after(() => { Reflect.deleteProperty(globalThis, "ProgressEvent"); });
}

function asset(compressed: boolean, count = 1) {
  return "data:application/json;base64," + Buffer.from(JSON.stringify({
    asset: { version: "2.0" },
    ...(compressed ? { extensionsUsed: ["KHR_draco_mesh_compression"], extensionsRequired: ["KHR_draco_mesh_compression"] } : {}),
    buffers: [{ byteLength: 36, uri: "data:application/octet-stream;base64," + Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer).toString("base64") }],
    bufferViews: Array.from({ length: count }, () => ({ buffer: 0, byteOffset: 0, byteLength: 36 })),
    accessors: [{ ...(compressed ? {} : { bufferView: 0 }), componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }, ...(compressed ? [{ componentType: 5121, normalized: true, count: 3, type: "VEC3" }] : [])],
    meshes: [{ primitives: Array.from({ length: count }, (_, index) => ({
      attributes: { POSITION: 0, ...(compressed ? { COLOR_0: 1 } : {}) },
      ...(compressed ? { extensions: { KHR_draco_mesh_compression: { bufferView: index, attributes: { POSITION: 0, COLOR_0: 1 } } } } : {}),
    })) }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  })).toString("base64");
}

function triangle() {
  return new BufferGeometry()
    .setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
    .setAttribute("color", new Uint8BufferAttribute([255, 0, 0, 0, 255, 0, 0, 0, 255], 3));
}

describe("atrium Draco adapter", { concurrency: false }, () => {
  test("propagates a decoder failure through real GLTF parsing and releases the pool", { timeout: 2000 }, async t => {
    progressEvents(t);
    const failure = new Error("Corrupt Draco primitive");
    const calls = stubDecoder(t, () => Promise.reject(failure));
    const loader = createAtriumGeometryLoader();
    await assert.rejects(loader.loadAsync(asset(true)), error => error === failure);
    assert.equal(calls.decodes, 1);
    loader.dispose();
    loader.dispose();
    assert.equal(calls.disposals, 1);
    await assert.rejects(loader.loadAsync(asset(false)), { name: "AbortError" });
  });

  test("waits for sibling decodes after a failed model before terminating workers", { timeout: 2000 }, async t => {
    progressEvents(t);
    let started!: () => void;
    const bothStarted = new Promise<void>(resolve => { started = resolve; });
    const jobs: { resolve(geometry: BufferGeometry): void; reject(error: Error): void }[] = [];
    const calls = stubDecoder(t, () => new Promise<BufferGeometry>((resolve, reject) => {
      jobs.push({ resolve, reject });
      if (jobs.length === 2) started();
    }));
    const loader = createAtriumGeometryLoader();
    const failure = new Error("First primitive failed");
    const rejection = assert.rejects(loader.loadAsync(asset(true, 2)), error => error === failure);
    await bothStarted;
    loader.dispose();
    jobs[0].reject(failure);
    await rejection;
    assert.equal(calls.disposals, 0);
    jobs[1].resolve(triangle());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.disposals, 1);
  });

  test("preserves compressed vertex colors and still loads ordinary station geometry", { timeout: 2000 }, async t => {
    progressEvents(t);
    const calls = stubDecoder(t, () => Promise.resolve(triangle()));
    const loader = createAtriumGeometryLoader();
    const compressed = await loader.loadAsync(asset(true));
    const mesh = compressed.scene.children[0] as Mesh;
    assert.equal(mesh.geometry.getAttribute("color").normalized, true);
    const plain = await loader.loadAsync(asset(false));
    assert.equal((plain.scene.children[0] as Mesh).geometry.getAttribute("position").count, 3);
    assert.equal(calls.decodes, 1);
    loader.dispose();
    assert.equal(calls.disposals, 1);
  });
});
