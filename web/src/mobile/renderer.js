// Recovered responsive implementation. See PROVENANCE.md.
import * as THREE from "three";
export default function initialize() {
  var n = THREE;
  ((window.PRE_RENDER = !0),
    (window.WEBGL = {
      scene: new n.Scene(),
      ready: !1,
      canvas: null,
      renderer: null,
      once() {
        ((this.width = WW * RESCALE),
          (this.height = WH * RESCALE),
          (this.aspect = this.width / this.height),
          (this.canvas = document.getElementById("webgl")),
          (this.renderer = new n.WebGLRenderer({
            canvas: this.canvas,
            alpha: !0,
            antialias: !1,
          })),
          (this.renderer.shadowMap.enabled = !1),
          this.renderer.setPixelRatio(RES.ratio),
          (this.scene.background = COLOR.table.bg.three),
          this.mouse && this.mouse.once(),
          this.contents && this.contents.once(),
          this.scenes && this.scenes.once(),
          this.screen && this.screen.once(),
          this.foggy && this.foggy.once(),
          this.archives && this.archives.once(),
          this.lights && this.lights.once(),
          this.particle && this.particle.once(),
          (this.ready = !0),
          this.onResize());
      },
      onLoaded() {
        (this.floor && this.floor.once(),
          this.logo && this.logo.once(),
          this.icon && !DETECT.reduced && this.icon.once());
      },
      onResize() {
        var t, e, i, n, r, s, o, a;
        ((this.width = WW * RESCALE),
          DETECT.device.any &&
            (this.width = Math.max(WW * RESCALE, WH * RESCALE)),
          (this.height = WH * RESCALE),
          (this.aspect = this.width / this.height),
          (this.gloablWidth = (1 * this.width) / RESCALE),
          (this.gloablHeight = (1 * this.height) / RESCALE),
          this.renderer.setSize(this.gloablWidth, this.gloablHeight),
          null !== (t = this.mouse) &&
            void 0 !== t &&
            t.ready &&
            this.mouse.onResize(),
          null !== (e = this.screen) &&
            void 0 !== e &&
            e.ready &&
            this.screen.onResize(),
          null !== (i = this.floor) &&
            void 0 !== i &&
            i.ready &&
            this.floor.onResize(),
          null !== (n = this.lights) &&
            void 0 !== n &&
            n.ready &&
            this.lights.onResize(),
          null !== (r = this.foggy) &&
            void 0 !== r &&
            r.ready &&
            this.foggy.onResize(),
          null !== (s = this.contents) &&
            void 0 !== s &&
            s.ready &&
            this.contents.onResize(),
          null !== (o = this.scenes) &&
            void 0 !== o &&
            o.ready &&
            this.scenes.onResize(),
          null !== (a = this.archives) &&
            void 0 !== a &&
            a.ready &&
            this.archives.onResize());
      },
      onResizeRatio(t = 1) {
        this.renderer.getPixelRatio() != RES.ratio * t &&
          this.renderer.setPixelRatio(RES.ratio * t);
      },
      onUpdate() {
        var t, e, i, n, r, s, o, a, l, h, c;
        (null !== (t = this.icon) &&
          void 0 !== t &&
          t.ready &&
          this.icon.onUpdate(),
          null !== (e = this.mouse) &&
            void 0 !== e &&
            e.ready &&
            this.mouse.onUpdate(),
          null !== (i = this.scenes) &&
            void 0 !== i &&
            i.ready &&
            this.scenes.onUpdate(),
          null !== (n = this.lights) &&
            void 0 !== n &&
            n.ready &&
            this.lights.onUpdate(),
          null !== (r = this.screen) &&
            void 0 !== r &&
            r.ready &&
            this.screen.onUpdate(),
          null !== (s = this.particle) &&
            void 0 !== s &&
            s.ready &&
            this.particle.onUpdate(),
          null !== (o = this.floor) &&
            void 0 !== o &&
            o.ready &&
            this.floor.onUpdate(),
          null !== (a = this.foggy) &&
            void 0 !== a &&
            a.ready &&
            this.foggy.onUpdate(),
          null !== (l = this.logo) &&
            void 0 !== l &&
            l.ready &&
            this.logo.onUpdate(),
          null !== (h = this.contents) &&
            void 0 !== h &&
            h.ready &&
            this.contents.onUpdate(),
          null !== (c = this.archives) &&
            void 0 !== c &&
            c.ready &&
            this.archives.onUpdate());
      },
      onRender() {
        var t, e, i;
        (null !== (t = this.mouse) &&
          void 0 !== t &&
          t.ready &&
          this.mouse.onRender(),
          null !== (e = this.scenes) &&
            void 0 !== e &&
            e.ready &&
            this.scenes.onRender(),
          null !== (i = this.contents) &&
            void 0 !== i &&
            i.ready &&
            this.contents.onRender());
      },
    }));
}
