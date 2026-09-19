// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";
import shader1 from "../shaders/logo-1.glsl?raw";
import shader2 from "../shaders/logo-2.glsl?raw";
import shader3 from "../shaders/logo-3.glsl?raw";
import shader4 from "../shaders/logo-4.glsl?raw";

export default function initialize() {
  "use strict";
  var n = THREE;
  WEBGL.logo = {
    ready: !1,
    visible: !0,
    geometry: null,
    material: { front: null, side: null },
    mesh: null,
    boundingBox: null,
    params: {
      scale: 0.32,
      front: {
        mousePower: 0,
        cnoiseDisp: 0.1,
        cnoisePower: 2,
        opacity: 1,
      },
      side: {
        cnoiseDisp: 0.8,
        cnoisePower: 2,
        colorPower: 2.5,
        opacity: 1,
      },
      translate: { x: 0, y: 1 },
      scroll: { opacity: 0.75, scale: 0.2 },
    },
    setForDevice() {
      (WW <= MOBILE_WIDTH
        ? ((this.params.translate.y = 2.5), (this.params.scale = 0.225))
        : WW <= TABLET_WIDTH &&
          !IS_LANDSCAPE &&
          ((this.params.translate.y = 2.5), (this.params.scale = 0.3)),
        DETECT.device.any &&
          ((this.params.scroll.opacity = 1), (this.params.scroll.scale = 0.4)));
    },
    once() {
      (this.setForDevice(),
        (this.stage = new n.Group()),
        this.onInitLogo(),
        this.onResize(),
        (this.ready = !0));
    },
    onInitLogo() {
      ((this.geometry = new TextGeometry("ai1co2d", {
        font: LOADER.fonts.logo.json,
        size: 2,
        height: 1,
        curveSegments: 1,
        bevelEnabled: !1,
        bevelThickness: 0,
        bevelSize: 0,
        bevelOffset: 0,
        bevelSegments: 0,
      })),
        this.geometry.computeBoundingBox());
      const t = new n.Vector3();
      (t
        .subVectors(
          this.geometry.boundingBox.max,
          this.geometry.boundingBox.min,
        )
        .multiplyScalar(-0.5),
        this.geometry.translate(t.x, 0, t.z),
        (this.material.front = new n.ShaderMaterial({
          transparent: !0,
          uniforms: {
            opacity: { value: 1 },
            alpha: { value: 1 },
            time: { value: 1 },
            mouse: { value: { x: 0, y: 0 } },
            tColor: { value: COLOR.table.logo.three },
            cnoiseDisp: { value: this.params.front.cnoiseDisp },
            cnoisePower: { value: this.params.front.cnoisePower },
            mousePower: { value: this.params.front.mousePower },
          },
          vertexShader: shader1,
          fragmentShader: shader2,
        })),
        (this.material.side = new n.ShaderMaterial({
          side: n.DoubleSide,
          transparent: !0,
          depthTest: !1,
          uniforms: {
            opacity: { value: 1 },
            alpha: { value: 1 },
            time: { value: 1 },
            mouse: { value: { x: 0, y: 0 } },
            tColor: { value: COLOR.table.logo.three },
            cnoiseDisp: { value: this.params.side.cnoiseDisp },
            cnoisePower: { value: this.params.side.cnoisePower },
            colorPower: { value: this.params.side.colorPower },
          },
          vertexShader: shader3,
          fragmentShader: shader4,
        })),
        (this.mesh = new n.Mesh(this.geometry, [
          this.material.front,
          this.material.side,
        ])),
        (this.mesh.origin = {
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 0, y: 0, z: 0 },
        }),
        this.stage.add(this.mesh),
        WEBGL.scene.add(this.stage));
    },
    onResize() {
      (this.geometry.computeBoundingBox(),
        (this.mesh.origin.scale.x = 0.1 * WEBGL.width * this.params.scale),
        (this.mesh.origin.scale.y = 0.1 * WEBGL.width * this.params.scale),
        (this.mesh.origin.scale.z = 0.3 * WEBGL.width * this.params.scale),
        (this.mesh.scale.x = this.mesh.origin.scale.x),
        (this.mesh.scale.y = this.mesh.origin.scale.y),
        (this.mesh.scale.z = this.mesh.origin.scale.z));
    },
    onUpdate() {
      if ((this.onUpdateForTransition(), !this.stage.visible)) return !1;
      this.mesh &&
        (this.material.front.uniforms &&
          (DETECT.device.any ||
            ((this.material.front.uniforms.mouse.value.x =
              -MOUSE.body.array[1].shader.x),
            (this.material.front.uniforms.mouse.value.y =
              -MOUSE.body.array[1].shader.y)),
          (this.material.front.uniforms.time.value = 0.005 * GLOBAL_TIME)),
        this.material.side.uniforms &&
          ((this.material.side.uniforms.time.value = 0.005 * GLOBAL_TIME),
          (this.material.side.uniforms.colorPower.value =
            this.params.side.colorPower * COLOR.power.dark)));
    },
    scroll: { y: 0, p: 0 },
    onScroll(t, e) {
      ((this.scroll.y = t), (this.scroll.p = e));
    },
    onReset() {
      ((this.scroll.y = 0), (this.scroll.p = 0));
    },
    onUpdateForTransition() {
      const t = WEBGL.width * PAGE_TRANSITION.logo.radius,
        e = (PAGE_TRANSITION.mixAnim.ptShowLogo - 1) * PAGE_TRANSITION.logo.deg;
      if (e < -17.5) this.visible = !1;
      else {
        this.visible = !0;
        const i = e * (Math.PI / 180),
          n = t * Math.cos(i) - t,
          r = t * Math.sin(i);
        ((this.mesh.rotation.x = -i * PAGE_TRANSITION.anim.ptLogoOpacity),
          (this.mesh.rotation.y =
            -i * PAGE_TRANSITION.anim.ptLogoOpacity * 0.5));
        let s = clamp(
          1 - 1.75 * (1 - PAGE_TRANSITION.mixAnim.ptShowLogo),
          0,
          1,
        );
        (PAGE_TRANSITION.isZoomOutToHome || PAGE_TRANSITION.isZoomInToAbout) &&
          (s = clamp(1 - 1.2 * (1 - PAGE_TRANSITION.mixAnim.ptShowLogo), 0, 1));
        let a = 1;
        (DETECT.device.any
          ? ((this.mesh.rotation.z =
              PAGE_TRANSITION.mixAnim.ptShowLogo *
              (10 * this.scroll.p * (Math.PI / 180))),
            (a = 1.25))
          : (this.mesh.rotation.z =
              PAGE_TRANSITION.mixAnim.ptShowLogo *
                (10 * this.scroll.p * (Math.PI / 180)) +
              PAGE_TRANSITION.mixAnim.ptShowLogo *
                MOUSE.body.array[0].acceleration.delta.x *
                3 *
                (Math.PI / 180)),
          (this.mesh.scale.x =
            this.mesh.origin.scale.x *
            s *
            (1 +
              this.scroll.p * a * this.params.scroll.scale +
              0.666 * PAGE_TRANSITION.page.error.ptWebGl)),
          (this.mesh.scale.y =
            this.mesh.origin.scale.y *
            s *
            (1 +
              this.scroll.p * a * this.params.scroll.scale +
              0.666 * PAGE_TRANSITION.page.error.ptWebGl)),
          (this.mesh.scale.z =
            this.mesh.origin.scale.z *
            s *
            (1 +
              this.scroll.p * a * this.params.scroll.scale +
              0.666 * PAGE_TRANSITION.page.error.ptWebGl)));
        const o = -0.5 * (this.mesh.origin.scale.x - this.mesh.scale.x),
          l =
            -0.5 *
            this.mesh.scale.y *
            (this.geometry.boundingBox.max.y - this.geometry.boundingBox.min.y);
        ((this.mesh.position.x =
          this.mesh.scale.x * this.params.translate.x + o),
          (this.mesh.position.y =
            this.mesh.scale.y * this.params.translate.y +
            l +
            0.5 * n +
            PAGE_TRANSITION.mixAnim.ptShowLogo *
              clamp(this.scroll.p * WEBGL.height, 0, 0.2 * WEBGL.height)),
          (this.mesh.position.z =
            -r -
            PAGE_TRANSITION.mixAnim.ptShowLogo *
              clamp(this.scroll.p * WEBGL.height, 0, 0.1 * WEBGL.height)),
          (this.material.front.uniforms.opacity.value =
            PAGE_TRANSITION.anim.ptLogoOpacity -
            PAGE_TRANSITION.mixAnim.ptShowLogo *
              clamp(this.scroll.p * this.params.scroll.opacity, 0, 0.9) -
            0.9 * PAGE_TRANSITION.page.error.ptWebGl),
          (this.material.side.uniforms.opacity.value =
            PAGE_TRANSITION.anim.ptLogoOpacity -
            PAGE_TRANSITION.mixAnim.ptShowLogo *
              clamp(this.scroll.p * this.params.scroll.opacity, 0, 0.9) -
            0.9 * PAGE_TRANSITION.page.error.ptWebGl));
      }
      this.stage && (this.stage.visible = this.visible);
    },
  };
}
