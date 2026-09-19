// Recovered responsive implementation. See PROVENANCE.md.
import * as THREE from "three";
export default function initialize() {
  var n = THREE;
  window.LOADER = {
    ease: 0.1,
    delta1: 0,
    delta2: 0,
    progress: 0,
    isloading: !0,
    isloaded: !1,
    itemsLoaded: 0,
    itemsTotal: 0,
    fonts: {
      logo: { path: CDN_ASSETS_URL + "/fonts/logo/aircord.json", json: null },
      ui: { path: CDN_ASSETS_URL + "/fonts/icon/icon2.json", json: null },
    },
    textures: {
      epoxyFloor: {
        src: {
          d2x: CDN_ASSETS_URL + "/tex/512/epoxyFloor.jpg",
          d1x: CDN_ASSETS_URL + "/tex/512/epoxyFloor.jpg",
          mob: CDN_ASSETS_URL + "/tex/512/epoxyFloor.jpg",
        },
        tex: null,
      },
    },
    once() {
      ((this.manager = new n.LoadingManager()),
        (this.manager.onLoad = () => {
          SPLASH.onInit();
        }),
        (this.manager.onProgress = (t, e, i) => {}),
        (this.manager.onError = (t) => {}),
        this.onLoadTextures(),
        this.onLoadFonts(),
        ARCHIVES && ARCHIVES.once());
    },
    onLoadTextures() {
      const t = new n.TextureLoader(this.manager);
      Object.entries(this.textures).forEach(([e, i]) => {
        const r = getSrc(i.src.d1x, i.src.d2x, i.src.mob, i.src.d1x, !0);
        t.load(r, (t) => {
          ((t.wrapS = n.RepeatWrapping),
            (t.wrapT = n.RepeatWrapping),
            (i.tex = t));
        });
      });
    },
    onLoadFonts() {
      const t = new FontLoader(this.manager);
      Object.entries(this.fonts).forEach(([e, i]) => {
        t.load(i.path, (t) => {
          i.json = t;
        });
      });
    },
  };
}
