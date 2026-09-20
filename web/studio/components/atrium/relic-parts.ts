import {
  Box3, BufferAttribute, BufferGeometry, DoubleSide, Group, Material, Matrix4,
  Mesh, Object3D, Quaternion, Vector3,
} from "three";

export type RelicMotionContext = {
  hover?: number;
  busy?: boolean;
  selectedIndex?: number;
  /** Measured values normalized to 0..1. Null means no result, never a fabricated score. */
  values?: readonly (number | null)[];
};

type Body = {
  group: Group;
  center: Vector3;
  restPosition: Vector3;
  restQuaternion: Quaternion;
  restScale: Vector3;
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
  size: Vector3;
};
type Original = {
  object: Object3D; position: Vector3; quaternion: Quaternion; scale: Vector3; visible: boolean;
};
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const finite = (value: number | undefined, fallback = 0) => Number.isFinite(value) ? value! : fallback;
const clamp = (value: number) => Math.max(0, Math.min(1, finite(value)));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const phase = (open: number, start = 0, end = 1) => smooth((open - start) / (end - start));
const nameOf = (object: Object3D) => `${object.name} ${object.userData?.name ?? ""}`.toLowerCase().replace(/_/g, " ");

/** Each relic opens around its existing geometry. No source geometry or shared material is mutated. */
export function createRelicParts(icon: Group, template = "") {
  icon.updateWorldMatrix(true, true);
  const originals: Original[] = icon.children.map(object => ({ object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), visible: object.visible }));
  const inverse = icon.matrixWorld.clone().invert();
  const bounds = (object: Object3D) => {
    const box = new Box3();
    object.traverse(child => {
      if (!(child instanceof Mesh)) return;
      child.geometry.computeBoundingBox();
      if (child.geometry.boundingBox) box.union(child.geometry.boundingBox.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, child.matrixWorld)));
    });
    return box;
  };
  const children = originals.map(entry => entry.object);
  const boxes = children.map(bounds);
  const whole = new Box3();
  boxes.forEach(box => { if (!box.isEmpty()) whole.union(box); });
  const center = whole.isEmpty() ? new Vector3() : whole.getCenter(new Vector3());
  const size = whole.isEmpty() ? new Vector3(1, 1, 1) : whole.getSize(new Vector3());
  const reach = Math.max(size.x, size.y, size.z, .01);
  const bodies: Body[] = [];
  const ownedGeometries: BufferGeometry[] = [];
  const ownedMaterials: Material[] = [];
  const rotations = new Quaternion();
  const targetRotation = new Quaternion();
  let disposed = false;
  let open = 0, velocity = 0, hover = 0;
  let updatePose: (elapsed: number, still: boolean, context: RelicMotionContext) => void;

  function body(group: Group, box: Box3): Body {
    const result = {
      group, center: box.getCenter(new Vector3()), size: box.getSize(new Vector3()),
      restPosition: group.position.clone(), restQuaternion: group.quaternion.clone(), restScale: group.scale.clone(),
      position: group.position.clone(), quaternion: group.quaternion.clone(), scale: group.scale.clone(),
    };
    bodies.push(result);
    return result;
  }
  function bundle(objects: Object3D[], box: Box3, pivot = box.getCenter(new Vector3())) {
    const group = new Group();
    group.name = `Relic motion | ${objects[0]?.name ?? "body"}`;
    group.position.copy(pivot);
    icon.add(group);
    icon.updateWorldMatrix(true, true);
    for (const object of objects) group.attach(object);
    return body(group, box);
  }
  function rotate(part: Body, x = 0, y = 0, z = 0) {
    targetRotation.setFromAxisAngle(X, x);
    rotations.setFromAxisAngle(Y, y);
    targetRotation.multiply(rotations);
    rotations.setFromAxisAngle(Z, z);
    targetRotation.multiply(rotations);
    part.quaternion.copy(part.restQuaternion).multiply(targetRotation);
  }
  function resetTargets() {
    for (const part of bodies) {
      part.position.copy(part.restPosition);
      part.quaternion.copy(part.restQuaternion);
      part.scale.copy(part.restScale);
    }
  }

  const cardIndices = children.map((object, index) => ({ object, index })).filter(({ object }) => /glass card/.test(nameOf(object)));
  const cubeIndices = children.map((object, index) => ({ object, index })).filter(({ object }) => /crystal block/.test(nameOf(object)));
  const walletIndices = children.map((object, index) => ({ object, index })).filter(({ object }) => /ethereum.*crystal/.test(nameOf(object)));
  const sheetIndices = children.map((object, index) => ({ object, index })).filter(({ object }) => /audit.*translucent sheet/.test(nameOf(object)));
  const ringIndices = children.map((object, index) => ({ object, index })).filter(({ object }) => /approvals.*interlocking ring/.test(nameOf(object)));

  if (template === "accounts-payable" && cardIndices.length) {
    // Front-to-back, independent of Blender's export order. Printed lines stay on their own sheet.
    cardIndices.sort((a, b) => boxes[b.index].getCenter(new Vector3()).z - boxes[a.index].getCenter(new Vector3()).z);
    const pages = cardIndices.map(({ object, index }, order) => {
      const riders = children.filter((candidate, candidateIndex) => {
        if (cardIndices.some(entry => entry.object === candidate)) return false;
        const z = boxes[candidateIndex].getCenter(new Vector3()).z;
        const nearest = cardIndices.reduce((best, card, i) => Math.abs(boxes[card.index].getCenter(new Vector3()).z - z) < Math.abs(boxes[cardIndices[best].index].getCenter(new Vector3()).z - z) ? i : best, 0);
        return nearest === order;
      });
      // The spine is the left edge, so a page really turns around a hinge rather than orbiting its center.
      const pivot = boxes[index].getCenter(new Vector3());
      pivot.x = boxes[index].min.x;
      return bundle([object, ...riders], boxes[index], pivot);
    });
    updatePose = (elapsed, still, context) => {
      const selected = Math.abs(Math.trunc(finite(context.selectedIndex))) % pages.length;
      const reveal = phase(open, .06, .91);
      pages.forEach((page, index) => {
        const rank = (index - selected + pages.length) % pages.length;
        const isFront = rank === 0;
        const unfold = phase(open, index * .035, .9 + index * .035);
        const idle = still ? 0 : Math.sin(elapsed * .67 + index * .9) * .007 * (1 - reveal);
        const work = !still && context.busy && isFront ? Math.sin(elapsed * 2.1) * .004 : 0;
        page.position.y += reach * (idle + work + hover * (.017 + index * .012)) * (1 - reveal);
        page.position.z += hover * reach * (pages.length - index) * .025 * (1 - reveal);
        const desiredCenter = isFront
          ? new Vector3(center.x + reach * .12, center.y + reach * .055, center.z + reach * .22)
          : new Vector3(center.x - reach * (.64 + (rank - 1) * .10), center.y + reach * (.10 + (rank - 1) * .14), center.z - reach * (.03 + rank * .035));
        // Compensate the hinge offset to land each page at the intended reading position.
        const turn = Math.sin(Math.PI * unfold);
        const yaw = isFront ? -.045 : .16 + rank * .035;
        rotate(page, (-hover * .025) * (1 - unfold) - .025 * unfold - turn * .085, yaw * unfold - hover * .06 * (1 - unfold) - turn * (isFront ? .32 : .16), (isFront ? 0 : -.045 * rank) * unfold + idle * .35);
        const expansion = 1 + (isFront ? .15 : -.07) * unfold;
        const hingeOffset = page.center.clone().sub(page.restPosition).multiplyScalar(expansion).applyQuaternion(page.quaternion);
        page.position.lerp(desiredCenter.sub(hingeOffset), unfold);
        page.position.y += turn * reach * .065;
        page.scale.multiplyScalar(expansion);
      });
    };
  } else if (template === "audit-evidence" && sheetIndices.length) {
    sheetIndices.sort((a, b) => boxes[b.index].getCenter(new Vector3()).z - boxes[a.index].getCenter(new Vector3()).z);
    const sheets = sheetIndices.map(({ object, index }, order) => {
      const riders = children.filter((candidate, candidateIndex) => {
        if (sheetIndices.some(entry => entry.object === candidate)) return false;
        const z = boxes[candidateIndex].getCenter(new Vector3()).z;
        const nearest = sheetIndices.reduce((best, sheet, i) => Math.abs(boxes[sheet.index].getCenter(new Vector3()).z - z) < Math.abs(boxes[sheetIndices[best].index].getCenter(new Vector3()).z - z) ? i : best, 0);
        return nearest === order;
      });
      return bundle([object, ...riders], boxes[index]);
    });
    updatePose = (elapsed, still, context) => {
      const selected = Math.max(0, Math.trunc(finite(context.selectedIndex))) % sheets.length;
      sheets.forEach((sheet, index) => {
        const rank = (index - selected + sheets.length) % sheets.length;
        const selectedSheet = rank === 0;
        const side = rank === 0 ? 0 : rank % 2 ? -1 : 1;
        const amount = phase(open, index * .045, .88 + index * .045);
        const idle = still ? 0 : Math.sin(elapsed * .56 + index * .85) * .004;
        const processing = !still && context.busy && selectedSheet ? Math.sin(elapsed * 1.9) * .008 : 0;
        sheet.position.y += reach * idle * (1 - amount);
        sheet.position.x += (sheet.center.x - center.x) * hover * .14 * (1 - amount);
        sheet.position.z += reach * hover * (sheets.length - index) * .022 * (1 - amount);
        const target = new Vector3(center.x + side * reach * .29, center.y + (selectedSheet ? .025 : .05) * reach, center.z + reach * (selectedSheet ? .23 : -.055));
        sheet.position.lerp(target, amount);
        sheet.position.y += reach * processing * amount;
        // A dossier opens around its selected evidence, while neighboring sheets remain identifiable.
        rotate(sheet, -.025 * amount, side * -.16 * amount - hover * .035 * (1 - amount), side * -.055 * amount + idle * .2);
        sheet.scale.multiplyScalar(1 + (selectedSheet ? .055 : -.025) * amount);
      });
    };
  } else if (template === "approvals" && ringIndices.length) {
    ringIndices.sort((a, b) => boxes[a.index].getCenter(new Vector3()).x - boxes[b.index].getCenter(new Vector3()).x);
    const rings = ringIndices.map(({ object, index }) => bundle([object], boxes[index]));
    updatePose = (elapsed, still, context) => rings.forEach((ring, index) => {
      const side = index % 2 ? 1 : -1;
      const amount = phase(open, index * .04, .93 + index * .04);
      const idle = still ? 0 : Math.sin(elapsed * .5) * .008;
      const processing = !still && context.busy ? Math.sin(elapsed * 1.8) * .027 : 0;
      const target = new Vector3(center.x + side * reach * .38, center.y + side * reach * .035, center.z + side * reach * .035);
      ring.position.lerp(target, amount);
      ring.position.x += side * reach * hover * .027 * (1 - amount);
      ring.position.y += side * reach * idle * .4;
      rotate(ring, side * .04 * amount, side * (.24 * amount + hover * .055 * (1 - amount) + idle + processing), side * .085 * amount);
    });
  } else if (["crystal-stack", "training-arena", "benchmarks"].includes(template) && cubeIndices.length) {
    cubeIndices.sort((a, b) => {
      const aa = boxes[a.index].getCenter(new Vector3()), bb = boxes[b.index].getCenter(new Vector3());
      return Math.abs(aa.y - bb.y) > .02 ? aa.y - bb.y : aa.x - bb.x;
    });
    const cubes = cubeIndices.map(({ object, index }) => bundle([object], boxes[index]));
    const edge = Math.max(...cubes.map(cube => Math.min(cube.size.x, cube.size.y, cube.size.z)));
    updatePose = (elapsed, still, context) => {
      const unmeasuredTraining = template === "training-arena" && !context.values?.some(value => typeof value === "number" && Number.isFinite(value));
      cubes.forEach((cube, index) => {
        const amount = phase(open, index * .018, .84 + index * .018);
        const supplied = context.values?.[index];
        const known = typeof supplied === "number" && Number.isFinite(supplied);
        const measured = known ? clamp(supplied) : 0;
        if (unmeasuredTraining) {
          // Snapshot positions indicate order only. Equal cube dimensions make no performance claim.
          const offset = index - (cubes.length - 1) / 2;
          const angle = offset * .22;
          const idle = still ? 0 : Math.sin(elapsed * .64 - index * .6) * reach * .005;
          const working = !still && context.busy ? Math.sin(elapsed * 2 - index * .65) * edge * .035 : 0;
          cube.position.y += idle * (1 - amount);
          cube.position.x += (cube.center.x - center.x) * hover * .07 * (1 - amount);
          const target = new Vector3(center.x + offset * edge * 1.04, center.y + Math.cos(angle) * edge * .06 + working, center.z + (1 - Math.cos(angle)) * edge * 1.6);
          cube.position.lerp(target, amount);
          rotate(cube, 0, (-.43 + angle * .32) * amount + hover * .035 * (1 - amount), 0);
          if (context.selectedIndex === index) {
            cube.position.z += amount * edge * .38;
            cube.position.y += amount * edge * .075;
          }
          return;
        }
        // Unknown versions stay as equal neutral cubes. Only actual supplied results produce height.
        const height = edge * (1 + measured * 2.3);
        const lift = !still && context.busy ? Math.sin(elapsed * 2.2 - index * .8) * edge * .045 : 0;
        const idle = still ? 0 : Math.sin(elapsed * .72 - index * .7) * reach * .006;
        cube.position.y += (idle + hover * reach * (.018 + (index % 3) * .006)) * (1 - amount);
        cube.position.x += (cube.center.x - center.x) * hover * .065 * (1 - amount);
        const target = new Vector3(center.x + (index - (cubes.length - 1) / 2) * edge * 1.22, center.y - reach * .36 + height / 2 + lift, center.z + edge * .2);
        cube.position.lerp(target, amount);
        cube.scale.y *= 1 + (height / edge - 1) * amount;
        // Calm front-facing columns remain legible while the room moves behind them.
        rotate(cube, 0, -.34 * amount + hover * .035 * (1 - amount), 0);
        if (context.selectedIndex === index) cube.position.z += amount * edge * .18;
      });
    };
  } else if (template === "wallet-identity" && walletIndices.length) {
    const facets: { part: Body; shell: Body; sign: number; front: boolean }[] = [];
    const shells = walletIndices.map(({ object, index }) => {
      const shellGroup = new Group();
      shellGroup.name = `Wallet motion | ${/upper/.test(nameOf(object)) ? "upper" : "lower"} shell`;
      shellGroup.position.copy(boxes[index].getCenter(new Vector3()));
      icon.add(shellGroup);
      const shell = body(shellGroup, boxes[index]);
      object.visible = false;
      object.traverse(source => {
        if (!(source instanceof Mesh)) return;
        const matrix = new Matrix4().multiplyMatrices(inverse, source.matrixWorld);
        const geometry = source.geometry.index ? source.geometry.toNonIndexed() : source.geometry.clone();
        geometry.applyMatrix4(matrix);
        const position = geometry.getAttribute("position");
        const uv = geometry.getAttribute("uv");
        const polygons = new Map<string, { vertices: number[]; normal: Vector3 }>();
        const a = new Vector3(), b = new Vector3(), c = new Vector3();
        for (let i = 0; i < position.count; i += 3) {
          a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
          const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
          const key = [normal.x, normal.y, normal.z, normal.dot(a)].map(value => value.toFixed(4)).join(":");
          const polygon = polygons.get(key) ?? { vertices: [], normal };
          polygon.vertices.push(i, i + 1, i + 2);
          polygons.set(key, polygon);
        }
        const sourceMaterials = Array.isArray(source.material) ? source.material : [source.material];
        const materials = sourceMaterials.map(material => {
          const clone = material.clone();
          clone.side = DoubleSide;
          clone.onBeforeCompile = material.onBeforeCompile;
          clone.customProgramCacheKey = material.customProgramCacheKey.bind(material);
          ownedMaterials.push(clone);
          return clone;
        });
        let facetIndex = 0;
        for (const polygon of polygons.values()) {
          const points = polygon.vertices.map(vertex => new Vector3().fromBufferAttribute(position, vertex));
          const box = new Box3().setFromPoints(points);
          const middle = box.getCenter(new Vector3());
          const sign = middle.x < center.x ? -1 : 1;
          const front = polygon.normal.z > .18;
          const hinge = middle.clone();
          if (front) hinge.x = sign < 0 ? box.min.x : box.max.x;
          const facetGroup = new Group();
          facetGroup.name = `Wallet motion | ${front ? "opening" : "back"} facet ${facetIndex++}`;
          facetGroup.position.copy(hinge).sub(shell.center);
          shellGroup.add(facetGroup);
          const positions = new Float32Array(points.length * 3);
          points.forEach((point, i) => point.sub(hinge).toArray(positions, i * 3));
          const piece = new BufferGeometry();
          piece.setAttribute("position", new BufferAttribute(positions, 3));
          if (uv) {
            const values = new Float32Array(points.length * 2);
            polygon.vertices.forEach((vertex, i) => { values[i * 2] = uv.getX(vertex); values[i * 2 + 1] = uv.getY(vertex); });
            piece.setAttribute("uv", new BufferAttribute(values, 2));
          }
          piece.computeVertexNormals();
          const mesh = new Mesh(piece, materials[0]);
          mesh.name = `${source.name} | articulated facet`;
          mesh.castShadow = source.castShadow;
          mesh.receiveShadow = source.receiveShadow;
          mesh.frustumCulled = source.frustumCulled;
          facetGroup.add(mesh);
          ownedGeometries.push(piece);
          facets.push({ part: body(facetGroup, box), shell, sign, front });
        }
        geometry.dispose();
      });
      return { shell, sign: /upper/.test(nameOf(object)) ? 1 : -1 };
    });
    updatePose = (elapsed, still, context) => {
      const split = phase(open, .02, .68), unfold = phase(open, .25, .98);
      shells.forEach(({ shell, sign }) => {
        const drift = still ? 0 : Math.sin(elapsed * .48) * .008;
        const busy = !still && context.busy ? Math.sin(elapsed * 1.8) * .012 : 0;
        shell.position.y += sign * reach * (split * .27 + hover * .016 * (1 - split));
        shell.position.z -= split * reach * .055;
        rotate(shell, 0, sign * ((drift + hover * .045 + busy) * (1 - unfold) + .075 * split), 0);
      });
      facets.forEach(({ part, front, sign }) => {
        if (front) rotate(part, 0, sign * 1.05 * unfold, 0);
      });
    };
  } else {
    // Existing stations retain their quiet break-apart behavior.
    const volume = (box: Box3) => { const s = box.getSize(new Vector3()); return Math.max(s.x, .0001) * Math.max(s.y, .0001) * Math.max(s.z, .0001); };
    const largest = Math.max(...boxes.map(volume), 1e-9);
    const indices = children.map((_, index) => index).filter(index => volume(boxes[index]) > largest * .02);
    const grouped = indices.map(index => {
      const riders = children.filter((_, candidate) => !indices.includes(candidate) && indices.reduce((nearest, i) => boxes[i].getCenter(new Vector3()).distanceToSquared(boxes[candidate].getCenter(new Vector3())) < boxes[nearest].getCenter(new Vector3()).distanceToSquared(boxes[candidate].getCenter(new Vector3())) ? i : nearest, indices[0]) === index);
      return bundle([children[index], ...riders], boxes[index]);
    });
    updatePose = (elapsed, still) => grouped.forEach((part, index) => {
      const amount = phase(open, index / Math.max(grouped.length - 1, 1) * .24, 1);
      const direction = part.center.clone().sub(center);
      if (direction.lengthSq() < 1e-8) direction.set((index - (grouped.length - 1) / 2) * .1, 0, .1);
      direction.normalize();
      const breathe = still ? 0 : Math.sin(elapsed * .9 + index * 1.3) * .004;
      part.position.addScaledVector(direction, reach * .2 * amount * (1 + breathe));
      rotate(part, (index % 2 ? 1 : -1) * .16 * amount, (index - (grouped.length - 1) / 2) * .18 * amount, 0);
    });
  }

  return {
    get open() { return open; },
    update(goal: number, dt: number, elapsed: number, still: boolean, context: RelicMotionContext = {}) {
      if (disposed) return;
      goal = clamp(goal);
      dt = Math.min(.1, Math.max(0, finite(dt)));
      elapsed = finite(elapsed);
      if (still) { open = goal; velocity = 0; hover = clamp(context.hover ?? 0); }
      else {
        let remaining = dt;
        while (remaining > 0) {
          const step = Math.min(remaining, 1 / 120);
          velocity += (42 * (goal - open) - 2 * Math.sqrt(42) * velocity) * step;
          open += velocity * step;
          remaining -= step;
        }
        if (Math.abs(open - goal) < 1e-5 && Math.abs(velocity) < 1e-4) { open = goal; velocity = 0; }
        hover += (clamp(context.hover ?? 0) - hover) * (1 - Math.exp(-dt * 14));
      }
      resetTargets();
      updatePose(elapsed, still, context);
      // One damped follow makes page selection and live metric changes interruptible too.
      const follow = still ? 1 : 1 - Math.exp(-dt * 22);
      for (const part of bodies) {
        if (still) {
          part.group.position.copy(part.position);
          part.group.quaternion.copy(part.quaternion);
          part.group.scale.copy(part.scale);
        } else {
          part.group.position.lerp(part.position, follow);
          part.group.quaternion.slerp(part.quaternion, follow);
          part.group.scale.lerp(part.scale, follow);
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Restore exact original local transforms even when disposed midway through an opening.
      for (const original of originals) {
        icon.add(original.object);
        original.object.position.copy(original.position);
        original.object.quaternion.copy(original.quaternion);
        original.object.scale.copy(original.scale);
        original.object.visible = original.visible;
      }
      for (const part of bodies) part.group.removeFromParent();
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      icon.updateWorldMatrix(true, true);
    },
  };
}
