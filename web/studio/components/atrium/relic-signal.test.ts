import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Mesh, Vector3 } from "three";
import { createRelicSignal } from "./relic-signal";

const create = () => createRelicSignal(new Vector3(0, 2, 0), new Vector3(1.5, 1.8, .4), .49);
const pose = (signal: ReturnType<typeof create>) => {
  const values: number[] = [];
  signal.group.traverse(object => values.push(...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()));
  return values;
};

test("needed decisions radiate without focus and settle when resolved", () => {
  const signal = create();
  for (let i = 0; i < 60; i++) signal.update("attention", 1 / 60, false);
  assert.equal(signal.group.visible, true);
  const before = pose(signal);
  for (let i = 0; i < 30; i++) signal.update("attention", 1 / 60, false);
  assert.notDeepEqual(pose(signal), before);
  for (let i = 0; i < 120; i++) signal.update("idle", 1 / 60, false);
  assert.equal(signal.group.visible, false);
  signal.dispose();
});

test("background work and external waits do not ask for the user's attention", () => {
  const signal = create();
  for (const status of ["working", "waiting", "complete"] as const) {
    signal.update(status, 1 / 60, true);
    assert.equal(signal.group.visible, false);
    assert.equal(signal.intensity.value, 0);
  }
  signal.update("error", 1 / 60, true);
  assert.equal(signal.group.visible, true);
  signal.dispose();
});

test("reduced motion keeps a readable static state through clock changes", () => {
  const signal = create();
  signal.update("attention", 1 / 60, true);
  const first = pose(signal);
  signal.update("attention", 10000, true);
  assert.deepEqual(pose(signal), first);
  assert.equal(signal.group.visible, true);
  signal.update("complete", Infinity, true);
  assert.ok(pose(signal).every(Number.isFinite));
  signal.dispose();
});

test("signal resources are owned and disposal is idempotent", () => {
  const signal = create();
  const resources = new Set();
  let disposals = 0;
  signal.group.traverse(object => {
    if (!(object instanceof Mesh)) return;
    resources.add(object.geometry);
    resources.add(object.material);
  });
  for (const resource of resources) (resource as Mesh["geometry"]).addEventListener("dispose", () => disposals++);
  signal.dispose(); signal.dispose();
  assert.equal(disposals, resources.size);
});
