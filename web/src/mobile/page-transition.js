// Recovered responsive implementation. See PROVENANCE.md.
export default function initialize() {
  window.PAGE_TRANSITION = {
    logo: { deg: 45, radius: 4 },
    screen: { deg: 45, radius: 4 },
    local: null,
    flag: {
      isZoomOutToHome: !1,
      isZoomInToAbout: !1,
      isZoomInToArchive: !1,
      isHomeToProject: !1,
      isPageToSingle: !1,
      isSingleToProject: !1,
      isSingleToSingle: !1,
      isSingleToSingleFromFooter: !1,
    },
    params: {},
    mixAnim: { ptShowScreen: 0, ptShowLogo: 0, ptCurveFloor: 0, zoom: 0 },
    page: {
      home: { ptWebGl: 0 },
      projects: { ptWebGl: 0 },
      about: { ptWebGl: 0 },
      single: { ptWebGl: 0 },
      archives: { ptWebGl: 0 },
      error: { ptWebGl: 0 },
    },
    pageKeys: [],
    prev: { name: null, url: null, layout: null, postId: null, slug: null },
    current: { name: null, url: null, layout: null, postId: null, slug: null },
    next: { name: null, url: null, layout: null, postId: null, slug: null },
    clone: { container: null, archive: null },
    ing: !1,
    once() {
      switch (
        ((this.local = document.querySelector(".c-lc")),
        (this.prev.url = this.current.url),
        (this.prev.postId = this.current.postId),
        (this.prev.name = this.current.name),
        (this.prev.slug = this.current.slug),
        (this.prev.layout = this.current.layout),
        (this.current.url = location.href),
        (this.current.postId = this.local.dataset.postId),
        (this.current.name = this.local.dataset.xhrNamespace),
        (this.current.slug = this.local.dataset.slug),
        (this.current.layout = this.local.dataset.layout),
        this.prev.name && ($html.dataset.prevPage = this.prev.name),
        this.current.name && ($html.dataset.currentPage = this.current.name),
        this.prev.layout && ($html.dataset.prevLayout = this.prev.layout),
        this.current.layout &&
          ($html.dataset.currentLayout = this.current.layout),
        this.current.name)
      ) {
        case "home":
          ((this.page.home.ptWebGl = 1),
            (this.page.projects.ptWebGl = 0),
            (this.page.about.ptWebGl = 0),
            (this.page.single.ptWebGl = 0),
            (this.page.archives.ptWebGl = 0),
            (this.page.error.ptWebGl = 0),
            (this.anim.ptZoomIn = 0),
            (this.anim.ptZoomInProjects = 0),
            (this.anim.ptLogoOpacity = 0),
            (this.anim.ptSingleScale = 0),
            (this.anim.ptSingleThumbZoomIn = 0),
            (this.anim.ptHoverViewButton = 0),
            (this.anim.ptFadeTitle = 0));
          break;
        case "projects":
          ((this.page.home.ptWebGl = 0),
            (this.page.projects.ptWebGl = 1),
            (this.page.about.ptWebGl = 0),
            (this.page.single.ptWebGl = 0),
            (this.page.archives.ptWebGl = 0),
            (this.page.error.ptWebGl = 0),
            (this.anim.ptZoomIn = 1),
            (this.anim.ptZoomInProjects = 1),
            (this.anim.ptLogoOpacity = 1),
            (this.anim.ptSingleScale = 0),
            (this.anim.ptSingleThumbZoomIn = 0),
            (this.anim.ptHoverViewButton = 0),
            (this.anim.ptFadeTitle = 1));
          break;
        case "about":
          ((this.page.home.ptWebGl = 0),
            (this.page.projects.ptWebGl = 0),
            (this.page.about.ptWebGl = 1),
            (this.page.single.ptWebGl = 0),
            (this.page.archives.ptWebGl = 0),
            (this.page.error.ptWebGl = 0),
            (this.anim.ptZoomIn = 1),
            (this.anim.ptZoomInProjects = 1),
            (this.anim.ptLogoOpacity = 1),
            (this.anim.ptSingleScale = 0),
            (this.anim.ptSingleThumbZoomIn = 0),
            (this.anim.ptHoverViewButton = 0),
            (this.anim.ptFadeTitle = 0));
          break;
        case "single":
          ((this.page.home.ptWebGl = 0),
            (this.page.projects.ptWebGl = 0),
            (this.page.about.ptWebGl = 0),
            (this.page.single.ptWebGl = 1),
            (this.page.archives.ptWebGl = 0),
            (this.page.error.ptWebGl = 0),
            (this.anim.ptZoomIn = 1),
            (this.anim.ptZoomInProjects = 1),
            (this.anim.ptLogoOpacity = 1),
            (this.anim.ptSingleScale = 1),
            (this.anim.ptSingleThumbZoomIn = 1),
            (this.anim.ptHoverViewButton = 0),
            (this.anim.ptFadeTitle = 0));
          break;
        case "archives":
          ((this.page.home.ptWebGl = 0),
            (this.page.projects.ptWebGl = 0),
            (this.page.about.ptWebGl = 0),
            (this.page.single.ptWebGl = 0),
            (this.page.archives.ptWebGl = 1),
            (this.page.error.ptWebGl = 0),
            (this.anim.ptZoomIn = 1),
            (this.anim.ptZoomInProjects = 1),
            (this.anim.ptLogoOpacity = 1),
            (this.anim.ptSingleScale = 0),
            (this.anim.ptSingleThumbZoomIn = 0),
            (this.anim.ptHoverViewButton = 0),
            (this.anim.ptFadeTitle = 0));
          break;
        case "error":
          ((this.page.home.ptWebGl = 0),
            (this.page.projects.ptWebGl = 0),
            (this.page.about.ptWebGl = 1),
            (this.page.single.ptWebGl = 0),
            (this.page.archives.ptWebGl = 0),
            (this.page.error.ptWebGl = 1),
            (this.anim.ptZoomIn = 1),
            (this.anim.ptZoomInProjects = 1),
            (this.anim.ptLogoOpacity = 1),
            (this.anim.ptSingleScale = 0),
            (this.anim.ptSingleThumbZoomIn = 0),
            (this.anim.ptHoverViewButton = 0),
            (this.anim.ptFadeTitle = 0));
      }
    },
    onPreFetch() {
      let t = 0;
      if ("ja" === styleLang.data.current) {
        Object.keys(URLS.ja).forEach((e, i) => {
          const n = URLS.ja[e];
          (n != location.href &&
            setTimeout(
              () => {
                barba.prefetch(n);
              },
              LOAD_CONTROL.page.s * t + LOAD_CONTROL.page.d,
            ),
            t++);
        });
        for (let e = 0; e < PROJECTS.json.length; e++) {
          const i = PROJECTS.json[e].permalink.ja;
          (i != location.href &&
            setTimeout(
              () => {
                barba.prefetch(i);
              },
              3 * LOAD_CONTROL.page.s * t + LOAD_CONTROL.page.d,
            ),
            t++);
        }
        Object.keys(URLS.en).forEach((e, i) => {
          const n = URLS.en[e];
          (n != location.href &&
            setTimeout(
              () => {
                barba.prefetch(n);
              },
              3 * LOAD_CONTROL.page.s * t + LOAD_CONTROL.page.d,
            ),
            t++);
        });
      } else {
        Object.keys(URLS.en).forEach((e, i) => {
          const n = URLS.en[e];
          (n != location.href &&
            setTimeout(
              () => {
                barba.prefetch(n);
              },
              3 * LOAD_CONTROL.page.s * t + LOAD_CONTROL.page.d,
            ),
            t++);
        });
        for (let e = 0; e < PROJECTS.json.length; e++) {
          const i = PROJECTS.json[e].permalink.en;
          (i != location.href &&
            setTimeout(
              () => {
                barba.prefetch(i);
              },
              3 * LOAD_CONTROL.page.s * t + LOAD_CONTROL.page.d,
            ),
            t++);
        }
        Object.keys(URLS.ja).forEach((e, i) => {
          const n = URLS.ja[e];
          (n != location.href &&
            setTimeout(
              () => {
                barba.prefetch(n);
              },
              3 * LOAD_CONTROL.page.s * t + LOAD_CONTROL.page.d,
            ),
            t++);
        });
      }
    },
    run() {
      (Object.keys(this.page).forEach((t) => {
        this.page[t];
        this.pageKeys.push(t);
      }),
        this.goto.onInit(),
        this.anim.once());
    },
    onGoto(t) {
      if ("single-to-single-from-ft" === t.type)
        this.flag.isSingleToSingleFromFooter = !0;
      else this.flag.isSingleToSingleFromFooter = !1;
      barba.go(t.href);
    },
    raf() {
      (DETECT.device.any &&
        $html.style.setProperty("--p-single", this.page.single.ptWebGl),
        (this.mixAnim.ptShowScreen = clamp(
          this.page.home.ptWebGl +
            this.page.projects.ptWebGl +
            this.page.single.ptWebGl,
          0,
          1,
        )),
        this.flag.isHomeToProject && (this.mixAnim.ptShowScreen = 1),
        (this.mixAnim.ptShowLogo = clamp(
          this.page.about.ptWebGl + this.page.error.ptWebGl,
          0,
          1,
        )),
        (this.mixAnim.ptCurveFloor = clamp(
          1 - this.mixAnim.ptShowScreen - this.page.archives.ptWebGl,
          0,
          1,
        )),
        (this.mixAnim.ptZoom =
          clamp(this.anim.ptZoomIn, 0, 1) +
          0.15 * this.anim.ptHoverViewButton));
    },
    onLeaveBefore(t) {
      this.ing = !0;
    },
    loadingTimer: null,
    onLeave(t) {
      switch (
        ($html.classList.add("is-leave"),
        t.current.container.classList.add("is-leave-content"),
        styleMenu.isopen && styleMenu.onClose(),
        clearTimeout(this.loadingTimer),
        (this.loadingTimer = setTimeout(() => {
          $html.classList.add("is-loading");
        }, 500)),
        this.current.name)
      ) {
        case "home":
          break;
        case "single":
          (WEBGL.screen.onReset(), WEBGL.screen.onInit(PAGE_TRANSITION.next));
          break;
        default:
          WEBGL.screen.onReset();
      }
      return new Promise((t) => {
        this.flag.isSingleToSingleFromFooter
          ? ($html.classList.add("is-leave-ff"),
            DETECT.device.any
              ? this.anim.onLeaveFadeOut(t)
              : this.anim.onSingleToSingleFromFooter(t))
          : t();
      });
    },
    onBeforeEnter(t) {
      (clearTimeout(this.loadingTimer),
        $html.classList.remove("is-loading"),
        t.next.container.classList.add("is-enter-content"),
        this.onDestroy(),
        this.flag.isSingleToSingleFromFooter &&
          DETECT.device.any &&
          (t.current.container.style.opacity = 0),
        Object.keys(this.flag).forEach((t) => {
          this.flag[t] = !1;
        }));
    },
    leaveTimer: null,
    enterTimer: null,
    onEnter(t, e) {
      ($html.classList.remove("is-leave"), $html.classList.add("is-enter"));
      let i = 300;
      this.flag.isSingleToSingleFromFooter && (i = 0);
      const n = t.next.container;
      switch ((this.onInit(n), this.goto.onInit(), this.current.name)) {
        case "home":
          ((WEBGL.screen.time = 0),
            (this.flag.isZoomOutToHome = !0),
            this.anim.onReset(),
            this.anim.onZoomOutToHome(),
            this.anim.onFadeOutTitle());
          break;
        case "error":
          (this.anim.onFadeOutTitle(),
            "home" === this.prev.name
              ? ((this.flag.isZoomInToAbout = !0),
                this.anim.onReset(),
                this.anim.onZoomIn(),
                this.anim.onZoomInSkew(),
                this.anim.onZoomInToAbout(),
                this.anim.onNormal(),
                (i = 600))
              : "single" === this.prev.name
                ? (this.anim.onReset(),
                  this.anim.onSingleToAbout(),
                  this.anim.onZoomIn(),
                  this.anim.onNormal(),
                  (i = 600))
                : (this.prev.name,
                  this.anim.onReset(),
                  this.anim.onZoomIn(),
                  this.anim.onNormal(),
                  (i = 600)));
          break;
        case "about":
          (this.anim.onFadeOutTitle(),
            "home" === this.prev.name
              ? ((this.flag.isZoomInToAbout = !0),
                this.anim.onReset(),
                this.anim.onZoomIn(),
                this.anim.onZoomInSkew(),
                this.anim.onZoomInToAbout())
              : "single" === this.prev.name
                ? (this.anim.onReset(),
                  this.anim.onZoomIn(),
                  this.anim.onSingleToAbout())
                : (this.prev.name,
                  this.anim.onReset(),
                  this.anim.onZoomIn(),
                  this.anim.onNormal(),
                  (i = 600)));
          break;
        case "archives":
          ("home" === this.prev.name
            ? ((this.flag.isZoomInToArchive = !0),
              this.anim.onReset(),
              this.anim.onZoomIn(),
              this.anim.onZoomInSkew(),
              this.anim.onZoomInToArchive())
            : (this.anim.onReset(), this.anim.onZoomIn(), this.anim.onNormal()),
            this.anim.onFadeOutTitle());
          break;
        case "single":
          (WEBGL.scenes.second.onReset(),
            "projects" === this.prev.name ||
            "about" === this.prev.name ||
            "archives" === this.prev.name ||
            "home" === this.prev.name
              ? ((this.flag.isHomeToProject = !1),
                (this.flag.isPageToSingle = !0),
                (this.flag.isSingleToProject = !1),
                (this.flag.isSingleToSingle = !1),
                this.anim.onReset(),
                this.anim.onZoomIn(),
                this.anim.onPageToSingle(),
                "home" === this.prev.name && this.anim.onZoomInSkew())
              : "single" === this.prev.name
                ? ((this.flag.isHomeToProject = !1),
                  (this.flag.isPageToSingle = !1),
                  (this.flag.isSingleToProject = !1),
                  (this.flag.isSingleToSingle = !0),
                  this.flag.isSingleToSingleFromFooter ||
                    (this.anim.onReset(), this.anim.onNormal()))
                : ((this.flag.isHomeToProject = !1),
                  (this.flag.isPageToSingle = !1),
                  (this.flag.isSingleToProject = !1),
                  (this.flag.isSingleToSingle = !1),
                  this.anim.onReset(),
                  this.anim.onNormal()),
            this.anim.onFadeOutTitle());
          break;
        case "projects":
          (this.anim.onFadeInTitle(),
            "single" === this.prev.name
              ? ((this.flag.isHomeToProject = !1),
                (this.flag.isPageToSingle = !1),
                (this.flag.isSingleToProject = !0),
                (this.flag.isSingleToSingle = !1),
                this.anim.onReset(),
                this.anim.onZoomIn(),
                this.anim.onSingleToProject())
              : "home" === this.prev.name
                ? ((this.flag.isHomeToProject = !0),
                  (this.flag.isPageToSingle = !1),
                  (this.flag.isSingleToProject = !1),
                  (this.flag.isSingleToSingle = !1),
                  this.anim.onReset(),
                  this.anim.onZoomIn(),
                  this.anim.onZoomInSkew(),
                  this.anim.onNormal())
                : (this.anim.onReset(),
                  this.anim.onZoomIn(),
                  this.anim.onNormal()));
          break;
        default:
          ("home" === this.prev.name
            ? (this.anim.onReset(),
              this.anim.onZoomIn(),
              this.anim.onZoomInSkew(),
              (i = 0))
            : (this.anim.onReset(), this.anim.onZoomIn(), this.anim.onNormal()),
            this.anim.onFadeOutTitle());
      }
      return new Promise((t) => {
        (clearTimeout(this.enterTimer),
          (this.enterTimer = setTimeout(() => {
            ($html.classList.remove("is-enter"),
              $html.classList.remove("is-leave-ff"),
              t());
          }, i)));
      });
    },
    afterEnter(t) {
      const e = t.next.container;
      (this.onInitAfter(e),
        (this.flag.isSingleToSingleFromFooter = !1),
        (this.anim.ptSingleToSingleFromFooter = 1));
    },
    onInit(t) {
      ((this.local = t || document.querySelector(".c-lc")),
        (this.prev.url = this.current.url),
        (this.prev.postId = this.current.postId),
        (this.prev.name = this.current.name),
        (this.prev.layout = this.current.layout),
        (this.prev.slug = this.current.slug),
        (this.current.url = location.href),
        (this.current.postId = this.local.dataset.postId),
        (this.current.name = this.local.dataset.xhrNamespace),
        (this.current.layout = this.local.dataset.layout),
        (this.current.slug = this.local.dataset.slug),
        this.prev.name && ($html.dataset.prevPage = this.prev.name),
        this.current.name && ($html.dataset.currentPage = this.current.name),
        this.prev.layout && ($html.dataset.prevLayout = this.prev.layout),
        this.current.layout &&
          ($html.dataset.currentLayout = this.current.layout));
    },
    onInitAfter(t) {
      var e, i, n, r;
      ((this.ing = !1),
        styleModal.onInit(t),
        styleInview.onInit(t),
        styleSlider.onInit(t),
        styleAccordion.onInit(t),
        styleAtag.onInit(t),
        styleTextArea.onInit(t),
        styleLang.onInit(t),
        styleProjects && styleProjects.onInit(t),
        styleMail.onInit(t),
        styleCss.onInit(t),
        styleImage && styleImage.onInit(t),
        COLOR.onInit(),
        null === (e = WEBGL.contents) || void 0 === e || e.onInit(t),
        null === (i = WEBGL.archives) || void 0 === i || i.onInit(t),
        WEBGL.scenes.cameras.onInit(t),
        null === (n = WEBGL.icon) || void 0 === n || n.onInit(t),
        MOUSE.enable && MOUSE.onInit(t),
        null === (r = WEBGL.screen) || void 0 === r || r.onInit(),
        PAGE_SCROLL_PROJECTS.onDestroy(),
        PAGE_SCROLL_PROJECTS.onInit(t),
        PAGE_SCROLL_NORMAL.onDestroy(),
        PAGE_SCROLL_NORMAL.onInit(t));
    },
    onDestroy() {
      var t, e, i, n, r;
      (null === (t = WEBGL.logo) || void 0 === t || t.onReset(),
        null === (e = WEBGL.screen) || void 0 === e || e.onDestroy(),
        null === (i = WEBGL.contents) || void 0 === i || i.onDestroy(),
        null === (n = WEBGL.archives) || void 0 === n || n.onDestroy(),
        WEBGL.scenes.cameras.onDestroy(),
        null === (r = WEBGL.icon) || void 0 === r || r.onDestroy(),
        COLOR.onDestroy(),
        styleModal.onDestroy(),
        styleInview.onDestroy(),
        styleLang.onDestroy(),
        styleSlider.onDestroy(),
        styleAccordion.onDestroy(),
        styleProjects && styleProjects.onDestroy(),
        styleTextArea.onDestroy(),
        styleMail.onDestroy(),
        styleCss.onDestroy(),
        styleImage && styleImage.onDestroy(),
        PAGE_SCROLL_PROJECTS.onDestroy(),
        PAGE_SCROLL_NORMAL.onDestroy());
    },
  };
}
