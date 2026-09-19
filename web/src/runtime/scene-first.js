// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";
import shader1 from "../shaders/scene-first-1.glsl?raw";

export default function initialize() {
  "use strict";
  var n = THREE;
  WEBGL.scenes.first = {
    ready: !1,
    fbo: null,
    screen: null,
    material: null,
    geometry: null,
    scene: null,
    params: {
      zoom: 1,
      shift: { ratio: { x: 0, y: 1, z: 2 }, amount: 0.0375, deg: 45 },
      roughness: 0,
      metalness: 0,
      transmission: 1,
      thickness: 1,
      envMapIntensity: 1,
    },
    view: { screen: null, models: null },
    once() {
      ((this.scene = new n.Scene()),
        (this.scene.background = COLOR.table.scene.three),
        (this.stage = new n.Group()),
        this.scene.add(this.stage),
        (this.raycaster = new n.Raycaster()),
        (this.mouse = new n.Vector2()),
        (this.far =
          WEBGL.height / 2 / Math.tan((this.fov * Math.PI) / 180 / 2)),
        this.onInitFbo(),
        this.onInitScreen(),
        this.onChangeGui(),
        this.frame && this.frame.once(),
        (this.ready = !0));
    },
    onLoaded() {
      (this.ground && this.ground.once(), this.ground.onResize());
    },
    onChangeGui() {
      this.ground.ready && this.ground.onChangeGui();
    },
    onInitScreen() {
      ((this.geometry = new n.PlaneGeometry(1, 1)),
        (this.material = new n.ShaderMaterial({
          vertexShader: NormalVert,
          fragmentShader: shader1,
          uniforms: {
            uv_resolution: { value: { x: 0, y: 0 } },
            tDiffuse: { value: this.fbo.texture },
            depthWrite: !1,
            depthTest: !0,
          },
        })),
        (this.screen = new n.Mesh(this.geometry, this.material)),
        (this.screen.renderOrder = 2),
        this.stage.add(this.screen));
    },
    onUpdate() {
      (this.onUpdateForTransition(),
        this.ground.ready && this.ground.onUpdate(),
        this.frame.ready && this.frame.onUpdate(),
        "UI" === DESIGN.params.view
          ? ((WEBGL.screen.visible = !1), (WEBGL.logo.visible = !1))
          : ((WEBGL.screen.visible = PAGE_TRANSITION.mixAnim.ptShowScreen > 0),
            (WEBGL.logo.visible = PAGE_TRANSITION.mixAnim.ptShowLogo > 0)));
    },
    onResize() {
      ((this.height = WEBGL.height),
        (this.width = WEBGL.width),
        DETECT.device.any &&
          ((this.width = Math.max(WEBGL.width, (3 * WEBGL.height) / 2)),
          IS_LANDSCAPE
            ? (this.width = Math.max(WEBGL.width, (3 * WEBGL.height) / 2))
            : (this.width =
                (WEBGL.width *
                  WEBGL.scenes.cameras.params.before.rescale *
                  WW) /
                  WH -
                30 * RES.ratio * RESCALE)),
        (this.screen.scale.x = this.width),
        (this.screen.scale.y = this.height),
        (this.screen.material.uniforms.uv_resolution.value.x =
          (1 * this.screen.scale.x) / RESCALE),
        (this.screen.material.uniforms.uv_resolution.value.y =
          (1 * this.screen.scale.y) / RESCALE),
        this.ground.ready && this.ground.onResize(),
        this.frame.ready && this.frame.onResize(),
        this.onResizeFbo());
    },
    onInitFbo() {
      this.fbo = new n.WebGLRenderTarget(
        WEBGL.gloablWidth * RES.ratio,
        WEBGL.gloablHeight * RES.ratio,
        {
          format: n.RGBFormat,
          minFilter: n.LinearFilter,
          magFilter: n.LinearFilter,
        },
      );
    },
    onResizeFbo() {
      this.fbo.setSize(
        WEBGL.gloablWidth * RES.ratio,
        WEBGL.gloablHeight * RES.ratio,
      );
    },
    onUpdateRay() {
      MOUSE.enable &&
        ((this.mouse.x = (MOUSE.body.x / window.innerWidth) * 2 - 1),
        (this.mouse.y = (-MOUSE.body.y / window.innerHeight) * 2 + 1),
        this.raycaster.setFromCamera(
          this.mouse,
          WEBGL.scenes.cameras.models.camera,
        ));
    },
    counter: 0,
    onPreRender() {
      ((WEBGL.screen.visible = !0), (WEBGL.logo.visible = !0));
    },
    onRender() {
      (WEBGL.renderer.setRenderTarget(this.fbo),
        WEBGL.renderer.render(WEBGL.scene, WEBGL.scenes.cameras.models.camera));
    },
    onUpdateForTransition() {
      (MOUSE.enable &&
        (this.screen.rotation.y =
          SPLASH.params.ptCameraAngle *
          (1 - PAGE_TRANSITION.anim.ptZoomIn) *
          MOUSE.body.array[0].center.x *
          30 *
          (Math.PI / 180)),
        (this.screen.rotation.z =
          SPLASH.params.ptCameraAngle *
          PAGE_TRANSITION.anim.ptZoomInSkew *
          1.5 *
          (Math.PI / 180)),
        this.onUpdateRay());
    },
  };
}
