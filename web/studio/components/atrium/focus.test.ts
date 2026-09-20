import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { Box3, Mesh, PerspectiveCamera, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import manifest from "../../public/assets/hyper-atrium/scene.json";
import { DEFAULT_STATIONS } from "./configuration";
import { createFocusRig, type FocusSubject } from "./focus";
import { layoutAtriumStations } from "./layout";

const aspect = manifest.width / manifest.height;
const home = new Vector3(manifest.camera.position[0], manifest.camera.position[2], -manifest.camera.position[1]);
const homeTarget = new Vector3(manifest.camera.target[0], manifest.camera.target[2], -manifest.camera.target[1]);
const fov = 2 * Math.atan(manifest.camera.sensorWidth / aspect / (2 * manifest.camera.lens)) * 180 / Math.PI;
const quiet = { x: 0, y: 0 };
const near = (actual: number, expected: number, tolerance: number, note: string) => assert.ok(Math.abs(actual - expected) < tolerance, `${note}: ${actual} differs from ${expected}`);

function rig() {
  const camera = new PerspectiveCamera(fov, aspect, .1, 250);
  return { camera, motion: createFocusRig(camera, home, homeTarget) };
}

async function relic(id: string) {
  const placement = layoutAtriumStations(DEFAULT_STATIONS).find(item => item.station.id === id)!;
  assert.ok(placement, `${id} must be a real default station`);
  const template = manifest.templates.find(item => item.id === placement.station.template)!;
  const bytes = await readFile(new URL(`../../public${template.url}`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  gltf.scene.position.set(placement.x, 0, -placement.y);
  gltf.scene.scale.multiplyScalar(placement.scale);
  gltf.scene.updateMatrixWorld(true);
  const box = new Box3();
  gltf.scene.traverse(object => {
    const name = `${object.name} ${object.userData.name ?? ""}`.replaceAll("_", " ");
    if (object instanceof Mesh && !/plinth|light seam|title|enter/.test(name)) box.union(new Box3().setFromObject(object));
  });
  assert.ok(!box.isEmpty(), `${id} must have a physical relic`);
  return { center: box.getCenter(new Vector3()), size: box.getSize(new Vector3()) };
}

const subjects = Promise.all(["accounts-payable", "wallet-identity", "benchmarks"].map(relic));

// This projects into the visible viewport, including the horizontal crop of the wider atrium canvas.
function onScreen(center: Vector3, camera: PerspectiveCamera, width: number, height: number) {
  const frameWidth = Math.max(width, height * aspect);
  const projected = center.clone().project(camera);
  const frameHeight = frameWidth / aspect;
  return { x: (.5 + projected.x / 2) * frameWidth / width - (frameWidth - width) / (2 * width), y: (1 - projected.y) / 2 * frameHeight / height - (frameHeight - height) / (2 * height) };
}

function subject(index: number, shape: Awaited<ReturnType<typeof relic>>, compact: boolean, visibleHeightShare = 1): FocusSubject {
  return {
    center: shape.center, height: shape.size.y, width: shape.size.x * (index === 2 ? 2.25 : 1.5),
    fill: compact ? .14 : index === 2 ? .18 : .34,
    x: compact || index === 2 ? 0 : index === 1 ? -.52 : -.61,
    y: (compact ? .74 : index === 2 ? .56 : .08) * visibleHeightShare,
    orbit: index === 2 ? .12 : index === 1 ? -.04 : .035,
  };
}

describe("relic camera composition", () => {
  test("shipped AP, wallet and benchmark geometry lands beside the desktop reading area", async () => {
    const shapes = await subjects;
    for (const [width, height] of [[1440, 900], [1024, 768], [1920, 720]]) {
      for (const [index, shape] of shapes.entries()) {
        const { camera, motion } = rig();
        motion.aim(subject(index, shape, false, Math.min(1, height / (width / aspect))), Math.min(1, width / (height * aspect)));
        motion.update(0, quiet, true);
        const point = onScreen(shape.center, camera, width, height);
        near(point.x, [.195, .24, .5][index], .012, `relic ${index} horizontal reading composition`);
        near(point.y, index === 2 ? .22 : .46, .015, `relic ${index} vertical reading composition`);
        assert.ok(shape.center.clone().project(camera).z < 1, "the subject remains in the camera frustum");
      }
    }
  });

  test("portrait and small landscape keep each relic centered above the interface", async () => {
    const shapes = await subjects;
    for (const [width, height] of [[390, 844], [844, 390]]) {
      for (const [index, shape] of shapes.entries()) {
        const { camera, motion } = rig();
        motion.aim(subject(index, shape, true, Math.min(1, height / (width / aspect))), Math.min(1, width / (height * aspect)));
        motion.update(0, quiet, true);
        const point = onScreen(shape.center, camera, width, height);
        near(point.x, .5, .012, "portrait center survives horizontal cropping");
        near(point.y, .13, .015, "relic leaves the lower viewport for its reading surface");
      }
    }
  });

  test("re-aiming an open relic for a new viewport moves it into the new composition", async () => {
    const shape = (await subjects)[0];
    const { camera, motion } = rig();
    motion.aim(subject(0, shape, false), 1);
    motion.update(0, quiet, true);
    motion.aim(subject(0, shape, true), 390 / (844 * aspect));
    for (let frame = 0; frame < 720; frame++) motion.update(1 / 60, quiet, false);
    const point = onScreen(shape.center, camera, 390, 844);
    near(point.x, .5, .012, "resized AP center");
    near(point.y, .13, .015, "resized AP top position");
  });

  test("switching subjects and closing mid-flight stays continuous and returns home", async () => {
    const shapes = await subjects;
    const { camera, motion } = rig();
    motion.update(0, quiet, true);
    const homeQuaternion = camera.quaternion.clone();
    for (const index of [0, 2, 1, 0]) {
      const before = camera.position.clone();
      motion.aim(subject(index, shapes[index], false), .8);
      assert.deepEqual(camera.position.toArray(), before.toArray(), "a new destination cannot teleport the camera");
      for (const dt of [1 / 60, 1 / 30, .25, 1 / 120]) {
        motion.update(dt, quiet, false);
        assert.ok([...camera.position.toArray(), ...camera.quaternion.toArray()].every(Number.isFinite));
        assert.ok(motion.progress >= 0 && motion.progress <= 1);
      }
    }
    motion.aim(null);
    for (let frame = 0; frame < 720; frame++) motion.update(1 / 60, quiet, false);
    assert.ok(camera.position.distanceTo(home) < 1e-8, "closing returns to the authored home camera");
    assert.ok(Math.abs(camera.quaternion.dot(homeQuaternion)) > 1 - 1e-10, "closing restores the authored viewing direction");
    assert.equal(motion.focused, false);
    assert.equal(motion.progress, 0);
  });

  test("reduced motion snaps and clears momentum without pointer drift", async () => {
    const shape = (await subjects)[1];
    const { camera, motion } = rig();
    motion.aim(subject(1, shape, false));
    motion.update(1 / 60, quiet, false);
    motion.update(0, { x: 1, y: -1 }, true);
    assert.equal(motion.progress, 1);
    const stillPosition = camera.position.clone();
    motion.update(10, { x: -1, y: 1 }, true);
    assert.deepEqual(camera.position.toArray(), stillPosition.toArray(), "a stationary reading view ignores pointer parallax");
    motion.aim(null);
    motion.update(0, quiet, true);
    assert.deepEqual(camera.position.toArray(), home.toArray());
    assert.equal(motion.progress, 0);
    motion.update(1 / 60, quiet, false);
    assert.deepEqual(camera.position.toArray(), home.toArray(), "resuming does not resurrect interrupted camera momentum");
  });
});
