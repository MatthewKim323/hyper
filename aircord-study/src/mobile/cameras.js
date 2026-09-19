// Recovered responsive implementation. See PROVENANCE.md.
import * as THREE from "three";
export default function initialize() {
  "use strict";
  var n = THREE;
  class r {
    constructor(t = {}) {
      ((this.props = t),
        (this.width = t.width || 0),
        (this.height = t.height || 0),
        (this.progress = 0),
        (this.angle = { x: 0, y: 0 }),
        (this.camera = new n.PerspectiveCamera(
          WEBGL.scenes.cameras.params.fov,
          WEBGL.aspect,
          0.1,
          WEBGL.scenes.cameras.params.far,
        )),
        this.camera.position.set(0, 0, WEBGL.scenes.cameras.params.far),
        this.onResize());
    }
    onResize(t = 0, e = 0) {
      ((this.width = t),
        (this.height = e),
        (this.camera.aspect = this.width / this.height),
        (this.camera.position.z = WEBGL.scenes.cameras.params.position.z),
        (this.camera.far = WEBGL.scenes.cameras.params.far + this.width),
        this.camera.updateProjectionMatrix());
    }
    onUpdateAngle(t = 0, e = 0, i = 0, n = 0.07, r = 0, s = 0, o = 0) {
      ((this.xRad = (90 - t) * (Math.PI / 180)),
        (this.yRad = (90 - e) * (Math.PI / 180)),
        (this.x =
          WEBGL.scenes.cameras.params.radius *
            Math.sin(this.yRad) *
            Math.cos(this.xRad) +
          s),
        (this.y = WEBGL.scenes.cameras.params.radius * Math.cos(this.yRad) + o),
        (this.z =
          WEBGL.scenes.cameras.params.radius *
          Math.sin(this.yRad) *
          Math.sin(this.xRad)),
        (this.camera.position.x = this.x),
        (this.camera.position.y = this.y),
        (this.camera.position.z = this.z),
        this.camera.lookAt(this.x * n, this.y * n, 0),
        (this.camera.rotation.z = i),
        (this.distance = Math.sqrt(
          this.x * this.x + this.y * this.y + this.z * this.z,
        )),
        (this.unit =
          this.height /
          (2 *
            Math.tan(WEBGL.scenes.cameras.params.vfov / 2) *
            this.distance)));
    }
    onUpdate(t, e) {
      const i =
        WEBGL.scenes.cameras.params.cfar +
        this.width * e * PAGE_TRANSITION.mixAnim.ptZoom;
      this.camera.far != i &&
        ((this.camera.far = i + this.width),
        this.camera.updateProjectionMatrix());
    }
  }
  var s = THREE;
  WEBGL.scenes.cameras = {
    screen: null,
    models: null,
    params: {
      fov: 30,
      ratio: 1.5,
      vfov: 0,
      far: 0,
      zfar: 0,
      cfar: 0,
      unit: 0,
      scale: 0.5,
      zoom: { scale: 0.99 },
      aspect: 0,
      radius: 0,
      position: { x: 0, y: 0, z: 0 },
      before: { zfar: 0, unit: 0, rescale: 1, position: { x: 0, y: 0, z: 0 } },
      pcam: { fov: 20, far: 0, vfov: 0, unit: 0 },
      mouse: {
        angleX: 0,
        angleY: 0,
        rotateZ: 0,
        lookPower: 0,
        angleMaxX: 10,
        angleMaxY: 2.5,
        rotateMaxZ: 10,
      },
      screen: { offsetZ: 0, angleX: 0, angleY: 0, rotateZ: 0 },
      models: {
        offsetZ: 0,
        angleX: 0,
        angleY: 0,
        rotateZ: 0,
        translateX: 0,
        translateY: 0,
      },
    },
    setForDevice() {
      WW <= MOBILE_WIDTH
        ? ((this.params.fov = 60), (this.params.ratio = 1), (FAR = 5))
        : WW <= TABLET_WIDTH
          ? ((this.params.fov = 45), (this.params.ratio = 1), (FAR = 5))
          : ((this.params.fov = 30), (this.params.ratio = 1.5), (FAR = 5));
    },
    once() {
      (this.setForDevice(),
        (this.screen = new r({ gl: WEBGL.scenes.first })),
        (this.models = new r({ gl: WEBGL.scenes.first })),
        (this.ocam = new s.OrthographicCamera(
          (-WEBGL.height * WEBGL.aspect) / 2,
          (WEBGL.height * WEBGL.aspect) / 2,
          WEBGL.height / 2,
          -WEBGL.height / 2,
          -WEBGL.height / 2,
          WEBGL.height / 2,
        )),
        (this.ocam.position.z = 1),
        (this.params.pcam.far =
          WEBGL.height /
          2 /
          Math.tan((this.params.pcam.fov * Math.PI) / 180 / 2)),
        (this.pcam = new s.PerspectiveCamera(
          this.params.pcam.fov,
          WEBGL.width / WEBGL.height,
          0.1,
          this.params.pcam.far,
        )),
        this.pcam.position.set(0, 0, this.params.pcam.far),
        (this.params.pcam.vfov = (this.params.pcam.fov * Math.PI) / 180),
        (this.params.pcam.unit =
          WEBGL.height /
          (2 * Math.tan(this.params.pcam.vfov / 2) * this.pcam.position.z)),
        this.onInit());
    },
    btn: {
      el: null,
      mouseenter: { func: null, tl1: null, tl2: null },
      mouseleave: { func: null, tl1: null, tl2: null },
    },
    onInit(t) {
      ((this.local = t || document.querySelector(".c-lc")),
        (this.btn.el = this.local.querySelector(".u-view")),
        (this.home = this.local.querySelector(".c-hm")),
        this.btn.el &&
          MOUSE.enable &&
          ((this.btn.mouseenter.func = () => {
            (this.btn.mouseleave.tl1 && this.btn.mouseleave.tl1.kill(),
              (this.btn.mouseenter.tl1 = gsap.to(PAGE_TRANSITION.anim, {
                ptHoverViewButton: 1,
                duration: 2.5,
                ease: "power2.out",
              })));
          }),
          (this.btn.mouseleave.func = () => {
            (this.btn.mouseenter.tl1 && this.btn.mouseenter.tl1.kill(),
              (this.btn.mouseleave.tl1 = gsap.to(PAGE_TRANSITION.anim, {
                ptHoverViewButton: 0,
                duration: 4,
                ease: "power2.out",
              })));
          }),
          this.btn.el.addEventListener("mouseenter", this.btn.mouseenter.func),
          this.btn.el.addEventListener(
            "mouseleave",
            this.btn.mouseleave.func,
          )));
    },
    onDestroy() {
      this.btn.mouseenter.func &&
        (this.btn.el.removeEventListener(
          "mouseenter",
          this.btn.mouseenter.func,
        ),
        this.btn.el.removeEventListener("mouseleave", this.btn.mouseleave.func),
        (this.btn.mouseenter.func = null),
        (this.btn.mouseleave.func = null));
    },
    onResize() {
      ((this.params.vfov = (this.params.fov * Math.PI) / 180),
        (this.params.far =
          WEBGL.height / 2 / Math.tan((this.params.fov * Math.PI) / 180 / 2)),
        (this.params.before.zfar =
          this.params.far * this.params.ratio * this.params.zoom.scale),
        (this.params.before.position.z =
          this.params.far + this.params.before.zfar),
        (this.params.before.unit =
          WEBGL.height /
          (2 * Math.tan(this.params.vfov / 2) * this.params.before.position.z)),
        (this.params.before.rescale = 1 / this.params.before.unit),
        this.screen.onResize(
          WEBGL.scenes.first.width,
          WEBGL.scenes.first.height,
        ),
        this.models.onResize(
          WEBGL.scenes.first.width,
          WEBGL.scenes.first.height,
        ),
        this.ocam &&
          ((this.ocam.left = -WEBGL.width / 2),
          (this.ocam.right = WEBGL.width / 2),
          (this.ocam.top = WEBGL.height / 2),
          (this.ocam.bottom = -WEBGL.height / 2),
          (this.ocam.near = -WEBGL.height / 2),
          (this.ocam.far = WEBGL.height / 2),
          this.ocam.updateProjectionMatrix()),
        this.pcam &&
          ((this.params.pcam.far =
            WEBGL.height /
            2 /
            Math.tan((this.params.pcam.fov * Math.PI) / 180 / 2)),
          (this.pcam.aspect = WEBGL.aspect),
          (this.pcam.position.z = this.params.pcam.far),
          (this.pcam.far = this.params.pcam.far + WEBGL.width),
          this.pcam.updateProjectionMatrix(),
          (this.params.pcam.vfov = (this.params.pcam.fov * Math.PI) / 180),
          (this.params.pcam.unit =
            WEBGL.height /
            (2 * Math.tan(this.params.pcam.vfov / 2) * this.pcam.position.z))));
    },
    onUpdateDom() {
      this.btn.el &&
        this.home &&
        ((this.btn.el.style.width =
          this.params.unit * WEBGL.width * (1 / RESCALE) + "px"),
        (this.btn.el.style.height =
          this.params.unit * WEBGL.height * (1 / RESCALE) + "px"),
        MOUSE.enable &&
          (this.home.style.setProperty(
            "--mouseX",
            SPLASH.params.ptCameraAngle * MOUSE.body.array[1].center.x,
          ),
          this.home.style.setProperty("--angleX", this.params.screen.angleX),
          this.home.style.setProperty(
            "--rotateZ",
            this.params.screen.rotateZ,
          )));
    },
    onUpdateParams() {
      ((this.params.zfar =
        this.params.far *
        this.params.ratio *
        (this.params.zoom.scale - PAGE_TRANSITION.mixAnim.ptZoom)),
        (this.params.cfar =
          WEBGL.width *
          FAR *
          (this.params.zoom.scale - PAGE_TRANSITION.mixAnim.ptZoom)),
        (this.params.position.z = this.params.far + this.params.zfar),
        (this.params.unit =
          WEBGL.height /
          (2 * Math.tan(this.params.vfov / 2) * this.params.position.z)),
        (this.params.radius = this.params.far + this.params.zfar));
    },
    onUpdateScreenAngle() {
      ((this.params.mouse.lookPower =
        -0.05 * (1 - PAGE_TRANSITION.mixAnim.ptZoom)),
        MOUSE.enable &&
          ((this.params.mouse.angleX =
            (1 - PAGE_TRANSITION.mixAnim.ptZoom) *
            MOUSE.body.array[0].center.x *
            (-2 * this.params.mouse.angleMaxX)),
          (this.params.mouse.angleY =
            (1 - PAGE_TRANSITION.mixAnim.ptZoom) *
            MOUSE.body.array[0].center.y *
            this.params.mouse.angleMaxY),
          (this.params.mouse.rotateZ =
            (1 - PAGE_TRANSITION.mixAnim.ptZoom) *
            (MOUSE.body.array[0].center.x - MOUSE.body.array[1].center.x) *
            this.params.mouse.rotateMaxZ)),
        (this.params.screen.angleX =
          0 * (1 - SPLASH.params.ptCameraAngle) +
          SPLASH.params.ptCameraAngle * this.params.mouse.angleX),
        (this.params.screen.angleY =
          90 * (1 - SPLASH.params.ptCameraAngle) +
          SPLASH.params.ptCameraAngle * this.params.mouse.angleY),
        (this.params.screen.rotateZ =
          0 * (1 - SPLASH.params.ptCameraAngle) +
          SPLASH.params.ptCameraAngle * this.params.mouse.rotateZ),
        (this.params.screen.lookPower =
          SPLASH.params.ptCameraAngle * this.params.mouse.lookPower),
        this.screen.onUpdateAngle(
          this.params.screen.angleX,
          this.params.screen.angleY,
          this.params.screen.rotateZ * (Math.PI / 180),
          this.params.screen.lookPower,
          this.params.screen.offsetZ,
        ));
    },
    onUpdateModelsAngle() {
      (MOUSE.enable &&
        ((this.params.screen.angleX =
          this.params.screen.angleX +
          PAGE_TRANSITION.mixAnim.ptZoom *
            MOUSE.body.array[0].center.x *
            (30 * PAGE_TRANSITION.mixAnim.ptZoom - 45)),
        (this.params.screen.rotateZ =
          this.params.screen.rotateZ +
          PAGE_TRANSITION.mixAnim.ptZoom *
            (MOUSE.body.array[0].center.x - MOUSE.body.array[1].center.x))),
        (this.params.models.angleY =
          this.params.screen.angleY + PAGE_TRANSITION.mixAnim.ptZoom),
        (this.params.models.offsetZ =
          0.5 * (1 - PAGE_TRANSITION.anim.ptZoomInProjects) * WEBGL.width),
        (this.params.models.angleX =
          this.params.screen.angleX *
          (1 - PAGE_TRANSITION.page.single.ptWebGl)),
        (this.params.models.angleY =
          this.params.screen.angleY *
            (1 - PAGE_TRANSITION.page.single.ptWebGl) -
          PAGE_TRANSITION.page.about.ptWebGl *
            PAGE_TRANSITION.mixAnim.ptShowLogo *
            WEBGL.logo.scroll.p *
            60),
        (this.params.models.rotateZ = 0),
        (this.params.models.offsetZ =
          this.params.screen.offsetZ *
          (1 - PAGE_TRANSITION.page.single.ptWebGl)),
        (this.params.models.lookPower =
          this.params.screen.lookPower *
          (1 - PAGE_TRANSITION.page.single.ptWebGl)),
        MOUSE.enable
          ? ((this.params.models.translateX =
              MOUSE.body.array[0].center.x *
              WEBGL.width *
              0.5 *
              PAGE_TRANSITION.page.projects.ptWebGl),
            (this.params.models.translateY =
              clamp(
                (1 - MOUSE.body.array[0].delta.y / WH) * WEBGL.height * 0.5,
                0.1 * -WEBGL.height,
                0.5 * WEBGL.height,
              ) * PAGE_TRANSITION.page.projects.ptWebGl))
          : ((this.params.models.translateX =
              0 * WEBGL.height * PAGE_TRANSITION.page.projects.ptWebGl),
            (this.params.models.translateY =
              0.25 * WEBGL.height * PAGE_TRANSITION.page.projects.ptWebGl)),
        this.models.onUpdateAngle(
          this.params.models.angleX,
          this.params.models.angleY,
          this.params.models.rotateZ * (Math.PI / 180),
          this.params.models.lookPower,
          this.params.models.offsetZ,
          this.params.models.translateX,
          this.params.models.translateY,
        ));
    },
    onUpdate() {
      (this.onUpdateDom(),
        this.onUpdateParams(),
        this.onUpdateScreenAngle(),
        this.onUpdateModelsAngle(),
        this.screen.onUpdate("screen", FAR),
        this.models.onUpdate(
          "models",
          Math.min(FAR, PAGE_TRANSITION.screen.radius),
        ));
    },
  };
}
