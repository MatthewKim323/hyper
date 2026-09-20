import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, TorusGeometry, Vector3 } from "three";
import type { RelicActivityStatus } from "./relic-activity";

// Deliberately readable against the pale stone. A colored core carries the state;
// bright edges are decoration, never the only indication that work is happening.
const COLORS: Record<RelicActivityStatus, number> = {
  idle: 0x8f827e, working: 0x5633a0, waiting: 0x93611c,
  attention: 0xad5110, complete: 0x157d64, error: 0xaf293f,
};

/** Six inexpensive meshes per active station, no new lights or render passes. */
export function createRelicSignal(center: Vector3, size: Vector3, floorY: number) {
  const group = new Group();
  group.name = "Live relic activity";
  const halo = new Group();
  halo.position.copy(center);
  group.add(halo);
  const radius = Math.max(size.x, size.y, size.z) * .68;
  const arcGeometry = new TorusGeometry(radius, radius * .023, 6, 64, Math.PI * 1.45);
  const dotGeometry = new SphereGeometry(radius * .043, 10, 8);
  const floorGeometry = new RingGeometry(.92, 1, 80);
  const materials: MeshBasicMaterial[] = [];
  const material = (opacity = 1) => {
    const value = new MeshBasicMaterial({ color: COLORS.working, transparent: true, opacity, depthWrite: false, side: DoubleSide });
    materials.push(value);
    return value;
  };
  const outer = new Mesh(arcGeometry, material());
  const inner = new Mesh(arcGeometry, material(.7));
  inner.scale.setScalar(.86);
  const first = new Mesh(dotGeometry, material());
  const second = new Mesh(dotGeometry, material(.8));
  outer.add(first); first.position.x = radius;
  inner.add(second); second.position.x = radius;
  halo.add(outer, inner);
  const ripples = [0, 1].map(() => {
    const mesh = new Mesh(floorGeometry, material(.5));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(center.x, floorY, center.z);
    group.add(mesh);
    return mesh;
  });
  let weight = 0;
  let clock = 0;
  let last: RelicActivityStatus = "idle";
  const color = new Color(COLORS.idle).convertSRGBToLinear();
  const targetColor = new Color();
  let disposed = false;
  group.visible = false;

  return {
    group,
    update(status: RelicActivityStatus, delta: number, still: boolean, focused = false) {
      if (disposed) return;
      const dt = Number.isFinite(delta) ? Math.max(0, Math.min(.1, delta)) : 0;
      const target = status === "idle" ? 0 : 1;
      if (status !== last) { clock = 0; last = status; }
      if (!still) clock += dt;
      weight = still ? target : weight + (target - weight) * (1 - Math.exp(-dt * 9));
      group.visible = weight > .005;
      targetColor.set(COLORS[status]).convertSRGBToLinear();
      color.lerp(targetColor, still ? 1 : 1 - Math.exp(-dt * 9));
      materials.forEach(entry => entry.color.copy(color));
      const working = status === "working";
      const attention = status === "attention" || status === "error";
      const time = still ? 0 : clock;
      // Counter-rotating planes read as a process from the room's wide camera.
      // Waiting has a calm halo, while an owner's decision has paired, upright arcs.
      outer.rotation.set(attention ? .08 : .68, .2, time * (working ? .95 : .18));
      inner.rotation.set(attention ? -.12 : -.55, -.25, -time * (working ? 1.15 : .15) + Math.PI);
      const breath = still ? 0 : Math.sin(time * (attention ? 2.1 : 1.3));
      halo.scale.setScalar(1 + (attention ? .055 : .025) * breath);
      const opacity = weight * (focused ? .55 : 1);
      outer.material.opacity = opacity;
      inner.material.opacity = opacity * .8;
      first.material.opacity = opacity;
      second.material.opacity = opacity * .85;
      ripples.forEach((ripple, index) => {
        const cycle = still ? .35 + index * .35 : (time * (working ? .38 : .22) + index * .5) % 1;
        const expansion = status === "complete" ? 1 + cycle * .9 : 1 + cycle * .4;
        ripple.scale.setScalar(radius * 1.05 * expansion);
        ripple.material.opacity = opacity * (still ? .22 : Math.sin(cycle * Math.PI) * .4);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      arcGeometry.dispose(); dotGeometry.dispose(); floorGeometry.dispose();
      materials.forEach(entry => entry.dispose());
    },
  };
}
