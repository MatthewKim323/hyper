// Recovered responsive implementation. See PROVENANCE.md.
export default function initialize() {
  ((window.$html = document.querySelector("html")),
    (window.$page = document.querySelector(".c-pg")),
    (window.$wrap = document.querySelector(".c-wrap")),
    (window.$head = document.querySelector("head")),
    (window.DEMO_MODE = "dev" === ENV),
    (window.GET_IMAGE_WORKER = new Worker(
      LOCAL_ASSETS_URL + "/js/worker/getImage.js",
    )),
    (window.RESCALE = 0.01),
    (window.MOBILE_WIDTH = 767),
    (window.TABLET_WIDTH = 1180),
    (window.VW = 1440),
    (window.VH = 790),
    (window.WW = window.innerWidth),
    (window.WH = window.innerHeight),
    (window.VW_THREE = 1),
    (window.FAR = 5),
    (window.RES = {
      ratio: 1.5,
      min: 1.5,
      max: 2,
      onInit() {
        (WW <= 1440
          ? ((this.min = 1.5),
            (this.max = 2),
            DETECT.device.any &&
              ((this.min = 1.5),
              (this.max = 2),
              WW <= 767 && ((this.min = 1.5), (this.max = 2))))
          : WW <= 1680
            ? ((this.min = 1.5), (this.max = 1.75))
            : WW <= 1920
              ? ((this.min = 1.5), (this.max = 1.5))
              : ((this.min = 1.25), (this.max = 1.25)),
          (this.ratio = clamp(window.devicePixelRatio, this.min, this.max)));
      },
    }),
    RES.onInit(),
    (window.GROUND = { x: 0, y: 0 }),
    (window.GRID = {
      padding: { px: { x: 30, y: 30 }, vw: { x: 30, y: 30 } },
      onResize() {
        ((this.padding.vw.x = getPxByVw(this.padding.px.x)),
          (this.padding.vw.y = getPxByVw(this.padding.px.y)));
      },
    }),
    (window.LOAD_CONTROL = {
      page: {
        d: getParam("pf-page-d") ? Number(getParam("pf-page-d")) : 0,
        s: getParam("pf-page-s") ? Number(getParam("pf-page-s")) : 300,
      },
      archives: {
        d: getParam("pf-archives-d") ? Number(getParam("pf-archives-d")) : 0,
        s: getParam("pf-archives-s") ? Number(getParam("pf-archives-s")) : 5e3,
      },
    }),
    (window.SCREEN_PADDING = { x: 0, y: 0 }));
}
