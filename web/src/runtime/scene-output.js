// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";
import shader1 from "../shaders/scene-output-1.glsl?raw";

export default function initialize() {
  "use strict";
  var n = shader1,
    r = THREE;
  WEBGL.scenes.second = {
    ready: !1,
    fbo: null,
    screen: null,
    material: null,
    geometry: null,
    scene: null,
    fov: 15,
    params: {
      screen: { alpha: 0.4 },
      blur: { directions: 10, quality: 3, power: 0.05, alpha: 0.9 },
      mouse: { size: 0.4, age: 1 },
    },
    once() {
      ((this.fbo = new r.WebGLRenderTarget(
        WEBGL.gloablWidth * RES.ratio,
        WEBGL.gloablHeight * RES.ratio,
        {
          format: r.RGBFormat,
          minFilter: r.LinearFilter,
          magFilter: r.LinearFilter,
        },
      )),
        (this.scene = new r.Scene()),
        this.onInitScreen(),
        (this.ready = !0));
    },
    onInitScreen() {
      let t = new r.PlaneGeometry(1, 1),
        e = null;
      (WEBGL.contents &&
        ((e = new r.ShaderMaterial({
          vertexShader: NormalVert,
          fragmentShader: n,
          uniforms: {
            alpha: { value: 1 },
            uv_resolution: { value: { x: 0, y: 0 } },
            tDiffuse: { value: WEBGL.contents.fbo.texture },
            rgbShiftPower: { value: 0 },
            rgbShiftRatio: {
              value: WEBGL.scenes.first.params.shift.ratio,
            },
            rgbShiftAmount: {
              value: 0.01 * WEBGL.scenes.first.params.shift.amount,
            },
            rgbShiftDeg: { value: WEBGL.scenes.first.params.shift.deg },
          },
          depthWrite: !1,
          depthTest: !0,
          transparent: !0,
        })),
        (this.contents = new r.Mesh(t, e)),
        (this.contents.renderOrder = 2),
        this.scene.add(this.contents)),
        (e = new r.ShaderMaterial({
          vertexShader: NormalVert,
          fragmentShader: n,
          transparent: !0,
          uniforms: {
            uv_resolution: { value: { x: 0, y: 0 } },
            tDiffuse: { value: this.fbo.texture },
            rgbShiftPower: { value: 0 },
            rgbShiftRatio: {
              value: WEBGL.scenes.first.params.shift.ratio,
            },
            rgbShiftAmount: {
              value: 0.01 * WEBGL.scenes.first.params.shift.amount,
            },
            rgbShiftDeg: { value: WEBGL.scenes.first.params.shift.deg },
            alpha: { value: 1 },
          },
          depthWrite: !1,
          depthTest: !0,
          transparent: !0,
        })),
        (this.screen = new r.Mesh(t, e)),
        (this.screen.renderOrder = 1),
        this.scene.add(this.screen));
    },
    scroll: { y: 0 },
    onScroll(t = 0) {
      this.scroll.y = clamp(t * RESCALE, 0, 1.5 * WEBGL.height);
    },
    onUpdate() {
      const t = clamp(
        PAGE_TRANSITION.anim.ptZoomIn +
          PAGE_TRANSITION.page.single.ptWebGl +
          PAGE_TRANSITION.page.about.ptWebGl,
        0,
        1,
      );
      if (this.screen) {
        let e = this.scroll.y * PAGE_TRANSITION.page.single.ptWebGl;
        (PAGE_TRANSITION.flag.isSingleToSingleFromFooter &&
          (e =
            0.5 *
            -WEBGL.height *
            PAGE_TRANSITION.anim.ptSingleToSingleFromFooter),
          DETECT.device.any ||
            (this.screen.position.y =
              (-WEBGL.height / 2) * PAGE_TRANSITION.page.single.ptWebGl + e));
        const i =
          1 -
          PAGE_TRANSITION.page.single.ptWebGl *
            this.params.screen.alpha *
            COLOR.power.dark;
        ((this.screen.material.uniforms.alpha.value = i),
          (this.screen.material.uniforms.rgbShiftPower.value =
            t * SPLASH.params.ptCameraAngle));
      }
      this.contents &&
        (this.contents.material.uniforms.rgbShiftPower.value =
          t * SPLASH.params.ptCameraAngle);
    },
    onReset() {
      this.scroll.y = 0;
    },
    onResize() {
      ((this.width = WEBGL.scenes.first.width),
        (this.height = WEBGL.scenes.first.height),
        this.screen &&
          ((this.screen.scale.x = this.width),
          (this.screen.scale.y = this.height),
          (this.screen.material.uniforms.uv_resolution.value.x =
            ((1 * this.width) / RESCALE) * RES.ratio),
          (this.screen.material.uniforms.uv_resolution.value.y =
            ((1 * this.height) / RESCALE) * RES.ratio)),
        this.contents &&
          ((this.contents.scale.x = this.width),
          (this.contents.scale.y = this.height),
          (this.contents.material.uniforms.uv_resolution.value.x =
            ((1 * this.width) / RESCALE) * RES.ratio),
          (this.contents.material.uniforms.uv_resolution.value.y =
            ((1 * this.height) / RESCALE) * RES.ratio)),
        this.fbo.setSize(
          ((1 * this.width) / RESCALE) * RES.ratio,
          ((1 * this.height) / RESCALE) * RES.ratio,
        ));
    },
    onRender() {
      (WEBGL.renderer.setRenderTarget(this.fbo),
        WEBGL.renderer.render(
          WEBGL.scenes.first.scene,
          WEBGL.scenes.cameras.screen.camera,
        ));
    },
  };
}
