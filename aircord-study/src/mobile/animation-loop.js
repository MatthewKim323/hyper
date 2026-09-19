// Recovered responsive implementation. See PROVENANCE.md.
export default function initialize() {
  ((window.GLOBAL_TIME = 0),
    (window.GLOBAL_SIN = 0),
    gsap.ticker.add((t) => {
      (GLOBAL_TIME++,
        (GLOBAL_SIN = Math.sin(0.5 * GLOBAL_TIME * (Math.PI / 180))),
        PAGE_TRANSITION && PAGE_TRANSITION.raf(),
        PAGE_SCROLL_PROJECTS && PAGE_SCROLL_PROJECTS.raf(),
        PAGE_SCROLL_NORMAL && PAGE_SCROLL_NORMAL.raf(t),
        TRAILS.body && TRAILS.raf(),
        MOUSE.body && MOUSE.raf(),
        styleModal && styleModal.raf(),
        styleSlider && styleSlider.raf(),
        WEBGL && (WEBGL.onUpdate(), WEBGL.onRender()),
        SPLASH && SPLASH.raf());
    }),
    gsap.ticker.lagSmoothing(1e3, 16),
    (window.DETECT_INIT = {
      islow: !1,
      el: null,
      src: CDN_ASSETS_URL + "/video/detect.mp4",
      once() {
        (($html.dataset.lowPower = !1),
          (this.el = document.createElement("video")),
          (this.el.preload = "auto"),
          (this.el.muted = !0),
          this.el.setAttribute("muted", ""),
          this.el.setAttribute("playsinline", "playsinline"),
          (this.el.src = this.src));
        (this.el.play().catch((t) => {
          ((this.islow = !0), ($html.dataset.lowPower = !0));
        }),
          ($html.dataset.reducedMotion = DETECT.reduced));
      },
    }),
    DETECT_INIT.once(),
    (window.IS_LANDSCAPE = !0),
    window.addEventListener("resize", (t) => {
      onResize();
    }),
    (window.RESIZE_TIMER_1 = null),
    (window.RESIZE_TIMER_2 = null),
    (window.RESIZE_TIMER_3 = null),
    (window.RESIZE_TIMER_4 = null),
    (window.onResize = () => {
      (clearTimeout(RESIZE_TIMER_1),
        clearTimeout(RESIZE_TIMER_2),
        clearTimeout(RESIZE_TIMER_3),
        clearTimeout(RESIZE_TIMER_4),
        (RESIZE_TIMER_1 = setTimeout(() => {
          onResize1();
        }, 100)),
        (RESIZE_TIMER_2 = setTimeout(() => {
          onResize2();
        }, 200)),
        (RESIZE_TIMER_3 = setTimeout(() => {
          onResize3();
        }, 300)),
        (RESIZE_TIMER_4 = setTimeout(() => {
          onResize4();
        }, 400)));
    }),
    (window.onResize1 = () => {
      ((WW = window.innerWidth),
        (WH = window.innerHeight),
        WW < WH ? (IS_LANDSCAPE = !1) : (IS_LANDSCAPE = !0),
        $html.style.setProperty("--vh", WH / 100 + "px"),
        $html.style.setProperty("--aspect", WH / WW),
        PAGE_SCROLL_NORMAL.onResize());
    }),
    (window.onResize2 = () => {
      WEBGL.ready && (RES.onInit(), WEBGL.onResize());
    }),
    (window.onResize3 = () => {
      PAGE_SCROLL_PROJECTS.ready && PAGE_SCROLL_PROJECTS.onResize();
    }),
    (window.onResize4 = () => {
      PAGE_SCROLL_NORMAL.ready && PAGE_SCROLL_NORMAL.onScroll();
    }),
    window.addEventListener("orientationchange", function () {
      location.reload();
    }),
    $html.style.setProperty("--vh", WH / 100 + "px"),
    $html.style.setProperty("--aspect", WH / WW),
    getParam("is-sc-mode") && $html.classList.add("is-sc-mode"),
    (window.onLoadedBefore = () => {
      (PAGE_TRANSITION.setting(),
        styleModal.onInit(),
        styleLang.onInit(),
        styleInview.onInit(),
        styleCss.onInit(),
        styleSlider.onInit(),
        styleProjects && styleProjects.onInit(),
        styleMail.onInit(),
        styleImage && styleImage.onInit(),
        WEBGL.once(),
        WEBGL.screen.onInit(),
        PAGE_SCROLL_PROJECTS.onInit(),
        PAGE_SCROLL_NORMAL.onInit());
    }),
    (window.onLoaded = () => {
      (WEBGL.onLoaded(), WEBGL.scenes.first.onLoaded(), (PRE_RENDER = !1));
    }));
}
