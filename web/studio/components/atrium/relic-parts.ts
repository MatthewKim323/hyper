// Relic break-apart. A relic is already exported as separate meshes (three glass cards, two rings,
// seven blocks), so opening it is a matter of moving those parts, not new geometry. One spring per
// relic drives an "open" amount; each part follows it on its own delay so the stack fans rather than jumps.
import { Box3, Euler, Group, Object3D, Vector3 } from "three";

type Part = { object: Object3D; position: Vector3; rotation: Euler; offset: Vector3; twist: Vector3; delay: number };

// Same critically damped family as the camera, a touch faster so parts land just after it.
const STIFFNESS = 22;
const DAMPING = 2 * Math.sqrt(STIFFNESS);
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

export function createRelicParts(icon: Group) {
  // Group the meshes into bodies: a sheet and the ruling lines printed on it move as one.
  const children = [...icon.children];
  const boxes = children.map(child => new Box3().setFromObject(child));
  const volume = (box: Box3) => { const s = box.getSize(new Vector3()); return Math.max(s.x, 1e-4) * Math.max(s.y, 1e-4) * Math.max(s.z, 1e-4); };
  const largest = Math.max(...boxes.map(volume), 1e-9);
  const bodies = children.map((child, index) => ({ child, box: boxes[index], index })).filter(entry => volume(entry.box) > largest * 0.02);
  if (bodies.length < 2) return { update() {}, get open() { return 0; } };

  const whole = new Box3();
  boxes.forEach(box => whole.union(box));
  const size = whole.getSize(new Vector3());
  const reach = Math.max(size.x, size.y, size.z);
  const center = whole.getCenter(new Vector3());
  // Flat stacks (sheets, cards) fan along their thin axis; everything else bursts from its center.
  const thin = bodies.every(entry => { const s = entry.box.getSize(new Vector3()); return Math.min(s.x, s.y, s.z) < Math.max(s.x, s.y, s.z) * 0.2; });
  const centers = bodies.map(entry => entry.box.getCenter(new Vector3()));
  const spread = new Vector3();
  if (thin) {
    const first = centers[0], last = centers[centers.length - 1];
    spread.copy(last).sub(first);
    if (spread.lengthSq() < 1e-6) spread.set(0, 0, 1);
    spread.normalize();
  }

  icon.updateMatrixWorld(true);
  const origin = icon.getWorldPosition(new Vector3());
  // A world-space direction expressed in the relic's own space (its origin maps to zero).
  const toLocal = (direction: Vector3) => icon.worldToLocal(direction.clone().add(origin));
  const parts: Part[] = [];
  bodies.forEach((body, order) => {
    const middle = (bodies.length - 1) / 2;
    const direction = thin
      ? spread.clone().multiplyScalar((order - middle) * reach * 0.2).add(new Vector3(0, (order - middle) * reach * 0.06, 0))
      : centers[order].clone().sub(center).normalize().multiplyScalar(reach * 0.2);
    if (!Number.isFinite(direction.x)) direction.set(0, 0, 0);
    const offset = toLocal(direction);
    const twist = thin ? new Vector3(0, (order - middle) * 0.22, (order - middle) * 0.06) : new Vector3((order % 2 ? 1 : -1) * 0.22, (order - middle) * 0.2, 0);
    const delay = (order / Math.max(bodies.length - 1, 1)) * 0.28;
    // Small meshes ride with the body they sit on.
    const riders = children.filter((child, index) => !bodies.some(entry => entry.child === child) && boxes[index].getCenter(new Vector3()).distanceTo(centers[order]) === Math.min(...centers.map(c => boxes[index].getCenter(new Vector3()).distanceTo(c))));
    for (const object of [body.child, ...riders]) parts.push({ object, position: object.position.clone(), rotation: object.rotation.clone(), offset, twist, delay });
  });

  let open = 0;
  let velocity = 0;
  return {
    get open() { return open; },
    /** `goal` 1 is fully apart. `breathe` adds a slow drift so an open relic never looks frozen. */
    update(goal: number, dt: number, elapsed: number, still: boolean) {
      if (still) { open = goal; velocity = 0; }
      else {
        let remaining = Math.min(dt, 0.1);
        while (remaining > 0) {
          const step = Math.min(remaining, 1 / 120);
          velocity += (STIFFNESS * (goal - open) - DAMPING * velocity) * step;
          open += velocity * step;
          remaining -= step;
        }
      }
      if (open < 1e-4 && goal === 0) open = 0;
      parts.forEach((part, index) => {
        const amount = smooth((open - part.delay) / (1 - part.delay));
        const breathe = still ? 0 : Math.sin(elapsed * 0.9 + index * 1.3) * 0.012 * amount;
        part.object.position.copy(part.position).addScaledVector(part.offset, amount * (1 + breathe * 4));
        part.object.rotation.set(part.rotation.x + part.twist.x * amount, part.rotation.y + part.twist.y * amount, part.rotation.z + part.twist.z * amount);
      });
    },
  };
}
