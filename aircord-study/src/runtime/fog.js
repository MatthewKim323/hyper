// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";
import shader1 from "../shaders/fog-1.glsl?raw";

export default function initialize() {
  "use strict";
  var n = THREE;
  WEBGL.foggy = {
    ready: !1,
    params: {
      width: 4,
      height: 0.75,
      vigPower: 5,
      alphaPower: 4,
      noiseQuality: 7,
      noisePer: 0.49,
      speed: { x: 1, y: 0 },
    },
    once() {
      ((this.geometry = new n.PlaneGeometry(1, 1)),
        (this.material = new n.ShaderMaterial({
          vertexShader: NormalVert,
          fragmentShader: shader1,
          uniforms: {
            time: { value: 0 },
            vigPower: { value: this.params.vigPower },
            alphaPower: { value: this.params.alphaPower },
            speed: { value: this.params.speed },
            resolution: { value: { x: 0, y: 0 } },
            noiseQuality: { value: this.params.noiseQuality },
            noisePer: { value: this.params.noisePer },
            color: { value: COLOR.table.volume.three },
          },
          depthWrite: !1,
          depthTest: !0,
          transparent: !0,
          alphaTest: 0.5,
          blending: n.NormalBlending,
        })),
        (this.screen = new n.Mesh(this.geometry, this.material)),
        WEBGL.scene.add(this.screen),
        (this.ready = !0));
    },
    onChangeGui() {
      ((this.screen.material.uniforms.vigPower.value = this.params.vigPower),
        (this.screen.material.uniforms.noiseQuality.value =
          this.params.noiseQuality),
        (this.screen.material.uniforms.noisePer.value = this.params.noisePer),
        (this.screen.material.uniforms.speed.value.x = this.params.speed.x),
        (this.screen.material.uniforms.speed.value.y = this.params.speed.y),
        (this.screen.material.uniforms.speed.value.x = this.params.speed.x),
        (this.screen.material.uniforms.speed.value.y = this.params.speed.y),
        this.onResize());
    },
    onUpdate() {
      COLOR.power.dark >= 0.1
        ? ((this.screen.visible = !0),
          this.screen.position.y != this.screen.scale.y / 2 + GROUND.y &&
            this.onResize(),
          (this.screen.material.uniforms.alphaPower.value =
            this.params.alphaPower * PAGE_TRANSITION.anim.ptZoomIn),
          (this.screen.material.uniforms.time.value = 0.05 * GLOBAL_TIME))
        : (this.screen.visible = !1);
    },
    onResize() {
      ((this.screen.scale.x = WEBGL.width * this.params.width),
        (this.screen.scale.y = WEBGL.height * this.params.height),
        (this.screen.position.y = this.screen.scale.y / 2 + GROUND.y),
        (this.screen.position.z = 0.05 * -WEBGL.width),
        (this.screen.material.uniforms.resolution.value.x = WEBGL.gloablWidth),
        (this.screen.material.uniforms.resolution.value.y =
          (WEBGL.gloablWidth * this.screen.scale.y) / this.screen.scale.x));
    },
  };
}
