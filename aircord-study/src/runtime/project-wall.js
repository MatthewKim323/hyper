// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";
import shader1 from "../shaders/project-wall-1.glsl?raw";
import shader2 from "../shaders/project-wall-2.glsl?raw";
import shader3 from "../shaders/project-wall-3.glsl?raw";
import shader4 from "../shaders/project-wall-4.glsl?raw";
import shader5 from "../shaders/project-wall-5.glsl?raw";
import shader6 from "../shaders/project-wall-6.glsl?raw";

export default function initialize() {
  "use strict";
  var n = THREE;
  class r extends n.MeshStandardMaterial {
    constructor(t) {
      const {
        enterPower_010: e,
        enterPower_01_10: i,
        mouseEnterZ: n,
        mouseNoiseRatio: r,
        mouseNoiseDisp: s,
        mouseNoisePower: a,
        mouseNoiseDir: o,
        vigAlpha: l,
        cylinderCenter: h,
        cylinderDirection: c,
        cylinderRadiusTop: u,
        cylinderRadiusBottom: d,
        cylinderHeight: p,
        tvNoizePower: m,
        tvNoizeDisp: f,
        mozX: g,
        mozPower: v,
        fogAlpha: _,
        fogColor: y,
        data: x,
        dir: S,
        radius: w,
        width: E,
        height: b,
        rotate: T,
        angleRange: M,
        curvePower: A,
        zoomPower: R,
        borderWidth: P,
        resolution: L,
        offsetPower: C,
        i_resolution: I,
        ...N
      } = t;
      (super(N),
        (this.props = t),
        (this.anim = { enter: {}, leave: {} }),
        (this.userData.uniforms = {
          fogAlpha: { value: this.props.fogAlpha || 0 },
          fogColor: { value: this.props.fogColor || this.props.color },
          mozX: { value: this.props.mozX || 60 },
          mozPower: { value: this.props.mozPower },
          dir: { value: this.props.dir || 1 },
          radius: { value: this.props.radius || 0 },
          width: { value: this.props.width || 0 },
          height: { value: this.props.height || 0 },
          rotate: { value: this.props.rotate || 0 },
          angleRange: { value: this.props.angleRange || 0 },
          curvePower: { value: this.props.curvePower || 1 },
          zoomPower: { value: this.props.zoomPower || 0 },
          borderWidth: { value: this.props.borderWidth || 1 },
          resolution: { value: this.props.resolution || { x: 0, y: 0 } },
          offsetPower: { value: this.props.offsetPower || 0 },
          i_resolution: {
            value: this.props.i_resolution || { x: 0, y: 0 },
          },
          mouseEnterZ: { value: this.props.mouseEnterZ || 1 },
          enterPower_010: { value: this.props.enterPower_010 || 0 },
          enterPower_01_10: { value: this.props.enterPower_01_10 || 0 },
          tvNoizePower: { value: this.props.tvNoizePower || 0.05 },
          tvNoizeDisp: { value: this.props.tvNoizePower || 1024 },
          mouseNoiseRatio: { value: this.props.mouseNoiseRatio },
          mouseNoiseDisp: { value: this.props.mouseNoiseDisp },
          mouseNoisePower: { value: this.props.mouseNoisePower },
          mouseNoiseDir: { value: this.props.mouseNoiseDir },
          vigAlpha: { value: this.props.vigAlpha },
          cylinderCenter: { value: this.props.cylinderCenter },
          cylinderDirection: { value: this.props.cylinderDirection },
          cylinderRadiusTop: { value: this.props.cylinderRadiusTop },
          cylinderRadiusBottom: {
            value: this.props.cylinderRadiusBottom,
          },
          cylinderHeight: { value: this.props.cylinderHeight },
        }),
        (this.onBeforeCompile = (t) => {
          (Object.assign(t.uniforms, this.userData.uniforms),
            (t.vertexShader = shader1),
            (t.fragmentShader = shader2));
        }));
    }
  }
  var s = THREE;
  class a extends s.MeshStandardMaterial {
    constructor(t) {
      const {
        fogColor: e,
        fogAlpha: i,
        data: n,
        dir: r,
        radius: s,
        width: a,
        height: o,
        rotate: l,
        angleRange: h,
        curvePower: c,
        zoomPower: u,
        ...d
      } = t;
      (super(d),
        (this.props = t),
        (this.anim = { enter: {}, leave: {} }),
        (this.userData.uniforms = {
          dir: { value: this.props.dir || 1 },
          radius: { value: this.props.radius || 0 },
          width: { value: this.props.width || 0 },
          height: { value: this.props.height || 0 },
          rotate: { value: this.props.rotate || 0 },
          angleRange: { value: this.props.angleRange || 0 },
          curvePower: { value: this.props.angleRange || 1 },
          zoomPower: { value: this.props.zoomPower || 0 },
          fogColor: { value: this.props.fogColor || this.props.color },
          fogAlpha: { value: this.props.fogAlpha || 0 },
        }),
        (this.onBeforeCompile = (t) => {
          (Object.assign(t.uniforms, this.userData.uniforms),
            (t.fragmentShader = shader3),
            (t.vertexShader = shader4));
        }));
    }
  }
  var o = THREE;
  class l {
    constructor(t = {}) {
      ((this.props = t),
        (this.anim = { enter: {}, leave: {} }),
        (this.fontScale = this.props.fontScale || 0.06),
        (this.geometory = this.props.geometory),
        (this.titleStr = ""));
      for (let t = 0; t < this.props.titleArray.length; t++) {
        const e = this.props.titleArray[t],
          i = htmlDecode(e);
        this.titleStr += i.toUpperCase() + "\n";
      }
      (this.onInitTexture(), this.onInit());
    }
    onInitTexture() {
      ((this.canvas = document.createElement("canvas")),
        (this.canvas.width = WW),
        (this.canvas.height =
          this.canvas.width *
          (WEBGL.screen.params.screen.h / WEBGL.screen.params.screen.w)),
        (this.ctx = this.canvas.getContext("2d")),
        this.drawTitle(),
        (this.texture = new o.CanvasTexture(this.canvas)),
        (this.texture.needsUpdate = !1),
        (this.texture.minFilter = o.LinearFilter),
        (this.texture.magFilter = o.LinearFilter),
        (this.texture.format = o.RGBAFormat));
    }
    drawTitle() {
      ((this.fontSize = this.canvas.width * this.fontScale),
        (this.lineHeight = 0.8),
        CanvasTextWrapper(this.canvas, this.titleStr, {
          font: "400 " + this.fontSize + "px 'NeueMontreal', sans-serif",
          allowNewLine: !0,
          verticalAlign: "middle",
          textAlign: "center",
          lineHeight: this.fontSize * this.lineHeight + "px",
        }));
    }
    drawInfo() {
      (this.ctx.restore(),
        this.ctx.resetTransform(),
        (this.infoFontSize = 0.5 * this.fontSize),
        (this.ctx.font =
          "400 " + this.infoFontSize + "px 'NeueMontreal', sans-serif"),
        (this.ctx.textAlign = "center"),
        (this.ctx.textBaseline = "middle"));
      let t = 0.5 * this.canvas.width,
        e = this.canvas.height - 2 * this.infoFontSize;
      (this.ctx.fillText("CLIENT : " + this.props.data.client, t, e),
        this.ctx.fillText(
          "CATEGORY : " + this.props.data.category,
          t,
          e - this.infoFontSize * this.lineHeight,
        ));
    }
    onInit() {
      ((this.material = new o.ShaderMaterial({
        transparent: !0,
        uniforms: {
          tDiffuse: { value: this.texture },
          mozX: { value: this.props.mozX || 60 },
          mozPower: { value: this.props.mozPower || 0.05 },
          color: { value: COLOR.table.title.three },
          fontScale: { value: this.fontScale },
          opacity: { value: 0 },
          radius: { value: 0 },
          width: { value: 0 },
          height: { value: 0 },
          angleRange: { value: 0 },
          curvePower: { value: 0 },
          zoomPower: { value: 0 },
          rotate: { value: 0 },
          titleArrayLength: { value: this.props.titleArray.length },
          enterPower_010: { value: this.props.enterPower_010 || 0 },
          enterPower_01_10: { value: this.props.enterPower_01_10 || 0 },
          depthWrite: !1,
          depthTest: !0,
          paraPower: { value: 1 },
        },
        vertexShader: shader5,
        fragmentShader: shader6,
      })),
        DETECT.device.any && (this.material.uniforms.paraPower.value = 0),
        (this.mesh = new o.Mesh(this.geometory, this.material)),
        (this.mesh.renderOrder = 10));
    }
    onUpdate() {
      ((this.material.uniforms.opacity.value =
        PAGE_TRANSITION.anim.ptFadeTitle *
        PAGE_TRANSITION.page.projects.ptWebGl),
        this.material.uniforms.opacity.value *
          this.material.uniforms.enterPower_01_10.value ==
        0
          ? (this.mesh.visible = !1)
          : (this.mesh.visible = !0));
    }
  }
  var h = THREE;
  WEBGL.screen = {
    ready: !1,
    visible: !0,
    meshes: [],
    segmentW: 128,
    segmentH: 8,
    params: {
      slit: { ratio: 0.5, disp: { x: 0, y: 0 } },
      mozX: 40,
      mozPower: 0.05,
      screen: { w: 3, h: 1, roughness: 1, metalness: 0 },
      padding: { degOrigin: 2, deg: 0, x: 0, scale: { x: 0.5, y: 1 } },
      frame: { roughness: 1, metalness: 0 },
      borderWidth: 0.2,
      cylinder: {
        deg: 0,
        radius: 0.8,
        center: { x: 0, y: 0, z: 1 },
        direction: { x: 0, y: 0, z: -1 },
        radiusTop: 0,
        radiusBottom: 0.25,
        height: 1,
      },
      mouse: {
        ratio: 0.5,
        power: { x: 0.2, y: 0 },
        disp: { x: 0.2, y: 0 },
        enter: { z: 1 },
      },
      speed: 0.1,
      width: 0,
      height: 0,
      origin: { width: 0, height: 0 },
      progress: 0,
      scale: 1,
      radius: 0,
      degWrap: 60,
      degInner: 0,
      angleRange: 0,
      tvNoizePower: 0.1,
      tvNoizeDisp: Math.floor(WH),
      curvePower: 1,
      zoomPower: 0,
      offsetPower: 0.5,
      fontScale: 0.065,
    },
    setForDevice() {
      (DETECT.device.any &&
        ((this.params.mozPower = 0), (this.params.padding.scale.y = 2)),
        WW <= MOBILE_WIDTH &&
          ((this.params.screen.h = 1),
          (this.params.screen.w = 2.5),
          (this.params.padding.degOrigin = 3)));
    },
    once() {
      (this.setForDevice(),
        (this.stage = new h.Group()),
        PROJECTS.json.forEach((t, e) => {
          let i = null,
            n = null,
            r = null,
            s = getVideoSrc(t.video.hd, t.video.hd, t.video.sd, t.video.hd),
            a = getSrc(t.image.d1x, t.image.d1x, t.image.mob, t.image.d1x);
          s &&
            a &&
            (DETECT_INIT.islow || DETECT.device.any
              ? (r = new h.TextureLoader().load(a))
              : ((i = document.createElement("video")),
                (i.src = s),
                (i.preload = "metadata"),
                (i.muted = !0),
                (i.loop = !0),
                i.setAttribute("crossorigin", "anonymous"),
                i.setAttribute("muted", ""),
                i.setAttribute("playsinline", "playsinline"),
                (n = new h.VideoTexture(i)),
                (i.currentTime = 0.01)),
            this.meshes.push({
              mouseenter: {
                timer: null,
                screen_010: { tl: null, power: 0 },
                screen_01_10: { tl: null, power: 0 },
                title_01_10: { tl: null, power: 0 },
              },
              mouseleave: {
                timer: null,
                screen_010: { tl: null },
                screen_01_10: { tl: null },
                title_01_10: { tl: null },
              },
              data: t,
              index: e,
              width: Number(t.width),
              height: Number(t.height),
              group: new h.Group(),
              deg: 0,
              rotate: 0,
              frame: null,
              screen: null,
              image: { src: a, timer: null, tex: r },
              video: {
                el: i,
                src: s,
                play: { func: null, flg: !1 },
                playing: { func: null, flg: !1 },
                canplay: { func: null, flg: !1 },
                timer: null,
                tex: n,
              },
              param: { curvePower: 1, zoomPower: 0 },
            }));
        }),
        (this.params.degTotal = this.params.degWrap * this.meshes.length),
        this.onInitScreens(),
        WEBGL.scene.add(this.stage),
        this.onResize(),
        (this.ready = !0));
    },
    onLoadTexture() {},
    onInit(t = PAGE_TRANSITION.current) {},
    casterOriginalPositions: [],
    casterTransformPositions: [],
    onInitScreens() {
      ((this.screenGeometry = new h.PlaneGeometry(
        1,
        1,
        this.segmentW,
        this.segmentH,
      )),
        (this.frameGeometry = new h.BoxGeometry(
          1,
          1,
          0.3,
          this.segmentW,
          1,
          1,
        )),
        (this.casterGeometory = new h.PlaneGeometry(1, 1, 4, 1)),
        (this.casterOriginalPositions = Float32Array.from(
          this.casterGeometory.getAttribute("position").array,
        )),
        (this.casterTransformPositions = Float32Array.from(
          this.casterGeometory.getAttribute("position").array,
        )));
      const t = new h.PlaneGeometry(1, 1, 8, 1);
      (this.meshes.forEach((e, i) => {
        let n = e.video.tex ? e.video.tex : e.image.tex;
        const s = new r({
          data: e,
          color: "#fff",
          transparent: !0,
          roughness: 1,
          metalness: 0,
          dir: i % 2 != 0 ? 1 : -1,
          mozX: this.params.mozX,
          mozPower: this.params.mozPower,
          map: n,
          enterPower_010: 0,
          enterPower_01_10: 0,
          mouseEnterZ: 0.5,
          mouseNoiseRatio: this.params.mouse.ratio,
          mouseNoiseDisp: this.params.mouse.disp,
          mouseNoisePower: this.params.mouse.power,
          mouseNoiseDir: { x: 0, y: 0 },
          vigAlpha: 1,
          fogAlpha: 0,
          fogColor: COLOR.table.bg.three,
        });
        ((e.screen = { mesh: new h.Mesh(this.screenGeometry, s) }),
          e.group.add(e.screen.mesh));
        const o = new a({
          data: e,
          color: COLOR.table.screen.three,
          fogAlpha: 0,
          fogColor: COLOR.table.bg.three,
          transparent: !0,
          roughness: 0.2,
          metalness: 0,
          dir: i % 2 != 0 ? 1 : -1,
        });
        ((e.frame = { mesh: new h.Mesh(this.frameGeometry, o) }),
          e.group.add(e.frame.mesh),
          (e.frame.mesh.renderOrder = -1));
        const c = new h.ShaderMaterial({
          transparent: !0,
          uniforms: { color: { value: new h.Color("#f00") } },
          vertexShader:
            "\n\t\t\t\t\tvarying vec2 vUv;\n\t\t\t\t\tvoid main(){\n\t\t\t\t\t\tvUv = uv;\n\t\t\t\t\t\tgl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);\n\t\t\t\t\t}\n\t\t\t\t\t",
          fragmentShader:
            "\n\t\t\t\t\tuniform vec3 color;\n\t\t\t\t\tvarying vec2 vUv;\n\t\t\t\t\tvoid main() {\n\t\t\t\t\t\tgl_FragColor = vec4(0.0);\n\t\t\t\t\t}\n\t\t\t\t\t",
        });
        ((e.caster = {
          isMouseOver: !1,
          mesh: new h.Mesh(this.casterGeometory, c),
        }),
          (e.caster.mesh.visible = !1),
          e.group.add(e.caster.mesh),
          (e.title = new l({
            data: e.data,
            fontScale: this.params.fontScale,
            titleArray: e.data.titleArray,
            geometory: t,
            enterPower_01_10: 0,
            mouseEnterZ: 0.5,
            mozX: this.params.mozX,
            mozPower: this.params.mozPower,
          })),
          e.group.add(e.title.mesh),
          this.stage.add(e.group));
      }),
        DETECT.device.any || this.onInitEventsForDesktop());
    },
    onInitEventsForDesktop() {
      this.meshes.forEach((t) => {
        ((t.onMouseEnter = () => {
          (clearTimeout(t.mouseenter.timer),
            clearTimeout(t.mouseleave.timer),
            $html.classList.add("is-hv-a"),
            (t.mouseenter.timer = setTimeout(() => {
              (styleProjects && styleProjects.onMouseEnter(t.data),
                t.video.el && t.video.el.paused && onPlayVideo(t.video.el),
                (t.mouseenter.screen_010.tl = gsap.timeline()),
                t.mouseenter.screen_010.tl.to(t.mouseenter.screen_010, {
                  duration: 0.6,
                  ease: "power2.inOut",
                  power: 0.5,
                }),
                t.mouseenter.screen_010.tl.to(t.mouseenter.screen_010, {
                  duration: 1.8,
                  ease: "power2.out",
                  power: 0,
                }),
                (t.mouseenter.screen_01_10.tl = gsap.to(
                  t.mouseenter.screen_01_10,
                  { duration: 1.8, ease: "power2.out", power: 1 },
                )),
                (t.mouseenter.title_01_10.tl = gsap.to(
                  t.mouseenter.title_01_10,
                  { duration: 1.8, ease: "power2.out", power: 1 },
                )));
            }, 200)));
        }),
          (t.onMouseLeave = () => {
            (clearTimeout(t.mouseenter.timer),
              clearTimeout(t.mouseleave.timer),
              $html.classList.remove("is-hv-a"),
              t.video.el &&
                !PAGE_TRANSITION.ing &&
                (t.video.el.paused || t.video.el.pause()),
              t.mouseenter.screen_01_10.tl &&
                t.mouseenter.screen_01_10.tl.kill(),
              (t.mouseenter.screen_01_10.tl = null),
              gsap.to(t.mouseenter.screen_01_10, {
                duration: 1.2,
                ease: "power2.out",
                power: 0,
              }),
              t.mouseenter.title_01_10.tl && t.mouseenter.title_01_10.tl.kill(),
              (t.mouseenter.title_01_10.tl = null),
              gsap.to(t.mouseenter.title_01_10, {
                duration: 0.6,
                ease: "power2.out",
                power: 0,
              }));
          }));
      });
    },
    onClick(t = 0, e = 0) {
      const i = t + 0.5 * ((1 * WEBGL.width) / RESCALE - window.innerWidth);
      ((WEBGL.scenes.first.mouse.x =
        (i / ((1 * WEBGL.width) / RESCALE)) * 2 - 1),
        (WEBGL.scenes.first.mouse.y =
          (-e / ((1 * WEBGL.height) / RESCALE)) * 2 + 1),
        WEBGL.scenes.first.raycaster.setFromCamera(
          WEBGL.scenes.first.mouse,
          WEBGL.scenes.cameras.models.camera,
        ));
      for (let t = 0; t < this.meshes.length; t++) {
        const e = this.meshes[t];
        if (
          PAGE_TRANSITION.ing ||
          styleMenu.isopen ||
          !(
            this.visible &&
            PAGE_TRANSITION.mixAnim.ptZoom >= 0.99 &&
            PAGE_TRANSITION.page.single.ptWebGl <= 0.05
          )
        )
          return !1;
        WEBGL.scenes.first.raycaster.intersectObject(e.caster.mesh).length >
          0 &&
          ("ja" === styleLang.data.current
            ? barba.go(e.data.permalink.ja)
            : barba.go(e.data.permalink.en));
      }
    },
    dom: {
      padding: { x: 0 },
      radius: 0,
      degInner: 0,
      width: 0,
      height: 0,
      sync: { width: 0, height: 0, padding: 0 },
    },
    acc: {
      s: getParam("sc-acc-s") ? Number(getParam("sc-acc-s")) : 3,
      e: getParam("sc-acc-e") ? Number(getParam("sc-acc-e")) : "power3.out",
      min: getParam("sc-acc-min") ? Number(getParam("sc-acc-min")) : 0,
      max: getParam("sc-acc-max") ? Number(getParam("sc-acc-max")) : 0.5,
      ratio: getParam("sc-acc-ratio") ? Number(getParam("sc-acc-ratio")) : 0.3,
    },
    onResize() {
      const t = 1 / (this.params.mozX / WW);
      ((this.params.slit.disp.x = 28e-6 * t),
        (this.params.slit.disp.y = 0),
        (this.width = WEBGL.width),
        (this.height = WEBGL.height),
        (this.params.padding.deg = this.params.padding.degOrigin),
        (this.params.degInner = this.params.degWrap - this.params.padding.deg));
      const e = Math.min(0.5 * this.width, this.height);
      if (MOUSE.enable) {
        const t = clamp(PAGE_SCROLL_PROJECTS.acc, this.acc.min, this.acc.max);
        this.params.radius =
          e + e * t * this.acc.ratio * PAGE_TRANSITION.page.projects.ptWebGl;
      } else this.params.radius = e;
      ((this.params.origin.width =
        ((this.params.degInner * Math.PI) / 180) * this.params.radius),
        (this.params.origin.height =
          this.params.origin.width *
          (this.params.screen.h / this.params.screen.w)),
        (this.params.padding.x =
          ((this.params.padding.deg * Math.PI) / 180) * this.params.radius),
        (this.dom.degInner =
          this.params.degWrap - this.params.padding.degOrigin),
        (this.dom.radius = Math.min(0.5 * this.width, this.height)),
        (this.dom.width =
          ((this.dom.degInner * Math.PI) / 180) * this.dom.radius),
        (this.dom.height =
          this.dom.width * (this.params.screen.h / this.params.screen.w)),
        (this.dom.padding.x =
          ((this.params.padding.degOrigin * Math.PI) / 180) * this.dom.radius),
        (this.dom.sync.width = (1 * this.dom.width) / RESCALE),
        (this.dom.sync.height = (1 * this.dom.height) / RESCALE),
        (this.dom.sync.padding = (1 * this.dom.padding.x) / RESCALE),
        $wrap.style.setProperty("--project-w", this.dom.sync.width / WW),
        $wrap.style.setProperty("--project-h", this.dom.sync.height / WW),
        $wrap.style.setProperty("--project-x", this.dom.sync.padding / WW));
    },
    onUpdateBefore() {
      ((SCREEN_PADDING.x = this.params.padding.x * this.params.padding.scale.x),
        (SCREEN_PADDING.y =
          this.params.padding.x * this.params.padding.scale.y),
        (GROUND.y =
          -this.params.origin.height * this.params.scale * 0.5 -
          SCREEN_PADDING.y),
        this.onResize());
    },
    time: 0,
    getProgress() {
      isFiniteAndNotNaN(PAGE_SCROLL_PROJECTS.scroll.p) &&
        isNumber(PAGE_SCROLL_PROJECTS.scroll.p) &&
        (this.getBuffer(),
        (this.progress = PAGE_SCROLL_PROJECTS.scroll.p + this.bufferProgress));
    },
    currnetIndex: 0,
    bufferProgress: 0,
    getBuffer() {
      let t = PAGE_SCROLL_PROJECTS.scroll.p,
        e = this.currnetIndex / this.meshes.length;
      this.bufferProgress =
        this.getShortestDistance(t, e) * PAGE_TRANSITION.page.single.ptWebGl;
    },
    getShortestDistance(t, e) {
      let i = e - t,
        n = e > t ? e - (t + 1) : e + 1 - t;
      return Math.abs(i) <= Math.abs(n) ? i : n;
    },
    onReset() {
      this.time = 0;
    },
    onUpdate() {
      if (
        ("home" === PAGE_TRANSITION.current.name && (this.time += 1),
        this.onUpdateBefore(),
        this.onUpdateForTransition(),
        !this.stage.visible)
      )
        return !1;
      const t = this.width / this.params.origin.width - 1,
        e = this.height / this.params.origin.height - 1;
      ((this.params.scale =
        1 + Math.max(t, e) * PAGE_TRANSITION.page.single.ptWebGl),
        this.getProgress());
      let i = (-this.progress * this.params.degTotal) % this.params.degTotal;
      i -=
        ((this.time * this.params.speed) % this.params.degTotal) *
        (1 - PAGE_TRANSITION.anim.ptZoomIn);
      for (let t = 0; t < this.meshes.length; t++) {
        const e = this.meshes[t];
        if (
          ((e.rotate = (this.params.degWrap * t + i) % this.params.degTotal),
          Math.abs(e.rotate) <= 180 ||
          Math.abs(e.rotate) >= this.params.degTotal - 180
            ? ((e.group.visible = !0), (e.group.position.y = 0))
            : ((e.group.visible = !1), (e.group.position.y = WEBGL.height)),
          (e.group.position.x =
            -4 * this.dom.padding.x * PAGE_TRANSITION.page.single.ptWebGl),
          t === this.currnetIndex)
        ) {
          let t =
              this.params.origin.height * this.params.scale -
              (this.params.origin.height * this.params.scale - WEBGL.height) *
                PAGE_TRANSITION.page.single.ptWebGl,
            i =
              this.params.origin.width * this.params.scale -
              (this.params.origin.width * this.params.scale - WEBGL.width) *
                PAGE_TRANSITION.page.single.ptWebGl;
          ((e.screen.mesh.material.userData.uniforms.width.value = i),
            (e.screen.mesh.material.userData.uniforms.height.value = t),
            (e.frame.mesh.material.userData.uniforms.width.value = i),
            (e.frame.mesh.material.userData.uniforms.height.value = t),
            (e.screen.mesh.material.userData.uniforms.resolution.value.x = i),
            (e.screen.mesh.material.userData.uniforms.resolution.value.y = t),
            (e.screen.mesh.visible = !0),
            (e.frame.mesh.visible = !0));
        } else
          ((e.screen.mesh.material.userData.uniforms.width.value =
            this.params.origin.width),
            (e.screen.mesh.material.userData.uniforms.height.value =
              this.params.origin.height),
            (e.frame.mesh.material.userData.uniforms.width.value =
              this.params.origin.width),
            (e.frame.mesh.material.userData.uniforms.height.value =
              this.params.origin.height),
            (e.screen.mesh.material.userData.uniforms.resolution.value.x =
              this.params.origin.width),
            (e.screen.mesh.material.userData.uniforms.resolution.value.y =
              this.params.origin.height),
            PAGE_TRANSITION.page.single.ptWebGl > 0.55
              ? ((e.screen.mesh.visible = !1), (e.frame.mesh.visible = !1))
              : ((e.screen.mesh.visible = !0), (e.frame.mesh.visible = !0)));
        (DETECT.device.any
          ? ((e.screen.mesh.material.userData.uniforms.enterPower_010.value =
              PAGE_TRANSITION.anim.ptFadeTitle),
            (e.screen.mesh.material.userData.uniforms.enterPower_01_10.value =
              PAGE_TRANSITION.anim.ptFadeTitle))
          : ((e.screen.mesh.material.userData.uniforms.enterPower_010.value =
              e.mouseenter.screen_010.power),
            (e.screen.mesh.material.userData.uniforms.enterPower_01_10.value =
              e.mouseenter.screen_01_10.power)),
          this.onUpdateScreen(e),
          this.onUpdateFrame(e),
          e.title &&
            (DETECT.device.any
              ? ((e.title.mesh.material.uniforms.enterPower_010.value =
                  PAGE_TRANSITION.anim.ptFadeTitle),
                (e.title.mesh.material.uniforms.enterPower_01_10.value =
                  PAGE_TRANSITION.anim.ptFadeTitle))
              : ((e.title.mesh.material.uniforms.enterPower_010.value =
                  e.mouseenter.title_01_10.power),
                (e.title.mesh.material.uniforms.enterPower_01_10.value =
                  e.mouseenter.title_01_10.power)),
            e.title.onUpdate()),
          e.title && this.onUpdateTitle(e),
          e.caster &&
            (this.onUpdateCaster(e), DETECT.device.any || this.onUpdateRay(e)));
      }
      (this.onUpdateCurrentIndex(), this.onUpdatePlayVideo());
    },
    onUpdatePlayVideo() {
      for (let t = 0; t < this.meshes.length; t++) {
        const e = this.meshes[t];
        switch (PAGE_TRANSITION.current.name) {
          case "single":
            this.currnetIndex === t &&
              e.video.el &&
              e.video.el.paused &&
              onPlayVideo(e.video.el);
            break;
          case "home":
            DETECT.device.any &&
              e.video.el &&
              (e.video.el.paused || e.video.el.pause());
            break;
          case "projects":
            DETECT.device.any &&
              (Math.abs(e.rotate) <= 90 ||
              Math.abs(e.rotate) >= this.params.degTotal - 90
                ? e.video.el && e.video.el.paused && onPlayVideo(e.video.el)
                : e.video.el && (e.video.el.paused || e.video.el.pause()));
        }
      }
    },
    onUpdateCurrentIndex() {
      this.currnetIndex = 0;
      for (let t = 0; t < this.meshes.length; t++) {
        const e = this.meshes[t];
        if (PAGE_TRANSITION.flag.isSingleToSingleFromFooter)
          e.data.slug === PAGE_TRANSITION.next.slug
            ? ((this.currnetIndex = t), (e.group.visible = !0))
            : (e.group.visible = !1);
        else if ("single" === PAGE_TRANSITION.current.name)
          e.data.slug === PAGE_TRANSITION.current.slug &&
            (this.currnetIndex = t);
        else
          (e.data.slug !== PAGE_TRANSITION.current.slug &&
            e.data.slug !== PAGE_TRANSITION.prev.slug) ||
            (this.currnetIndex = t);
      }
    },
    onUpdateScreen(t) {
      ((t.screen.mesh.material.opacity =
        1 - 0.3 * PAGE_TRANSITION.page.home.ptWebGl * COLOR.power.dark),
        (t.screen.mesh.material.roughness =
          this.params.screen.roughness *
          (1 - PAGE_TRANSITION.page.single.ptWebGl)),
        (t.screen.mesh.material.metalness =
          this.params.screen.metalness *
          (1 - PAGE_TRANSITION.page.single.ptWebGl)),
        (t.screen.mesh.material.userData.uniforms.radius.value =
          this.params.radius),
        (t.screen.mesh.material.userData.uniforms.fogAlpha.value = clamp(
          PAGE_TRANSITION.page.home.ptWebGl +
            PAGE_TRANSITION.page.single.ptWebGl +
            PAGE_TRANSITION.page.projects.ptWebGl,
          0,
          1,
        )),
        (t.screen.mesh.material.userData.uniforms.angleRange.value =
          this.params.degInner * (Math.PI / 180)),
        (t.screen.mesh.material.userData.uniforms.curvePower.value =
          1 - PAGE_TRANSITION.page.single.ptWebGl),
        (t.screen.mesh.material.userData.uniforms.zoomPower.value =
          PAGE_TRANSITION.page.single.ptWebGl),
        (t.screen.mesh.material.userData.uniforms.offsetPower.value =
          (1 - PAGE_TRANSITION.page.single.ptWebGl) * this.params.offsetPower),
        (t.screen.mesh.material.userData.uniforms.rotate.value = t.rotate),
        (t.screen.mesh.material.userData.uniforms.borderWidth.value =
          this.params.borderWidth * (1 - PAGE_TRANSITION.page.single.ptWebGl)),
        (t.screen.mesh.material.userData.uniforms.i_resolution.value.x =
          t.width),
        (t.screen.mesh.material.userData.uniforms.i_resolution.value.y =
          t.height),
        (t.screen.mesh.material.userData.uniforms.tvNoizePower.value =
          this.params.tvNoizePower * (1 - PAGE_TRANSITION.page.single.ptWebGl)),
        (t.screen.mesh.material.userData.uniforms.vigAlpha.value =
          1 - COLOR.power.light));
    },
    onUpdateFrame(t) {
      ((t.frame.mesh.material.userData.uniforms.radius.value =
        this.params.radius),
        (t.frame.mesh.material.userData.uniforms.angleRange.value =
          this.params.degInner * (Math.PI / 180)),
        (t.frame.mesh.material.userData.uniforms.curvePower.value =
          1 - PAGE_TRANSITION.page.single.ptWebGl),
        (t.frame.mesh.material.userData.uniforms.zoomPower.value =
          PAGE_TRANSITION.page.single.ptWebGl),
        (t.frame.mesh.material.userData.uniforms.rotate.value = t.rotate),
        (t.frame.mesh.material.userData.uniforms.fogAlpha.value = clamp(
          PAGE_TRANSITION.page.home.ptWebGl +
            PAGE_TRANSITION.page.projects.ptWebGl,
          0,
          1,
        )),
        (t.frame.mesh.material.color.r = COLOR.table.screen.three.r),
        (t.frame.mesh.material.color.g = COLOR.table.screen.three.g),
        (t.frame.mesh.material.color.b = COLOR.table.screen.three.b));
    },
    onUpdateTitle(t) {
      ((t.title.mesh.material.uniforms.radius.value = this.params.radius),
        (t.title.mesh.material.uniforms.width.value = this.params.origin.width),
        (t.title.mesh.material.uniforms.height.value =
          this.params.origin.height),
        (t.title.mesh.material.uniforms.angleRange.value =
          this.params.degInner * (Math.PI / 180)),
        (t.title.mesh.material.uniforms.curvePower.value =
          1 - PAGE_TRANSITION.page.single.ptWebGl),
        (t.title.mesh.material.uniforms.zoomPower.value =
          PAGE_TRANSITION.page.single.ptWebGl),
        (t.title.mesh.material.uniforms.rotate.value = t.rotate));
    },
    onUpdateCaster(t) {
      const e = this.params.radius,
        i = this.params.degInner * (Math.PI / 180),
        n = this.params.origin.width,
        r = this.params.origin.height,
        s = (t.rotate + 90) * (Math.PI / 180),
        a = e * Math.cos(s),
        o = e * Math.sin(s);
      ((t.caster.mesh.position.x = -a),
        (t.caster.mesh.position.z = o - e),
        (t.caster.mesh.rotation.y = t.rotate * (Math.PI / 180)));
      const l = t.caster.mesh.geometry.attributes.position.array;
      let h = 0;
      for (let t = 0; t < this.casterTransformPositions.length; t += 3) {
        const s = this.casterOriginalPositions[t] * i;
        ((this.casterTransformPositions[t] =
          this.casterOriginalPositions[t] * n * 0 + 0 + e * Math.sin(s) * 1),
          (this.casterTransformPositions[t + 1] =
            this.casterOriginalPositions[t + 1] * r),
          (this.casterTransformPositions[t + 2] =
            this.casterOriginalPositions[t + 2] - e * (1 - Math.cos(s)) * 1),
          l[t] != this.casterTransformPositions[t] && h++,
          l[t + 1] != this.casterTransformPositions[t + 1] && h++,
          l[t + 2] != this.casterTransformPositions[t + 2] && h++);
      }
      if (0 != h) {
        for (let t = 0; t < l.length; t += 3)
          ((l[t] = this.casterTransformPositions[t]),
            (l[t + 1] = this.casterTransformPositions[t + 1]),
            (l[t + 2] = this.casterTransformPositions[t + 2]));
        t.caster.mesh.geometry.getAttribute("position").needsUpdate = !0;
      } else t.caster.mesh.geometry.getAttribute("position").needsUpdate = !1;
    },
    onMouseLeaveRay() {
      if (!DETECT.device.any)
        for (let t = 0; t < this.meshes.length; t++) {
          const e = this.meshes[t];
          e.caster && ((e.caster.isMouseOver = !1), e.onMouseLeave());
        }
    },
    onUpdateRay(t) {
      if (MOUSE.enable) {
        var e;
        if (
          PAGE_TRANSITION.ing ||
          styleMenu.isopen ||
          !(
            null !== (e = MOUSE.body) &&
            void 0 !== e &&
            e.isActive &&
            t.group.visible &&
            this.visible &&
            PAGE_TRANSITION.mixAnim.ptZoom >= 0.99 &&
            PAGE_TRANSITION.page.single.ptWebGl <= 0.05
          )
        )
          return !1;
        WEBGL.scenes.first.raycaster.intersectObject(t.caster.mesh).length > 0
          ? t.caster.isMouseOver ||
            ((t.caster.isMouseOver = !0), t.onMouseEnter())
          : t.caster.isMouseOver &&
            ((t.caster.isMouseOver = !1), t.onMouseLeave());
      }
    },
    onUpdateForTransition() {
      const t = this.width * PAGE_TRANSITION.screen.radius;
      let e =
        PAGE_TRANSITION.screen.deg -
        PAGE_TRANSITION.mixAnim.ptShowScreen * PAGE_TRANSITION.screen.deg;
      e = Math.max(e, 0);
      let i = e * (Math.PI / 180),
        n = t * Math.cos(i) - t,
        r = t * Math.sin(i);
      const s =
        3 *
        Math.sin((Math.PI / 180) * 180 * PAGE_TRANSITION.page.single.ptWebGl) *
        (Math.PI / 180);
      (e > 30
        ? (this.visible = !1)
        : ((this.visible = !0),
          (this.stage.position.y =
            n +
            0.01 * WEBGL.height * PAGE_TRANSITION.page.projects.ptWebGl +
            0.2 *
              WEBGL.height *
              clamp(
                1 -
                  (PAGE_TRANSITION.page.projects.ptWebGl +
                    PAGE_TRANSITION.page.home.ptWebGl),
                0,
                1,
              ) *
              (1 - PAGE_TRANSITION.page.single.ptWebGl)),
          (this.stage.position.z = -r),
          (this.stage.rotation.x = -i),
          (this.stage.rotation.y = 0.5 * -i),
          MOUSE.enable &&
            (this.stage.rotation.z =
              s +
              PAGE_TRANSITION.anim.ptZoomIn *
                (1 - PAGE_TRANSITION.page.single.ptWebGl) *
                MOUSE.body.array[0].acceleration.delta.x *
                MOUSE.params.rotation.z *
                (Math.PI / 180))),
        this.stage &&
          (this.stage.visible = this.visible && !WEBGL.floor.isUnderWater));
    },
    onDestroy() {
      $html.classList.remove("is-hv-a");
      for (let t = 0; t < this.meshes.length; t++) {
        const e = this.meshes[t];
        e.caster && (e.caster.isMouseOver = !1);
      }
    },
  };
}
