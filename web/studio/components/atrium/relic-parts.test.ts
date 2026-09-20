import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { Box3, Group, Mesh, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createRelicParts } from "./relic-parts";

async function fixture(template: string) {
  const bytes = await readFile(new URL(`../../public/assets/hyper-atrium/crystal-${template}.glb`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  const meshes: Mesh[] = [];
  gltf.scene.traverse(object => { if (object instanceof Mesh && !/plinth|light.seam|title|enter/i.test(object.name)) meshes.push(object); });
  const icon = new Group();
  gltf.scene.updateMatrixWorld(true);
  const box = new Box3();
  meshes.forEach(mesh => box.union(new Box3().setFromObject(mesh)));
  icon.position.copy(box.getCenter(new Vector3()));
  gltf.scene.add(icon);
  gltf.scene.updateMatrixWorld(true);
  meshes.forEach(mesh => icon.attach(mesh));
  return { icon, originals: [...icon.children], scene: gltf.scene };
}
const point = (object: Object3D) => { object.updateWorldMatrix(true, true); return new Box3().setFromObject(object).getCenter(new Vector3()); };
const close = (actual: number, expected: number, epsilon = 1e-5) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should be near ${expected}`);
const pose = (object: Object3D) => [...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()];

describe("bespoke relic motion on the shipped Blender geometry", () => {
  test("AP opens into a reading sheet and queue; ruling travels rigidly with the front page", async () => {
    const { icon, originals } = await fixture("accounts-payable");
    const card = originals.find(object => /glass_card_1|glass card 1/.test(object.name))!;
    const line = originals.find(object => /document_line_0|document line 0/.test(object.name))!;
    assert.ok(card && line);
    const before = originals.map(pose);
    const motion = createRelicParts(icon, "accounts-payable");
    assert.equal(card.parent, line.parent, "ruling must belong to the same physical page");
    motion.update(1, 0, 3, true);
    const front = point(card);
    const other = originals.filter(object => /glass.card/.test(object.name) && object !== card).map(point);
    assert.ok(other.every(center => center.x < front.x - .5), "other pages become a queue left of the viewer");
    const localLine = line.position.clone();
    motion.update(.4, 0, 5, true, { selectedIndex: 1 });
    assert.deepEqual(line.position.toArray(), localLine.toArray(), "the ruling never slides independently");
    motion.update(0, 0, 300, true);
    motion.dispose();
    assert.deepEqual(icon.children, originals);
    originals.forEach((object, index) => assert.deepEqual(pose(object), before[index]));
  });

  test("the default crystal-stack benchmark relic has seven measured columns and leaves missing results neutral", async () => {
    const { icon } = await fixture("crystal-stack");
    const motion = createRelicParts(icon, "crystal-stack");
    motion.update(1, 0, 0, true, { values: [0, .5, 1, null, NaN, null, null] });
    const groups = icon.children.filter(object => object.name.startsWith("Relic motion"));
    assert.equal(groups.length, 7);
    close(groups[0].scale.y, 1);
    close(groups[1].scale.y, 2.15);
    close(groups[2].scale.y, 3.3);
    for (const group of groups.slice(3)) close(group.scale.y, 1);
    const bases = groups.slice(0, 3).map(group => new Box3().setFromObject(group).min.y);
    close(bases[0], bases[1]); close(bases[1], bases[2]);
    motion.update(1, 0, 0, true, { values: [.25, .75], selectedIndex: 1 });
    close(groups[0].scale.y, 1.575);
    close(groups[1].scale.y, 2.725);
    for (const group of groups.slice(2)) close(group.scale.y, 1);
    assert.ok(groups[1].position.z > groups[0].position.z, "selectedIndex is relative to the current seven-version page");
    motion.update(1, 0, 0, true, { values: [.25, .75], selectedIndex: -1 });
    close(groups[1].position.z, groups[0].position.z);
    motion.update(0, 0, 0, true);
    groups.forEach(group => close(group.scale.y, 1));
    motion.dispose();
  });

  test("Audit opens its actual three sheets around the selected evidence and carries printed ruling", async () => {
    const { icon, originals } = await fixture("audit-evidence");
    const sheets = originals.filter(object => /translucent.sheet/.test(object.name));
    const ruling = originals.find(object => /document.ruling.0/.test(object.name))!;
    const printedSheet = sheets.find(object => /sheet.3/.test(object.name))!;
    assert.equal(sheets.length, 3);
    assert.ok(ruling && printedSheet);
    const before = originals.map(pose);
    const motion = createRelicParts(icon, "audit-evidence");
    assert.equal(ruling.parent, printedSheet.parent);
    const rulingLocal = ruling.position.toArray();
    motion.update(1, 0, 0, true, { selectedIndex: 0 });
    assert.ok(sheets.filter(sheet => sheet !== printedSheet).every(sheet => point(sheet).z < point(printedSheet).z - .2));
    const selectedNext = sheets.find(object => /sheet.2/.test(object.name))!;
    motion.update(1, 0, 0, true, { selectedIndex: 1 });
    assert.ok(sheets.filter(sheet => sheet !== selectedNext).every(sheet => point(sheet).z < point(selectedNext).z - .2));
    assert.deepEqual(ruling.position.toArray(), rulingLocal);
    assert.equal(ruling.parent, printedSheet.parent, "selecting other evidence cannot detach original printing");
    motion.dispose();
    assert.deepEqual(icon.children, originals);
    originals.forEach((object, index) => assert.deepEqual(pose(object), before[index]));
  });

  test("Approvals separates the actual pair of rings with opposite rotations and closes to their original link", async () => {
    const { icon, originals } = await fixture("approvals");
    assert.equal(originals.length, 2);
    const initialGap = Math.abs(point(originals[1]).x - point(originals[0]).x);
    const before = originals.map(pose);
    const motion = createRelicParts(icon, "approvals");
    motion.update(1, 0, 0, true);
    const rings = icon.children.filter(object => object.name.startsWith("Relic motion"));
    assert.equal(rings.length, 2);
    assert.ok(rings[0].quaternion.y * rings[1].quaternion.y < 0, "the rings turn in opposite directions");
    assert.ok(Math.abs(point(originals[1]).x - point(originals[0]).x) > initialGap * 1.3);
    motion.update(0, 0, 0, true);
    close(Math.abs(point(originals[1]).x - point(originals[0]).x), initialGap);
    motion.dispose();
    originals.forEach((object, index) => assert.deepEqual(pose(object), before[index]));
  });

  test("Training's actual seven cubes form a neutral ordered snapshot arc without fabricated heights", async () => {
    const { icon } = await fixture("training-arena");
    const motion = createRelicParts(icon, "training-arena");
    motion.update(1, 0, 0, true, { values: [], selectedIndex: 3 });
    const cubes = icon.children.filter(object => object.name.startsWith("Relic motion"));
    assert.equal(cubes.length, 7);
    cubes.forEach(cube => assert.deepEqual(cube.scale.toArray(), [1, 1, 1]));
    assert.ok(cubes.every((cube, index) => index === 0 || cube.position.x > cubes[index - 1].position.x), "snapshot order is stable");
    assert.ok(cubes[3].position.z > cubes[0].position.z, "the selected snapshot moves toward the viewer");
    motion.update(1, 0, 0, true, { values: [null, null], selectedIndex: -1 });
    assert.ok(cubes[0].position.z > cubes[3].position.z, "the unselected arc curves away at both ends");
    cubes.forEach(cube => close(cube.scale.y, 1));
    motion.update(1, 0, 0, true, { values: [0, .5, 1] });
    close(cubes[0].scale.y, 1); close(cubes[1].scale.y, 2.15); close(cubes[2].scale.y, 3.3);
    motion.dispose();
  });

  test("right-side openings reverse safely and never dispose borrowed geometry or materials", async () => {
    for (const template of ["audit-evidence", "training-arena", "approvals"]) {
      const { icon, originals } = await fixture(template);
      const before = originals.map(pose);
      let borrowedDisposals = 0;
      originals.forEach(object => {
        const mesh = object as Mesh;
        mesh.geometry.addEventListener("dispose", () => borrowedDisposals++);
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.addEventListener("dispose", () => borrowedDisposals++));
      });
      const motion = createRelicParts(icon, template);
      for (let frame = 0; frame < 25; frame++) motion.update(1, 1 / 60, frame / 60, false, { hover: 1, busy: true, selectedIndex: 1 });
      const interrupted = icon.children.map(pose);
      motion.update(0, 0, .5, false);
      assert.deepEqual(icon.children.map(pose), interrupted);
      for (let frame = 0; frame < 240; frame++) motion.update(0, 1 / 60, frame / 60, false);
      close(motion.open, 0);
      assert.ok(icon.children.flatMap(pose).every(Number.isFinite));
      motion.dispose(); motion.dispose();
      assert.equal(borrowedDisposals, 0);
      assert.deepEqual(icon.children, originals);
      originals.forEach((object, index) => assert.deepEqual(pose(object), before[index]));
    }
  });

  test("wallet articulates original crystal facets and restores shared assets on disposal", async () => {
    const { icon, originals } = await fixture("wallet-identity");
    const meshes = originals as Mesh[];
    const sourceGeometry = meshes.map(mesh => mesh.geometry);
    const sourceMaterials = meshes.map(mesh => mesh.material);
    const before = meshes.map(pose);
    let sourceDisposals = 0;
    sourceGeometry.forEach(geometry => geometry.addEventListener("dispose", () => { sourceDisposals++; }));
    const motion = createRelicParts(icon, "wallet-identity");
    const facets: Object3D[] = [];
    let ownedDisposals = 0;
    icon.traverse(object => {
      if (object.name.startsWith("Wallet motion | opening facet")) facets.push(object);
      if (object instanceof Mesh && object.name.endsWith("articulated facet")) object.geometry.addEventListener("dispose", () => { ownedDisposals++; });
    });
    assert.ok(facets.length >= 4, "upper and lower front faces must open independently");
    assert.ok(meshes.every(mesh => !mesh.visible));
    motion.update(1, 0, 0, true);
    assert.ok(facets.every(facet => Math.abs(facet.quaternion.y) > .4));
    const shells = icon.children.filter(object => object.name.startsWith("Wallet motion"));
    assert.equal(shells.length, 2);
    const upper = shells.find(shell => shell.name.includes("upper"))!;
    const lower = shells.find(shell => shell.name.includes("lower"))!;
    assert.ok(upper.position.y - lower.position.y > 1.7);
    motion.dispose();
    const count = ownedDisposals;
    motion.dispose();
    assert.ok(count >= 12, "new facet geometry is released");
    assert.equal(ownedDisposals, count, "disposal is idempotent");
    assert.equal(sourceDisposals, 0, "cached GLB geometry stays owned by its loader");
    assert.deepEqual(icon.children, originals);
    meshes.forEach((mesh, index) => {
      assert.equal(mesh.geometry, sourceGeometry[index]);
      assert.equal(mesh.material, sourceMaterials[index]);
      assert.equal(mesh.visible, true);
      assert.deepEqual(pose(mesh), before[index]);
    });
  });

  test("openings reverse in flight, cap long frames, and ignore malformed clocks", async () => {
    const { icon } = await fixture("accounts-payable");
    const motion = createRelicParts(icon, "accounts-payable");
    for (let frame = 0; frame < 20; frame++) motion.update(1, 1 / 60, frame / 60, false, { hover: 1 });
    assert.ok(motion.open > .3 && motion.open < 1);
    const before = icon.children.map(pose);
    motion.update(0, 0, 0, false);
    assert.deepEqual(icon.children.map(pose), before, "zero elapsed time cannot teleport the relic");
    for (let frame = 0; frame < 240; frame++) motion.update(0, 1 / 60, frame / 60, false);
    close(motion.open, 0);
    motion.update(1, 1000, Infinity, false, { hover: NaN, selectedIndex: Infinity });
    assert.ok(motion.open < .5, "a resumed tab advances at most 100 ms");
    motion.update(NaN, NaN, NaN, false);
    assert.ok(icon.children.flatMap(pose).every(Number.isFinite));
    motion.dispose();
  });

  test("reduced motion has identical static poses regardless of elapsed time or busy state", async () => {
    for (const template of ["accounts-payable", "crystal-stack", "training-arena", "wallet-identity", "audit-evidence", "approvals"]) {
      const { icon } = await fixture(template);
      const motion = createRelicParts(icon, template);
      motion.update(1, 1, 1, true, { hover: .5, busy: true });
      const before = icon.children.map(pose);
      motion.update(1, 1, 200, true, { hover: .5, busy: true });
      assert.deepEqual(icon.children.map(pose), before);
      motion.dispose();
    }
  });
});
