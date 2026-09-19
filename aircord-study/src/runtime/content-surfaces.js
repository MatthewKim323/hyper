// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";
import shader1 from "../shaders/interface-icons-1.glsl?raw";

export default function initialize() {
  "use strict";
  var n = THREE;
  class r {
    constructor(t = {}) {
      ((this.props = t),
        (this.shown = !1),
        (this.inview = !1),
        (this.visible = !1),
        (this.el = t.el),
        (this.index = t.index || 0),
        (this.pivot = t.pivot),
        (this.dom = { width: 0, height: 0, left: 0, top: 0 }),
        (this.translate = { x: 0, y: 0 }),
        this.onInitInview(),
        (this.pre = {
          s: 0.6,
          e: "power2.out",
          loader: null,
          tex: null,
          tl: null,
          fade: 0,
          src: t.image.src.pre + ".webp?v=" + UNIQ_ID,
        }),
        (this.image = {
          s: 1.5,
          e: "power2.out",
          loader: null,
          tex: null,
          tl: null,
          fade: 0,
          tl2: null,
          moz: 0,
          src: getSrc(
            t.image.src.d1x,
            t.image.src.d2x,
            t.image.src.mob,
            t.image.src.d1x,
            !0,
          ),
        }),
        (this.video = {
          loader: null,
          el: null,
          tex: null,
          tl: null,
          fade: 0,
          event: { el: this.el.querySelector(".js-play-video") },
          src: getVideoSrc(
            t.video.src.d1x,
            t.video.src.d2x,
            t.video.src.mob,
            t.video.src.d1x,
          ),
        }),
        this.onInitMesh(),
        this.onResize(),
        this.onLoadPre());
    }
    onInitInview() {
      ((this.listerner = (t) => {
        t.forEach((t, e) => {
          t.isIntersecting
            ? (this.shown || ((this.shown = !0), this.onShown()),
              (this.el.dataset.shown = 1),
              (this.el.dataset.visible = 1),
              (this.inview = !0))
            : ((this.el.dataset.visible = 0),
              (this.inview = !1),
              this.video.el &&
                this.video.src &&
                "video" === this.props.media &&
                (this.video.el.paused || this.video.el.pause()));
        });
      }),
        (this.observer = new IntersectionObserver(this.listerner, {
          threshold: 0,
        })),
        this.observer.observe(this.el));
    }
    onInitMesh() {
      ((this.geometry = new n.PlaneGeometry(1, 1)),
        (this.material = new n.ShaderMaterial({
          vertexShader: NormalVert,
          fragmentShader: shader1,
          uniforms: {
            i_resolution: {
              value: { x: this.props.width, y: this.props.height },
            },
            uv_resolution: { value: { x: 0, y: 0 } },
            tPreload: { value: null },
            tPreloadFade: { value: 0 },
            tImageMoz: { value: 0 },
            tImageFade: { value: 0 },
            tImageAlpha: {
              value: "video" === this.props.media ? 0.8 : 1,
            },
            tVideoFade: { value: 0 },
            tPreColor: { value: COLOR.table.pre.three },
            tImage: { value: null },
            tVideo: { value: null },
          },
        })),
        (this.mesh = new n.Mesh(this.geometry, this.material)),
        this.props.stage.add(this.mesh));
    }
    onShown() {
      (this.onLoadImage(), this.addEvnets());
    }
    onLoadPre() {
      ((this.pre.uniqId = this.props.uniqId + "_preload"),
        (this.pre.workerListener = (t) => {
          const { id: e, blob: i, error: r } = t.data;
          var s;
          r ||
            (e === this.pre.uniqId &&
              ((this.pre.objectURL = URL.createObjectURL(i)),
              (this.pre.loader = new n.TextureLoader()),
              (this.pre.tex = this.pre.loader.load(this.pre.objectURL, () => {
                (URL.revokeObjectURL(this.pre.objectURL),
                  (this.pre.objectURL = null));
              })),
              null !== (s = this.mesh) &&
                void 0 !== s &&
                s.material &&
                (this.mesh.material.uniforms.tPreload.value = this.pre.tex),
              (this.pre.tl = gsap.to(this.pre, {
                fade: 1,
                duration: this.pre.s,
                ease: this.pre.e,
              }))));
        }),
        GET_IMAGE_WORKER.addEventListener("message", this.pre.workerListener),
        GET_IMAGE_WORKER.postMessage({
          id: this.pre.uniqId,
          url: this.pre.src,
        }));
    }
    onLoadImage() {
      ((this.image.uniqId = this.props.uniqId + "_image"),
        (this.image.workerListener = (t) => {
          const { id: e, blob: i, error: r } = t.data;
          var s;
          r ||
            (e === this.image.uniqId &&
              ((this.image.loader = new n.TextureLoader()),
              (this.image.objectURL = URL.createObjectURL(i)),
              (this.image.tex = this.image.loader.load(
                this.image.objectURL,
                () => {
                  (URL.revokeObjectURL(this.image.objectURL),
                    (this.image.objectURL = null));
                },
              )),
              null !== (s = this.mesh) &&
                void 0 !== s &&
                s.material &&
                (this.mesh.material.uniforms.tImage.value = this.image.tex),
              (this.image.tl = gsap.to(this.image, {
                fade: 1,
                duration: this.image.s,
                ease: this.image.e,
              })),
              (this.image.tl2 = gsap.to(this.image, {
                moz: 1,
                duration: 6,
                ease: "expo.out",
              }))));
        }),
        GET_IMAGE_WORKER.addEventListener("message", this.image.workerListener),
        GET_IMAGE_WORKER.postMessage({
          id: this.image.uniqId,
          url: this.image.src,
        }));
    }
    addEvnets() {
      this.video.event.el &&
        this.video.src &&
        "video" === this.props.media &&
        ((this.onPlayVideo = this.onPlayVideo.bind(this)),
        this.video.event.el.addEventListener("click", this.onPlayVideo));
    }
    onPlayVideo(t) {
      (t.preventDefault(),
        this.video.el ||
          ((this.video.el = document.createElement("video")),
          (this.video.el.preload = "metadata"),
          (this.video.el.loop = !0),
          this.video.el.setAttribute("crossorigin", "anonymous"),
          this.video.el.setAttribute("playsinline", "playsinline"),
          (this.video.el.src = this.video.src),
          (this.video.tex = new n.VideoTexture(this.video.el)),
          (this.mesh.material.uniforms.tVideo.value = this.video.tex),
          (this.onPlayingVideo = this.onPlayingVideo.bind(this)),
          this.video.el.addEventListener("play", this.onPlayingVideo),
          (this.onPauseVideo = this.onPauseVideo.bind(this)),
          this.video.el.addEventListener("pause", this.onPauseVideo)),
        this.video.el.paused
          ? (onPlayVideo(this.video.el),
            WEBGL.icon.body && WEBGL.icon.body.onMouseEnter("pause", "0"))
          : (this.video.el.pause(),
            WEBGL.icon.body && WEBGL.icon.body.onMouseEnter("play", "0")));
    }
    onPlayingVideo() {
      ((this.video.event.el.dataset.uiType = "pause"),
        this.video.event.el.classList.add("is-playing"),
        (this.video.fade = 1));
    }
    onPauseVideo() {
      ((this.video.event.el.dataset.uiType = "play"),
        this.video.event.el.classList.remove("is-playing"));
    }
    onResize() {
      const t = this.pivot.getBoundingClientRect();
      ((this.dom.width = t.width),
        (this.dom.height = t.height),
        (this.dom.left = t.left),
        (this.dom.top = t.top + PAGE_SCROLL_NORMAL.scroll.y));
      let e =
          this.dom.left * RESCALE +
          this.mesh.scale.x / 2 -
          (WW / 2) * RESCALE +
          this.translate.x,
        i =
          -this.dom.top * RESCALE +
          (WH / 2) * RESCALE -
          this.mesh.scale.y / 2 +
          this.translate.y;
      this.mesh &&
        ((this.mesh.scale.x = this.dom.width * RESCALE),
        (this.mesh.scale.y = this.dom.height * RESCALE),
        (this.mesh.position.x = e),
        (this.mesh.position.y = i),
        (this.mesh.material.uniforms.uv_resolution.value.x = this.mesh.scale.x),
        (this.mesh.material.uniforms.uv_resolution.value.y =
          this.mesh.scale.y));
    }
    onUpdate() {
      if (!this.mesh) return !1;
      const t = 0.15 * WH,
        e = this.dom.top - PAGE_SCROLL_NORMAL.scroll.y <= WH + t,
        i = this.dom.top - PAGE_SCROLL_NORMAL.scroll.y > -this.dom.height - t;
      ((this.visible = !0 === this.inview || !0 === (e && i)),
        (this.mesh.visible = this.visible),
        (this.mesh.material.uniforms.tPreloadFade.value = this.pre.fade),
        (this.mesh.material.uniforms.tImageFade.value = this.image.fade),
        (this.mesh.material.uniforms.tImageMoz.value = this.image.moz),
        (this.mesh.material.uniforms.tVideoFade.value = this.video.fade),
        "video" === this.props.media
          ? (this.mesh.material.uniforms.tImageAlpha.value =
              1 - 0.2 * COLOR.power.dark)
          : (this.mesh.material.uniforms.tImageAlpha.value = 1));
    }
    onSlide() {
      if (!this.mesh) return !1;
      const t = this.pivot.getBoundingClientRect();
      this.dom.left = t.left;
      let e =
        this.dom.left * RESCALE +
        this.mesh.scale.x / 2 -
        (WW / 2) * RESCALE +
        this.translate.x;
      this.mesh.position.x = e;
    }
    onScroll(t = PAGE_SCROLL_NORMAL.scroll.y) {
      if (!this.mesh) return !1;
      this.translate.y = t * RESCALE;
      let e =
          this.dom.left * RESCALE +
          this.mesh.scale.x / 2 -
          (WW / 2) * RESCALE +
          this.translate.x,
        i =
          -this.dom.top * RESCALE +
          (WH / 2) * RESCALE -
          this.mesh.scale.y / 2 +
          this.translate.y;
      ((this.mesh.position.x = e), (this.mesh.position.y = i));
    }
    onDestroy() {
      (this.observer &&
        (this.observer.disconnect(this.el),
        (this.observer = null),
        (this.listerner = null)),
        this.video.el &&
          (this.video.el.pause(),
          this.video.el.removeEventListener("play", this.onPlayingVideo),
          this.video.el.removeEventListener("pause", this.onPauseVideo),
          (this.video.el = null)),
        this.mesh &&
          (this.pre.loader && (this.pre.loader = null),
          this.image.loader && (this.image.loader = null),
          this.video.loader && (this.video.loader = null),
          this.pre.tl && this.pre.tl.kill(),
          (this.pre.tl = null),
          this.image.tl && this.image.tl.kill(),
          (this.image.tl = null),
          this.image.tl2 && this.image.tl2.kill(),
          (this.image.tl2 = null),
          this.video.tl && this.video.tl.kill(),
          (this.video.tl = null),
          this.pre.tex && this.pre.tex.dispose(),
          (this.pre.tex = null),
          this.image.tex && this.image.tex.dispose(),
          (this.image.tex = null),
          this.video.tex && this.video.tex.dispose(),
          (this.video.tex = null),
          "undefined" != typeof GET_IMAGE_WORKER &&
            (this.pre.workerListener &&
              (GET_IMAGE_WORKER.removeEventListener(
                "message",
                this.pre.workerListener,
              ),
              (this.pre.workerListener = null)),
            this.pre.objectURL &&
              (URL.revokeObjectURL(this.pre.objectURL),
              (this.pre.objectURL = null)),
            this.image.workerListener &&
              (GET_IMAGE_WORKER.removeEventListener(
                "message",
                this.image.workerListener,
              ),
              (this.image.workerListener = null)),
            this.image.objectURL &&
              (URL.revokeObjectURL(this.image.objectURL),
              (this.image.objectURL = null))),
          this.mesh.geometry && this.mesh.geometry.dispose(),
          this.mesh.material &&
            (Array.isArray(this.mesh.material)
              ? this.mesh.material.forEach((t) => t.dispose())
              : this.mesh.material.dispose()),
          this.props.stage && this.props.stage.remove(this.mesh),
          (this.geometry = null),
          (this.material = null),
          (this.mesh = null)));
    }
  }
  var s = THREE;
  WEBGL.contents = {
    ready: !1,
    visible: !0,
    fbo: null,
    once() {
      ((this.stage = new s.Group()),
        (this.scene = new s.Scene()),
        (this.fbo = new s.WebGLRenderTarget(
          WEBGL.gloablWidth * RES.ratio,
          WEBGL.gloablHeight * RES.ratio,
          { minFilter: s.LinearFilter, magFilter: s.LinearFilter },
        )),
        this.scene.add(this.stage),
        (this.ready = !0),
        this.onInit());
    },
    local: null,
    dom: null,
    array: [],
    onInit(t) {
      if (!this.ready) return !1;
      ((this.local = t || document.querySelector(".c-lc")),
        this.onInitDom(),
        this.onInitSlider());
    },
    onInitDom() {
      ((this.dom = this.local.querySelectorAll('.js-gl[data-group="dom"]')),
        this.dom.forEach((t, e) => {
          const i = t.dataset.media,
            n = t.dataset.layout,
            s = t.querySelector(".js-gl-pivot")
              ? t.querySelector(".js-gl-pivot")
              : t,
            a = new r({
              uniqId: t.dataset.uniqId,
              el: t,
              pivot: s,
              stage: this.stage,
              media: i,
              layout: n,
              width: Number(t.dataset.width),
              height: Number(t.dataset.height),
              image: {
                src: {
                  d2x: t.dataset.imageD2x || null,
                  d1x: t.dataset.imageD1x || null,
                  mob: t.dataset.imageMob || null,
                  pre: t.dataset.imagePre || null,
                },
              },
              video: {
                src: {
                  d2x: t.dataset.videoD2x || null,
                  d1x: t.dataset.videoD1x || null,
                  mob: t.dataset.videoMob || null,
                },
              },
            });
          this.array.push({
            el: t,
            media: i,
            layout: n,
            body: a,
            width: Number(t.dataset.width),
            height: Number(t.dataset.height),
          });
        }));
    },
    slider: null,
    arraySlider: [],
    onInitSlider() {
      for (let t = 0; t < styleSlider.array.length; t++) {
        const e = styleSlider.array[t];
        this.arraySlider.push({
          index: t,
          timer: { scale: null },
          tl: { scale: null },
          slider: e,
          dom: e.wrap.querySelectorAll('.js-gl[data-group="slider"]'),
          array: [],
          group: new s.Group(),
        });
      }
      this.arraySlider.forEach((t) => {
        for (let e = 0; e < t.dom.length; e++) {
          const i = t.dom[e],
            n = i.dataset.media,
            s = i.dataset.layout,
            a = i.querySelector(".js-gl-pivot")
              ? i.querySelector(".js-gl-pivot")
              : i,
            o = new r({
              uniqId: i.dataset.uniqId,
              el: i,
              pivot: a,
              stage: t.group,
              media: n,
              layout: s,
              width: Number(i.dataset.width),
              height: Number(i.dataset.height),
              image: {
                src: {
                  d2x: i.dataset.imageD2x || null,
                  d1x: i.dataset.imageD1x || null,
                  mob: i.dataset.imageMob || null,
                  pre: i.dataset.imagePre || null,
                },
              },
              video: {
                src: {
                  d2x: i.dataset.videoD2x || null,
                  d1x: i.dataset.videoD1x || null,
                  mob: i.dataset.videoMob || null,
                },
              },
            });
          t.array.push({
            el: i,
            media: n,
            layout: s,
            body: o,
            width: Number(i.dataset.width),
            height: Number(i.dataset.height),
          });
        }
        this.scene.add(t.group);
      });
    },
    onResize() {
      for (let t = 0; t < this.array.length; t++) {
        const e = this.array[t];
        e.body && e.body.onResize();
      }
      for (let t = 0; t < this.arraySlider.length; t++) {
        const e = this.arraySlider[t];
        for (let t = 0; t < e.array.length; t++) {
          const i = e.array[t];
          i.body && i.body.onResize();
        }
      }
      this.fbo.setSize(
        WEBGL.gloablWidth * RES.ratio,
        WEBGL.gloablHeight * RES.ratio,
      );
    },
    onRender() {
      (WEBGL.renderer.setRenderTarget(this.fbo),
        WEBGL.renderer.render(this.scene, WEBGL.scenes.cameras.ocam));
    },
    onScroll(t) {
      for (let e = 0; e < this.array.length; e++) {
        const i = this.array[e];
        i.body && i.body.onScroll(t);
      }
      for (let e = 0; e < this.arraySlider.length; e++) {
        const i = this.arraySlider[e];
        for (let e = 0; e < i.array.length; e++) {
          const n = i.array[e];
          n.body && n.body.onScroll(t);
        }
      }
      this.onRender();
    },
    onDragStart(t, e = 0.6, i = "power2.out") {
      const n = this.arraySlider[t];
      n.group &&
        (n.tl.scale && n.tl.scale.kill(),
        (n.tl.scale = null),
        (n.tl.scale = gsap.to(n.group.scale, {
          x: 0.7,
          y: 0.7,
          duration: 0.6,
          ease: "power2.out",
        })));
    },
    onDragging(t, e = 0.6, i = "power2.out") {
      const n = this.arraySlider[t];
      n.group &&
        (n.tl.scale && n.tl.scale.kill(),
        (n.tl.scale = null),
        (n.tl.scale = gsap.to(n.group.scale, {
          x: 0.7,
          y: 0.7,
          duration: e,
          ease: i,
        })));
    },
    onDragEnd(t, e = 2, i = "power4.out", n = 1) {
      const r = this.arraySlider[t];
      r.group &&
        (clearTimeout(r.timer.scale),
        (r.timer.scale = setTimeout(() => {
          r.group &&
            (r.tl.scale && r.tl.scale.kill(),
            (r.tl.scale = null),
            (r.tl.scale = gsap.to(r.group.scale, {
              x: 1,
              y: 1,
              duration: e,
              ease: i,
            })));
        }, 1e3 * n)));
    },
    onSlide() {
      for (let t = 0; t < this.arraySlider.length; t++) {
        const e = this.arraySlider[t];
        for (let t = 0; t < e.array.length; t++) {
          const i = e.array[t];
          i.body && i.body.onSlide();
        }
      }
    },
    onUpdate() {
      for (let t = 0; t < this.array.length; t++) {
        const e = this.array[t];
        e.body && e.body.onUpdate();
      }
      for (let t = 0; t < this.arraySlider.length; t++) {
        const e = this.arraySlider[t];
        for (let t = 0; t < e.array.length; t++) {
          const i = e.array[t];
          i.body && i.body.onUpdate();
        }
      }
    },
    onDestroy() {
      this.array.forEach((t, e) => {
        (t.body && t.body.onDestroy(), (t.body = null));
      });
      for (let t = 0; t < this.arraySlider.length; t++) {
        const e = this.arraySlider[t];
        for (let t = 0; t < e.array.length; t++) {
          const i = e.array[t];
          (i.body && i.body.onDestroy(), (i.body = null));
        }
        (this.scene.remove(e.group), (e.group = null), (e.array = []));
      }
      this.arraySlider = [];
    },
  };
}
