// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";
import shader1 from "../shaders/content-surfaces-1.glsl?raw";
import shader2 from "../shaders/content-surfaces-2.glsl?raw";

export default function initialize() {
  "use strict";
  var n = THREE;
  class r extends n.MeshPhysicalMaterial {
    constructor(t) {
      const {
        addAlpha: e,
        addColor: i,
        noiseAlpha: n,
        noisePower: r,
        time: s,
        ...a
      } = t;
      (super(a),
        (this.props = t),
        (this.userData.uniforms = {
          time: { value: this.props.time || 0 },
          addAlpha: { value: this.props.addAlpha || 0 },
          addColor: { value: this.props.addColor || 0 },
          noiseAlpha: { value: this.props.noiseAlpha || 0 },
          noisePower: { value: this.props.noisePower || { x: 0, y: 0 } },
        }),
        (this.onBeforeCompile = (t) => {
          (Object.assign(t.uniforms, this.userData.uniforms),
            (t.vertexShader = shader1),
            (t.fragmentShader = shader2));
        }));
    }
  }
  var s = THREE;
  class a {
    constructor(t = {}) {
      ((this.props = t),
        (this.textures = {
          uiNormal: {
            src: {
              d2x: CDN_ASSETS_URL + "/tex/1024/uiNormal.jpg",
              d1x: CDN_ASSETS_URL + "/tex/512/uiNormal.jpg",
              mob: CDN_ASSETS_URL + "/tex/512/uiNormal.jpg",
            },
            tex: null,
          },
          uiRoughness: {
            src: {
              d2x: CDN_ASSETS_URL + "/tex/1024/uiRoughness.jpg",
              d1x: CDN_ASSETS_URL + "/tex/512/uiRoughness.jpg",
              mob: CDN_ASSETS_URL + "/tex/512/uiRoughness.jpg",
            },
            tex: null,
          },
        }),
        (this.geometries = []),
        (this.geometry = null),
        (this.prevGeometry = { index: 0, name: null, rotation: 0 }),
        (this.currentGeometry = { index: 0, name: null, rotation: 0 }),
        (this.transform = {
          cursor: 1,
          scale: 1,
          translate: { y: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        }),
        (this.anim = {
          mouseenter: { timer: null, wait: 200, tl: null, ing: !1 },
          mouseleave: { timer: null, wait: 200, tl: null, ing: !1 },
        }),
        this.onInitGeometory(),
        this.onInitMaterial());
    }
    onInitGeometory() {
      (this.props.geometries.forEach((t, e) => {
        t.index = e;
        const i = new TextGeometry(t.t, {
          font: LOADER.fonts.ui.json,
          size: 1,
          height: 0.08,
          curveSegments: 12,
          bevelEnabled: !1,
          bevelThickness: 0,
          bevelSize: 0,
          bevelOffset: 0,
          bevelSegments: 0,
        });
        (i.computeBoundingBox(), (i.name = t.name));
        const n = 0.5 * (i.boundingBox.max.x - i.boundingBox.min.x),
          r = 0.44 * (i.boundingBox.max.y - i.boundingBox.min.y),
          s = 0.5 * (i.boundingBox.max.z - i.boundingBox.min.z);
        (i.translate(-n, -r, -s), this.geometries.push(i));
      }),
        (this.geometry = this.geometries[0]));
    }
    onInitMaterial() {
      let t = getSrc(
          this.textures.uiRoughness.src.d1x,
          this.textures.uiRoughness.src.d2x,
          this.textures.uiRoughness.src.mob,
          this.textures.uiRoughness.src.d1x,
          !0,
        ),
        e = getSrc(
          this.textures.uiNormal.src.d1x,
          this.textures.uiNormal.src.d2x,
          this.textures.uiNormal.src.mob,
          this.textures.uiNormal.src.d1x,
          !0,
        );
      ((this.textures.uiRoughness.tex = new s.TextureLoader().load(t)),
        (this.textures.uiRoughness.tex.wrapS = s.RepeatWrapping),
        (this.textures.uiRoughness.tex.wrapT = s.RepeatWrapping),
        (this.textures.uiNormal.tex = new s.TextureLoader().load(e)),
        (this.textures.uiNormal.tex.wrapS = s.RepeatWrapping),
        (this.textures.uiNormal.tex.wrapT = s.RepeatWrapping),
        (this.front = new r({
          roughnessMap: this.textures.uiRoughness.tex,
          normalMap: this.textures.uiNormal.tex,
          roughness: this.props.roughness,
          metalness: this.props.metalness,
          transmission: this.props.transmission,
          thickness: this.props.thickness,
          color: "#fff",
          noisePower: { x: 1, y: 1 },
          noiseAlpha: 0.1,
          addAlpha: 0,
          addColor: 0,
        })),
        (this.side = new r({
          roughness: this.props.roughness,
          metalness: this.props.metalness,
          transmission: this.props.transmission,
          thickness: this.props.thickness,
          color: "#fff",
          noisePower: { x: 2.5, y: 5 },
          noiseAlpha: 0.1,
          addAlpha: 0,
          addColor: 0,
        })),
        (this.materials = [this.front, this.side]),
        (this.mesh = new s.Mesh(this.geometry, this.materials)),
        (this.mesh.position.x = 0),
        (this.mesh.position.y = 0),
        (this.mesh.position.z = 0),
        this.props.scene.add(this.mesh));
    }
    onResize() {}
    onUpdate() {
      ((this.mesh.scale.x =
        SPLASH.params.ptIconScale *
        this.transform.scale *
        getPxByVwThree(
          2 * this.props.size,
          WEBGL.width,
          WEBGL.scenes.cameras.params.pcam.unit,
        ) *
        0.5 *
        0.7),
        (this.mesh.scale.y =
          SPLASH.params.ptIconScale *
          this.transform.scale *
          getPxByVwThree(
            2 * this.props.size,
            WEBGL.width,
            WEBGL.scenes.cameras.params.pcam.unit,
          ) *
          0.5 *
          0.7),
        (this.mesh.scale.z = this.mesh.scale.y),
        this.onUpdatePosition(),
        this.onUpdateRotate(),
        (this.front.userData.uniforms.time.value = 0.005 * GLOBAL_TIME),
        (this.side.userData.uniforms.time.value = 0.005 * GLOBAL_TIME),
        this.front.metalness !=
          this.props.metalness -
            0.75 * this.props.metalness * COLOR.power.light &&
          ((this.front.metalness =
            this.props.metalness -
            0.75 * this.props.metalness * COLOR.power.light),
          (this.side.metalness =
            this.props.metalness -
            0.75 * this.props.metalness * COLOR.power.light)),
        (this.front.userData.uniforms.addAlpha.value =
          COLOR.power.dark * PAGE_TRANSITION.page.single.ptWebGl * 0.1),
        (this.front.userData.uniforms.addColor.value =
          COLOR.power.dark * PAGE_TRANSITION.page.single.ptWebGl * 0.05));
    }
    onUpdatePosition() {
      ((this.mesh.position.x =
        MOUSE.body.array[1].shader.x * WEBGL.width * 0.5),
        (this.mesh.position.y =
          MOUSE.body.array[1].shader.y * WEBGL.height * 0.5 +
          0.1 * GLOBAL_SIN -
          0.8 * this.mesh.scale.x),
        (this.mesh.position.z = this.mesh.scale.x));
    }
    onUpdateRotate() {
      const t =
        1 -
        clamp(
          PAGE_TRANSITION.page.archives.ptWebGl +
            PAGE_TRANSITION.page.about.ptWebGl +
            PAGE_TRANSITION.page.single.ptWebGl,
          0,
          1,
        );
      ((this.mesh.rotation.x =
        this.transform.rotation.x +
        t *
          this.transform.cursor *
          MOUSE.body.array[1].center.y *
          360 *
          2 *
          (Math.PI / 180) -
        360 * MOUSE.body.array[1].acceleration.delta.y * (Math.PI / 180)),
        (this.mesh.rotation.y =
          this.transform.rotation.y +
          t *
            this.transform.cursor *
            -MOUSE.body.array[1].center.x *
            360 *
            2 *
            (Math.PI / 180) -
          360 * MOUSE.body.array[1].acceleration.delta.x * (Math.PI / 180)),
        (this.mesh.rotation.z = this.transform.rotation.z));
    }
    onMouseEnter(t, e, i = 0.9, n = "power2") {
      if (
        t === this.currentGeometry.name &&
        e === this.currentGeometry.rotation
      )
        return !1;
      (this.anim.mouseenter.tl && this.anim.mouseenter.tl.kill(),
        (this.anim.mouseenter.tl = null),
        this.anim.mouseleave.tl && this.anim.mouseleave.tl.kill(),
        (this.anim.mouseleave.tl = null),
        (this.anim.mouseenter.tl = gsap.timeline({})),
        this.anim.mouseenter.tl.to(
          this.transform,
          { cursor: 0, duration: 0.5 * i, ease: n + ".in" },
          "before",
        ),
        this.anim.mouseenter.tl.to(
          this.transform.rotation,
          { y: (Math.PI / 180) * 90, duration: 0.5 * i, ease: n + ".in" },
          "before",
        ),
        this.anim.mouseenter.tl.set(
          this.transform.rotation,
          { z: Number(e) * (Math.PI / 180), y: (Math.PI / 180) * -90 },
          "after",
        ),
        this.anim.mouseenter.tl.to(
          this.transform.rotation,
          {
            y: 0,
            duration: i,
            ease: n + ".out",
            onStart: () => {
              this.onChangeGeometry(t, e);
            },
          },
          "after",
        ),
        this.anim.mouseenter.tl.to(
          this.transform.translate,
          { y: 1, duration: 2 * i, ease: n + ".out" },
          "after",
        ));
    }
    onMouseLeave(t = 1.2, e = "power2") {
      let i = "cursor",
        n = "0";
      switch (PAGE_TRANSITION.current.name) {
        case "archives":
        case "about":
        case "single":
          ((i = "arrow"), (n = "-90"));
      }
      (this.anim.mouseenter.tl && this.anim.mouseenter.tl.kill(),
        (this.anim.mouseenter.tl = null),
        this.anim.mouseleave.tl && this.anim.mouseleave.tl.kill(),
        (this.anim.mouseleave.tl = null),
        (this.anim.mouseleave.tl = gsap.timeline({})),
        this.anim.mouseleave.tl.to(
          this.transform.rotation,
          { y: (Math.PI / 180) * 90, duration: 0.5 * t, ease: e + ".in" },
          "before",
        ),
        this.anim.mouseleave.tl.set(
          this.transform.rotation,
          { z: Number(n) * (Math.PI / 180), y: (Math.PI / 180) * -90 },
          "after",
        ),
        this.anim.mouseleave.tl.to(
          this.transform.rotation,
          {
            y: 0,
            duration: t,
            ease: e + ".out",
            onStart: () => {
              this.onChangeGeometry(i, n);
            },
          },
          "after",
        ),
        this.anim.mouseleave.tl.to(
          this.transform.translate,
          { y: 0, duration: 2 * t, ease: e + ".out" },
          "after",
        ),
        this.anim.mouseleave.tl.to(this.transform, {
          cursor: 1,
          duration: 3 * t,
          ease: "power0.out",
        }));
    }
    onChangeGeometry(t, e) {
      ((this.prevGeometry.name = this.currentGeometry.name),
        (this.prevGeometry.rotation = this.currentGeometry.rotation));
      for (let i = 0; i < this.geometries.length; i++) {
        this.geometries[i].name === t &&
          ((this.currentGeometry.index = i),
          (this.currentGeometry.name = t),
          (this.currentGeometry.rotation = e));
      }
      this.mesh.geometry = this.geometries[this.currentGeometry.index];
    }
  }
  WEBGL.icon = {
    ready: !1,
    local: null,
    params: {
      size: 100,
      roughness: 0,
      metalness: 0.33,
      transmission: 1,
      thickness: 3.2,
    },
    array: {
      body: null,
      geometries: [
        { name: "cursor", t: "1" },
        { name: "pause", t: "2" },
        { name: "play", t: "3" },
        { name: "drag", t: "4" },
        { name: "close", t: "5" },
        { name: "arrow", t: "6" },
      ],
    },
    keys: [],
    once() {
      ((this.body = new a({
        geometries: this.array.geometries,
        size: this.params.size,
        scene: WEBGL.scenes.final.output.scene,
        roughness: this.params.roughness,
        metalness: this.params.metalness,
        transmission: this.params.transmission,
        thickness: this.params.thickness,
      })),
        this.onInit(),
        this.onInitGlobal());
    },
    leaveArrayGlobal: [],
    enterArrayGlobal: [],
    onInitGlobal() {
      const t = document.querySelectorAll(".l-gl .js-u-leave"),
        e = document.querySelectorAll(".l-gl .js-u-enter");
      (t.forEach((t, e) => {
        this.leaveArrayGlobal.push({
          el: t,
          timer: null,
          name: !!t.dataset.uiName && t.dataset.uiName,
          mouseleave: null,
        });
      }),
        e.forEach((t, e) => {
          const i = t.dataset.uiGeometry,
            n = Number(t.dataset.uiRotation);
          this.enterArrayGlobal.push({
            el: t,
            timer: null,
            name: !!t.dataset.uiName && t.dataset.uiName,
            mouseenter: null,
            geometry: i,
            rotation: n,
          });
        }));
      for (let t = 0; t < this.leaveArrayGlobal.length; t++) {
        const e = this.leaveArrayGlobal[t];
        ((e.mouseleave = () => {
          this.body && this.body.onMouseLeave();
        }),
          e.el.addEventListener("mouseleave", e.mouseleave));
      }
      for (let t = 0; t < this.enterArrayGlobal.length; t++) {
        const e = this.enterArrayGlobal[t];
        ((e.mouseenter = () => {
          this.body && this.body.onMouseEnter(e.geometry, e.rotation);
        }),
          e.el.addEventListener("mouseenter", e.mouseenter));
      }
    },
    leaveArray: [],
    enterArray: [],
    onInit(t) {
      this.local = t || document.querySelector(".c-lc");
      const e = this.local.querySelectorAll(".js-u-leave"),
        i = this.local.querySelectorAll(".js-u-enter");
      switch (PAGE_TRANSITION.current.name) {
        case "archives":
        case "about":
        case "single":
          this.body &&
            "-90" != this.body.currentGeometry.rotation &&
            this.body.onMouseEnter("arrow", "-90", 1.2);
          break;
        default:
          this.body &&
            "close" != this.body.currentGeometry.name &&
            this.body.onMouseLeave();
      }
      (e.forEach((t, e) => {
        this.leaveArray.push({
          el: t,
          timer: null,
          name: !!t.dataset.uiName && t.dataset.uiName,
          mouseleave: null,
        });
      }),
        i.forEach((t, e) => {
          const i = t.dataset.uiGeometry,
            n = Number(t.dataset.uiRotation);
          this.enterArray.push({
            el: t,
            timer: null,
            name: !!t.dataset.uiName && t.dataset.uiName,
            mouseenter: null,
            geometry: i,
            rotation: n,
          });
        }));
      for (let t = 0; t < this.leaveArray.length; t++) {
        const e = this.leaveArray[t];
        ((e.mouseleave = () => {
          this.body &&
            !styleMenu.isopen &&
            (this.body.onMouseLeave(),
            "projects" === e.name && WEBGL.screen.onMouseLeaveRay());
        }),
          e.el.addEventListener("mouseleave", e.mouseleave));
      }
      for (let t = 0; t < this.enterArray.length; t++) {
        const e = this.enterArray[t];
        ((e.mouseenter = () => {
          this.body &&
            !styleMenu.isopen &&
            this.body.onMouseEnter(e.geometry, e.rotation);
        }),
          e.el.addEventListener("mouseenter", e.mouseenter));
      }
      this.ready = !0;
    },
    onDestroy() {
      this.ready = !1;
      for (let t = 0; t < this.leaveArray.length; t++) {
        const e = this.leaveArray[t];
        e.mouseleave &&
          (e.el.removeEventListener("mouseleave", e.mouseleave),
          (e.mouseleave = null));
      }
      this.leaveArray = [];
      for (let t = 0; t < this.enterArray.length; t++) {
        const e = this.enterArray[t];
        e.mouseenter &&
          (e.el.removeEventListener("mouseenter", e.mouseenter),
          (e.mouseenter = null));
      }
      this.enterArray = [];
    },
    timer: null,
    onScroll(t, e) {},
    onUpdate() {
      this.body && this.body.onUpdate();
    },
  };
}
