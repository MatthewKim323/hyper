import { AdditiveBlending, Group, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
import type { RelicActivityStatus } from "./relic-activity";

const fragmentShader = `
  varying vec2 vUv;
  uniform float uOpacity;
  void main() {
    vec2 p = vUv * 2. - 1.;
    float radius = length(p);
    float light = exp(-5.5 * dot(p, p)) * (1. - smoothstep(.65, 1., radius));
    gl_FragColor = vec4(vec3(3.5, 3., 2.6), light * uOpacity);
  }
`;

/** Soft light belongs to the relic itself. Only a needed decision calls for attention. */
export function createRelicSignal(center: Vector3, size: Vector3, floorY: number) {
  const group = new Group();
  group.name = "Relic attention radiance";
  const extent = Math.max(size.x, size.y, size.z);
  const geometry = new PlaneGeometry(1, 1);
  const material = (billboard: boolean) => new ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    transparent: true, depthTest: true, depthWrite: false, blending: AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        ${billboard ? `
          vec4 center = modelViewMatrix * vec4(0., 0., 0., 1.);
          vec2 extent = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
          center.xy += position.xy * extent;
          gl_Position = projectionMatrix * center;
        ` : "gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);"}
      }
    `,
    fragmentShader,
  });
  const aura = new Mesh(geometry, material(true));
  aura.name = "Soft pearl radiance";
  aura.position.copy(center);
  aura.frustumCulled = false;
  const spill = new Mesh(geometry, material(false));
  spill.name = "Reflected pearl light";
  spill.position.set(center.x, floorY, center.z);
  spill.rotation.x = -Math.PI / 2;
  group.add(aura, spill);
  // Shared with the object's surface shader so the glow and material breathe together.
  const intensity = { value: 0 };
  let weight = 0;
  let clock = 0;
  let last: RelicActivityStatus = "idle";
  let disposed = false;
  group.visible = false;

  return {
    group, intensity,
    follow(position: Vector3) { aura.position.copy(position); },
    update(status: RelicActivityStatus, delta: number, still: boolean, focused = false) {
      if (disposed) return;
      const dt = Number.isFinite(delta) ? Math.max(0, Math.min(.1, delta)) : 0;
      if (status !== last) { clock = 0; last = status; }
      if (!still) clock += dt;
      const needsYou = status === "attention" || status === "error";
      const target = needsYou ? 1 : 0;
      weight = still ? target : weight + (target - weight) * (1 - Math.exp(-dt * 9));
      group.visible = weight > .005;
      // A slow, continuous breath spreads light outward, with no orbit or hard outline.
      const breath = still ? .5 : .5 - .5 * Math.cos(clock * Math.PI * 2 / 2.8);
      const radiance = weight * (.24 + .76 * breath) * (focused ? .28 : 1);
      intensity.value = radiance;
      aura.scale.setScalar(extent * (2.3 + breath * .6));
      aura.material.uniforms.uOpacity.value = radiance * .72;
      spill.scale.setScalar(extent * (1.5 + breath * .45));
      spill.material.uniforms.uOpacity.value = radiance * .2;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      geometry.dispose(); aura.material.dispose(); spill.material.dispose();
    },
  };
}
