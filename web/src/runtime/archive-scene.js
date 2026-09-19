// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";
import shader1 from "../shaders/cursor-1.glsl?raw";
import shader2 from "../shaders/cursor-2.glsl?raw";

export default function initialize() {
  "use strict";
  var n = THREE;
  class r extends n.MeshStandardMaterial {
    constructor(t) {
      const {
        tvNoizePower: e,
        tvNoizeDisp: i,
        poster: n,
        data: r,
        radius: s,
        width: a,
        height: o,
        angleRange: l,
        rotate: h,
        tImage: c,
        offsetPower: u,
        resolution: d,
        i_resolution: p,
        ...m
      } = t;
      (super(m),
        (this.props = t),
        (this.anim = { enter: {}, leave: {} }),
        (this.userData.uniforms = {
          radius: { value: this.props.radius || 0 },
          width: { value: this.props.width || 0 },
          height: { value: this.props.height || 0 },
          angleRange: { value: this.props.angleRange || 0 },
          rotate: { value: this.props.rotate || 0 },
          curvePower: { value: this.props.curvePower || 1 },
          offsetPower: { value: this.props.offsetPower || 1.1 },
          resolution: { value: this.props.resolution || { x: 0, y: 0 } },
          i_resolution: {
            value: this.props.i_resolution || { x: 0, y: 0 },
          },
          tvNoizePower: { value: this.props.tvNoizePower || 0.05 },
          tvNoizeDisp: { value: this.props.tvNoizePower || 1024 },
        }),
        (this.onBeforeCompile = (t) => {
          (Object.assign(t.uniforms, this.userData.uniforms),
            (t.vertexShader = shader1),
            (t.fragmentShader = shader2));
        }));
    }
  }
  var s = THREE;
  WEBGL.archives = {
    ready: !1,
    params: { roughness: 1, metalness: 0, tvNoizePower: 0.1 },
    once() {
      ((this.material = new r({
        transparent: !0,
        roughness: 1,
        metalness: 0,
        map: null,
        opacity: 1,
        depthWrite: !0,
      })),
        (this.mesh = new s.Mesh(WEBGL.screen.screenGeometry, this.material)),
        WEBGL.scene.add(this.mesh),
        (this.selected = ARCHIVES.json[0]),
        this.onResize(),
        (this.ready = !0),
        this.onInit());
    },
    onResize() {
      if (this.mesh) {
        const t = WEBGL.screen.params;
        ((this.height = t.origin.height),
          (this.width =
            ((t.origin.height * this.selected.width) / this.selected.height) *
            1.5),
          (this.mesh.material.userData.uniforms.width.value = this.width),
          (this.mesh.material.userData.uniforms.height.value = this.height),
          (this.mesh.material.userData.uniforms.radius.value = t.radius),
          (this.mesh.material.userData.uniforms.offsetPower.value = 1),
          (this.mesh.material.userData.uniforms.angleRange.value =
            t.degInner * (Math.PI / 180)),
          (this.mesh.material.userData.uniforms.curvePower.value = 1),
          (this.mesh.material.userData.uniforms.resolution.value.x =
            this.width),
          (this.mesh.material.userData.uniforms.resolution.value.y =
            this.height),
          (this.mesh.material.userData.uniforms.i_resolution.value.x =
            this.selected.width),
          (this.mesh.material.userData.uniforms.i_resolution.value.y =
            this.selected.height));
      }
    },
    onUpdate() {
      this.mesh &&
        ((this.mesh.material.opacity =
          PAGE_TRANSITION.page.archives.ptWebGl * this.opacity),
        (this.mesh.visble = this.mesh.material.opacity > 0),
        (this.mesh.material.depthWrite = this.mesh.visble),
        (this.mesh.material.userData.uniforms.tvNoizePower.value =
          this.params.tvNoizePower),
        DETECT.device.any ||
          ((this.mesh.material.userData.uniforms.rotate.value =
            45 * MOUSE.body.array[0].center.x),
          (this.mesh.rotation.z =
            MOUSE.body.array[0].acceleration.delta.x *
            MOUSE.params.rotation.z *
            (Math.PI / 180))));
    },
    opacity: 0,
    el: null,
    array: [],
    timer: null,
    wrap: { el: null, mouseenter: null, mouseleave: null },
    onInit(t) {
      if (
        ((this.local = t || document.querySelector(".c-lc")),
        (this.el = this.local.querySelectorAll(".js-archive")),
        (this.wrap.el = this.local.querySelector(".c-ar-body .l-tbody")),
        this.wrap.el &&
          ((this.wrap.mouseenter = () => {
            "dark" === COLOR.current
              ? gsap.to(this, {
                  opacity: 0.5,
                  duration: 0.3,
                  ease: "power2.out",
                })
              : gsap.to(this, {
                  opacity: 0.3,
                  duration: 0.3,
                  ease: "power2.out",
                });
          }),
          this.wrap.el.addEventListener("mouseenter", this.wrap.mouseenter),
          (this.wrap.mouseleave = () => {
            gsap.to(this, {
              opacity: 0,
              duration: 0.3,
              ease: "power2.out",
            });
          }),
          this.wrap.el.addEventListener("mouseleave", this.wrap.mouseleave)),
        this.el)
      ) {
        for (let t = 0; t < this.el.length; t++) {
          const e = this.el[t];
          this.array.push({
            el: e,
            index: Number(e.dataset.index),
            slug: e.dataset.slug,
            rect: null,
            mouseenter: null,
            mouseleave: null,
          });
        }
        DETECT.device.any ||
          this.array.forEach((t, e) => {
            ((t.mouseenter = () => {
              (this.onMouseEnterBefore(t),
                clearTimeout(this.timer),
                (this.timer = setTimeout(() => {
                  this.onMouseEnterAfter(t);
                }, 200)));
            }),
              (t.mouseleave = () => {
                (clearTimeout(this.timer), this.onMouseLeave());
              }),
              t.el.addEventListener("mouseenter", t.mouseenter),
              t.el.addEventListener("mouseleave", t.mouseleave));
          });
      }
    },
    selected: null,
    onFadeIn(t) {
      ((this.selected = t),
        this.onResize(this.selected),
        (this.material.map = this.selected.imageTex.tex),
        (this.material.needsUpdate = !0));
    },
    selected: null,
    onFadeInPre(t) {
      ((this.selected = t),
        this.onResize(this.selected),
        (this.material.map = this.selected.preTex.tex),
        (this.material.needsUpdate = !0));
    },
    onMouseEnterBefore(t) {
      ARCHIVES.onMouseEnterPreLoadTexture(t);
    },
    onMouseEnterAfter(t) {
      ARCHIVES.onMouseEnterLoadTexture(t);
    },
    onMouseLeave() {},
    onDestroy() {
      (this.wrap.el &&
        (this.wrap.mouseenter &&
          this.wrap.el.removeEventListener("mouseenter", this.wrap.mouseenter),
        this.wrap.mouseleave &&
          this.wrap.el.removeEventListener("mouseleave", this.wrap.mouseleave),
        (this.wrap.mouseenter = null),
        (this.wrap.mouseleave = null),
        (this.wrap.el = null)),
        this.array.forEach((t, e) => {
          (t.mouseenter &&
            (t.el.removeEventListener("mouseenter", t.mouseenter),
            (t.mouseenter = null)),
            t.mouseleave &&
              (t.el.removeEventListener("mouseleave", t.mouseleave),
              (t.mouseleave = null)));
        }),
        (this.array = []));
    },
  };
}
