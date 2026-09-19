// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";
import shader1 from "../shaders/particles-1.glsl?raw";
import shader2 from "../shaders/particles-2.glsl?raw";

export default function initialize() {
  "use strict";
  var n = THREE;
  WEBGL.particle = {
    ready: !1,
    mesh: null,
    padding: { x: 1, y: 1 },
    params: {
      speed: 0.5,
      count: 150,
      size: 1.5,
      alpha: 0.2,
      radiusRatio: 1.5,
    },
    attr: {
      scale: [],
      origin: [],
      positions: [],
      sizes: [],
      offset: [],
      vector: [],
      wave: [],
    },
    once() {
      if (!WEBGL.lights.spotLights.length) return !1;
      const t = WEBGL.lights.spotLights[0].light,
        e = t.cylinderCenter,
        i = t.cylinderDirection,
        r = t.volumeRadiusTop * this.params.radiusRatio,
        s = t.volumeRadiusBottom * this.params.radiusRatio,
        a = t.volumeHeight,
        o = new n.ShaderMaterial({
          uniforms: {
            time: { value: 0 },
            alpha: { value: this.params.alpha },
            color: { value: COLOR.table.white.three },
            uv_resolution: {
              value: { x: window.innerWidth, y: window.innerHeight },
            },
            cylinderCenter: { value: e },
            cylinderDirection: { value: i },
            cylinderRadiusTop: { value: r },
            cylinderRadiusBottom: { value: s },
            cylinderHeight: { value: a },
          },
          vertexShader: shader1,
          fragmentShader: shader2,
          depthWrite: !1,
          depthTest: !0,
          transparent: !0,
          alphaTest: 0.5,
          blending: n.NormalBlending,
        });
      o.depthTest = !1;
      let l = this.params.size;
      WW >= 1920
        ? (l = 0.1 * this.params.size)
        : WW >= 1680 && (l = 0.5 * this.params.size);
      const h = new n.BufferGeometry();
      for (let t = 0; t < this.params.count; t++) {
        const t = (2 * Math.random() - 1) * WEBGL.width * 0.7,
          e = (2 * Math.random() - 1) * WEBGL.height * 0.7,
          i = (2 * Math.random() - 1) * WEBGL.screen.params.radius;
        (this.attr.origin.push(t),
          this.attr.origin.push(e),
          this.attr.origin.push(i),
          this.attr.positions.push(t),
          this.attr.positions.push(e),
          this.attr.positions.push(i),
          this.attr.scale.push(0.1 + Math.random()),
          this.attr.vector.push(
            0.5 * (0.5 + Math.random()) * this.params.speed,
          ),
          this.attr.vector.push(
            0.5 * (0.5 + Math.random()) * this.params.speed,
          ),
          this.attr.vector.push(0),
          this.attr.wave.push(Math.random() + 1),
          this.attr.wave.push(0.25 * Math.random()),
          this.attr.sizes.push(l));
      }
      (h.setAttribute(
        "origin",
        new n.Float32BufferAttribute(this.attr.origin, 3),
      ),
        h.setAttribute(
          "position",
          new n.Float32BufferAttribute(this.attr.positions, 3),
        ),
        h.setAttribute(
          "vector",
          new n.Float32BufferAttribute(new Float32Array(this.attr.vector), 3),
        ),
        h.setAttribute(
          "wave",
          new n.Float32BufferAttribute(new Float32Array(this.attr.wave), 2),
        ),
        h.setAttribute(
          "scale",
          new n.Float32BufferAttribute(this.attr.scale, 1),
        ),
        h.setAttribute(
          "size",
          new n.Float32BufferAttribute(this.attr.sizes, 1).setUsage(
            n.DynamicDrawUsage,
          ),
        ),
        (this.mesh = new n.Points(h, o)),
        WEBGL.scene.add(this.mesh),
        this.onResize(),
        (this.ready = !0));
    },
    onResize() {
      ((this.mesh.material.uniforms.uv_resolution.value.x = WW),
        (this.mesh.material.uniforms.uv_resolution.value.y = WH));
      const t = this.mesh.geometry.attributes.size.array;
      for (let e = 0; e < t.length; e++)
        t[e] = WEBGL.width * this.params.size * 0.01;
      this.mesh.geometry.attributes.size.needsUpdate = !0;
    },
    onUpdate() {
      if (this.mesh) {
        const e = this.mesh.geometry.attributes.position.array,
          i = this.attr.vector;
        this.mesh.geometry.attributes.position.needsUpdate = !0;
        for (var t = 0; t < e.length; t += 3)
          ((e[t] += i[t] * RESCALE),
            e[t] < -WEBGL.width / 2 - this.padding.x
              ? (e[t] = WEBGL.width / 2 + 2 * this.padding.x)
              : e[t] > WEBGL.width / 2 + this.padding.x &&
                (e[t] = -WEBGL.width / 2 + 2 * this.padding.x));
        const n = WEBGL.lights.spotLights[0].light,
          r = n.volumeRadiusTop * this.params.radiusRatio,
          s = n.volumeRadiusBottom * this.params.radiusRatio;
        (WEBGL.floor.isUnderWater
          ? ((this.mesh.material.uniforms.cylinderRadiusTop.value = 2 * r),
            (this.mesh.material.uniforms.cylinderRadiusBottom.value = 2 * s))
          : ((this.mesh.material.uniforms.cylinderRadiusTop.value = r),
            (this.mesh.material.uniforms.cylinderRadiusBottom.value = s)),
          (this.mesh.material.uniforms.alpha.value =
            this.params.alpha - COLOR.power.light * this.params.alpha * 0.8));
      }
    },
  };
}
