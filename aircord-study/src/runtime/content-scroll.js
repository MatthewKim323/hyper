// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  "use strict";
  function n(t, e, i) {
    return Math.max(t, Math.min(e, i));
  }
  class r {
    advance(t) {
      if (!this.isRunning) return;
      let e = !1;
      if (this.lerp)
        ((this.value =
          ((i = this.value),
          (r = this.to),
          (s = 60 * this.lerp),
          (a = t),
          (function (t, e, i) {
            return (1 - i) * t + i * e;
          })(i, r, 1 - Math.exp(-s * a)))),
          Math.round(this.value) === this.to &&
            ((this.value = this.to), (e = !0)));
      else {
        this.currentTime += t;
        const i = n(0, this.currentTime / this.duration, 1);
        e = i >= 1;
        const r = e ? 1 : this.easing(i);
        this.value = this.from + (this.to - this.from) * r;
      }
      var i, r, s, a;
      (this.onUpdate?.(this.value, e), e && this.stop());
    }
    stop() {
      this.isRunning = !1;
    }
    fromTo(
      t,
      e,
      {
        lerp: i = 0.1,
        duration: n = 1,
        easing: r = (t) => t,
        onStart: s,
        onUpdate: a,
      },
    ) {
      ((this.from = this.value = t),
        (this.to = e),
        (this.lerp = i),
        (this.duration = n),
        (this.easing = r),
        (this.currentTime = 0),
        (this.isRunning = !0),
        s?.(),
        (this.onUpdate = a));
    }
  }
  class s {
    constructor({
      wrapper: t,
      content: e,
      autoResize: i = !0,
      debounce: n = 250,
    } = {}) {
      ((this.wrapper = t),
        (this.content = e),
        i &&
          ((this.debouncedResize = (function (t, e) {
            let i;
            return function () {
              let n = arguments,
                r = this;
              (clearTimeout(i),
                (i = setTimeout(function () {
                  t.apply(r, n);
                }, e)));
            };
          })(this.resize, n)),
          this.wrapper === window
            ? window.addEventListener("resize", this.debouncedResize, !1)
            : ((this.wrapperResizeObserver = new ResizeObserver(
                this.debouncedResize,
              )),
              this.wrapperResizeObserver.observe(this.wrapper)),
          (this.contentResizeObserver = new ResizeObserver(
            this.debouncedResize,
          )),
          this.contentResizeObserver.observe(this.content)),
        this.resize());
    }
    destroy() {
      (this.wrapperResizeObserver?.disconnect(),
        this.contentResizeObserver?.disconnect(),
        window.removeEventListener("resize", this.debouncedResize, !1));
    }
    resize = () => {
      (this.onWrapperResize(), this.onContentResize());
    };
    onWrapperResize = () => {
      this.wrapper === window
        ? ((this.width = window.innerWidth), (this.height = window.innerHeight))
        : ((this.width = this.wrapper.clientWidth),
          (this.height = this.wrapper.clientHeight));
    };
    onContentResize = () => {
      this.wrapper === window
        ? ((this.scrollHeight = this.content.scrollHeight),
          (this.scrollWidth = this.content.scrollWidth))
        : ((this.scrollHeight = this.wrapper.scrollHeight),
          (this.scrollWidth = this.wrapper.scrollWidth));
    };
    get limit() {
      return {
        x: this.scrollWidth - this.width,
        y: this.scrollHeight - this.height,
      };
    }
  }
  class a {
    constructor() {
      this.events = {};
    }
    emit(t, ...e) {
      let i = this.events[t] || [];
      for (let t = 0, n = i.length; t < n; t++) i[t](...e);
    }
    on(t, e) {
      return (
        this.events[t]?.push(e) || (this.events[t] = [e]),
        () => {
          this.events[t] = this.events[t]?.filter((t) => e !== t);
        }
      );
    }
    off(t, e) {
      this.events[t] = this.events[t]?.filter((t) => e !== t);
    }
    destroy() {
      this.events = {};
    }
  }
  const o = 100 / 6;
  class l {
    constructor(t, { wheelMultiplier: e = 1, touchMultiplier: i = 1 }) {
      ((this.element = t),
        (this.wheelMultiplier = e),
        (this.touchMultiplier = i),
        (this.touchStart = { x: null, y: null }),
        (this.emitter = new a()),
        window.addEventListener("resize", this.onWindowResize, !1),
        this.onWindowResize(),
        this.element.addEventListener("wheel", this.onWheel, {
          passive: !1,
        }),
        this.element.addEventListener("touchstart", this.onTouchStart, {
          passive: !1,
        }),
        this.element.addEventListener("touchmove", this.onTouchMove, {
          passive: !1,
        }),
        this.element.addEventListener("touchend", this.onTouchEnd, {
          passive: !1,
        }));
    }
    on(t, e) {
      return this.emitter.on(t, e);
    }
    destroy() {
      (this.emitter.destroy(),
        window.removeEventListener("resize", this.onWindowResize, !1),
        this.element.removeEventListener("wheel", this.onWheel, {
          passive: !1,
        }),
        this.element.removeEventListener("touchstart", this.onTouchStart, {
          passive: !1,
        }),
        this.element.removeEventListener("touchmove", this.onTouchMove, {
          passive: !1,
        }),
        this.element.removeEventListener("touchend", this.onTouchEnd, {
          passive: !1,
        }));
    }
    onTouchStart = (t) => {
      const { clientX: e, clientY: i } = t.targetTouches
        ? t.targetTouches[0]
        : t;
      ((this.touchStart.x = e),
        (this.touchStart.y = i),
        (this.lastDelta = { x: 0, y: 0 }),
        this.emitter.emit("scroll", { deltaX: 0, deltaY: 0, event: t }));
    };
    onTouchMove = (t) => {
      const { clientX: e, clientY: i } = t.targetTouches
          ? t.targetTouches[0]
          : t,
        n = -(e - this.touchStart.x) * this.touchMultiplier,
        r = -(i - this.touchStart.y) * this.touchMultiplier;
      ((this.touchStart.x = e),
        (this.touchStart.y = i),
        (this.lastDelta = { x: n, y: r }),
        this.emitter.emit("scroll", { deltaX: n, deltaY: r, event: t }));
    };
    onTouchEnd = (t) => {
      this.emitter.emit("scroll", {
        deltaX: this.lastDelta.x,
        deltaY: this.lastDelta.y,
        event: t,
      });
    };
    onWheel = (t) => {
      let { deltaX: e, deltaY: i, deltaMode: n } = t;
      ((e *= 1 === n ? o : 2 === n ? this.windowWidth : 1),
        (i *= 1 === n ? o : 2 === n ? this.windowHeight : 1),
        (e *= this.wheelMultiplier),
        (i *= this.wheelMultiplier),
        this.emitter.emit("scroll", { deltaX: e, deltaY: i, event: t }));
    };
    onWindowResize = () => {
      ((this.windowWidth = window.innerWidth),
        (this.windowHeight = window.innerHeight));
    };
  }
  class h {
    constructor({
      wrapper: t = window,
      content: e = document.documentElement,
      wheelEventsTarget: i = t,
      eventsTarget: n = i,
      smoothWheel: o = !0,
      syncTouch: h = !1,
      syncTouchLerp: c = 0.075,
      touchInertiaMultiplier: u = 35,
      duration: d,
      easing: p = (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      lerp: m = !d && 0.1,
      infinite: f = !1,
      orientation: g = "vertical",
      gestureOrientation: v = "vertical",
      touchMultiplier: _ = 1,
      wheelMultiplier: y = 1,
      autoResize: x = !0,
      __experimental__naiveDimensions: S = !1,
    } = {}) {
      ((this.__isSmooth = !1),
        (this.__isScrolling = !1),
        (this.__isStopped = !1),
        (this.__isLocked = !1),
        (this.onVirtualScroll = ({ deltaX: t, deltaY: e, event: i }) => {
          if (i.ctrlKey) return;
          const n = i.type.includes("touch"),
            r = i.type.includes("wheel");
          if (
            this.options.syncTouch &&
            n &&
            "touchstart" === i.type &&
            !this.isStopped &&
            !this.isLocked
          )
            return void this.reset();
          const s = 0 === t && 0 === e,
            a =
              ("vertical" === this.options.gestureOrientation && 0 === e) ||
              ("horizontal" === this.options.gestureOrientation && 0 === t);
          if (s || a) return;
          let o = i.composedPath();
          if (
            ((o = o.slice(0, o.indexOf(this.rootElement))),
            o.find((t) => {
              var e, i, s, a, o;
              return (
                (null === (e = t.hasAttribute) || void 0 === e
                  ? void 0
                  : e.call(t, "data-lenis-prevent")) ||
                (n &&
                  (null === (i = t.hasAttribute) || void 0 === i
                    ? void 0
                    : i.call(t, "data-lenis-prevent-touch"))) ||
                (r &&
                  (null === (s = t.hasAttribute) || void 0 === s
                    ? void 0
                    : s.call(t, "data-lenis-prevent-wheel"))) ||
                ((null === (a = t.classList) || void 0 === a
                  ? void 0
                  : a.contains("lenis")) &&
                  !(null === (o = t.classList) || void 0 === o
                    ? void 0
                    : o.contains("lenis-stopped")))
              );
            }))
          )
            return;
          if (this.isStopped || this.isLocked) return void i.preventDefault();
          if (
            ((this.isSmooth =
              (this.options.syncTouch && n) || (this.options.smoothWheel && r)),
            !this.isSmooth)
          )
            return ((this.isScrolling = !1), void this.animate.stop());
          i.preventDefault();
          let l = e;
          "both" === this.options.gestureOrientation
            ? (l = Math.abs(e) > Math.abs(t) ? e : t)
            : "horizontal" === this.options.gestureOrientation && (l = t);
          const h = n && this.options.syncTouch,
            c = n && "touchend" === i.type && Math.abs(l) > 5;
          (c && (l = this.velocity * this.options.touchInertiaMultiplier),
            this.scrollTo(
              this.targetScroll + l,
              Object.assign(
                { programmatic: !1 },
                h
                  ? { lerp: c ? this.options.syncTouchLerp : 1 }
                  : {
                      lerp: this.options.lerp,
                      duration: this.options.duration,
                      easing: this.options.easing,
                    },
              ),
            ));
        }),
        (this.onNativeScroll = () => {
          if (!this.__preventNextScrollEvent && !this.isScrolling) {
            const t = this.animatedScroll;
            ((this.animatedScroll = this.targetScroll = this.actualScroll),
              (this.velocity = 0),
              (this.direction = Math.sign(this.animatedScroll - t)),
              this.emit());
          }
        }),
        (window.lenisVersion = "1.0.42"),
        (t !== document.documentElement && t !== document.body) || (t = window),
        (this.options = {
          wrapper: t,
          content: e,
          wheelEventsTarget: i,
          eventsTarget: n,
          smoothWheel: o,
          syncTouch: h,
          syncTouchLerp: c,
          touchInertiaMultiplier: u,
          duration: d,
          easing: p,
          lerp: m,
          infinite: f,
          gestureOrientation: v,
          orientation: g,
          touchMultiplier: _,
          wheelMultiplier: y,
          autoResize: x,
          __experimental__naiveDimensions: S,
        }),
        (this.animate = new r()),
        (this.emitter = new a()),
        (this.dimensions = new s({
          wrapper: t,
          content: e,
          autoResize: x,
        })),
        this.toggleClassName("lenis", !0),
        (this.velocity = 0),
        (this.isLocked = !1),
        (this.isStopped = !1),
        (this.isSmooth = h || o),
        (this.isScrolling = !1),
        (this.targetScroll = this.animatedScroll = this.actualScroll),
        this.options.wrapper.addEventListener(
          "scroll",
          this.onNativeScroll,
          !1,
        ),
        (this.virtualScroll = new l(n, {
          touchMultiplier: _,
          wheelMultiplier: y,
        })),
        this.virtualScroll.on("scroll", this.onVirtualScroll));
    }
    destroy() {
      (this.emitter.destroy(),
        this.options.wrapper.removeEventListener(
          "scroll",
          this.onNativeScroll,
          !1,
        ),
        this.virtualScroll.destroy(),
        this.dimensions.destroy(),
        this.toggleClassName("lenis", !1),
        this.toggleClassName("lenis-smooth", !1),
        this.toggleClassName("lenis-scrolling", !1),
        this.toggleClassName("lenis-stopped", !1),
        this.toggleClassName("lenis-locked", !1));
    }
    on(t, e) {
      return this.emitter.on(t, e);
    }
    off(t, e) {
      return this.emitter.off(t, e);
    }
    setScroll(t) {
      this.isHorizontal
        ? (this.rootElement.scrollLeft = t)
        : (this.rootElement.scrollTop = t);
    }
    resize() {
      this.dimensions.resize();
    }
    emit() {
      this.emitter.emit("scroll", this);
    }
    reset() {
      ((this.isLocked = !1),
        (this.isScrolling = !1),
        (this.animatedScroll = this.targetScroll = this.actualScroll),
        (this.velocity = 0),
        this.animate.stop());
    }
    start() {
      this.isStopped && ((this.isStopped = !1), this.reset());
    }
    stop() {
      this.isStopped ||
        ((this.isStopped = !0), this.animate.stop(), this.reset());
    }
    raf(t) {
      const e = t - (this.time || t);
      ((this.time = t), this.animate.advance(0.001 * e));
    }
    scrollTo(
      t,
      {
        offset: e = 0,
        immediate: i = !1,
        lock: r = !1,
        duration: s = this.options.duration,
        easing: a = this.options.easing,
        lerp: o = !s && this.options.lerp,
        onComplete: l,
        force: h = !1,
        programmatic: c = !0,
      } = {},
    ) {
      if ((!this.isStopped && !this.isLocked) || h) {
        if (["top", "left", "start"].includes(t)) t = 0;
        else if (["bottom", "right", "end"].includes(t)) t = this.limit;
        else {
          let i;
          if (
            ("string" == typeof t
              ? (i = document.querySelector(t))
              : (null == t ? void 0 : t.nodeType) && (i = t),
            i)
          ) {
            if (this.options.wrapper !== window) {
              const t = this.options.wrapper.getBoundingClientRect();
              e -= this.isHorizontal ? t.left : t.top;
            }
            const n = i.getBoundingClientRect();
            t = (this.isHorizontal ? n.left : n.top) + this.animatedScroll;
          }
        }
        if ("number" == typeof t) {
          if (
            ((t += e),
            (t = Math.round(t)),
            this.options.infinite
              ? c && (this.targetScroll = this.animatedScroll = this.scroll)
              : (t = n(0, t, this.limit)),
            i)
          )
            return (
              (this.animatedScroll = this.targetScroll = t),
              this.setScroll(this.scroll),
              this.reset(),
              void (null == l || l(this))
            );
          if (!c) {
            if (t === this.targetScroll) return;
            this.targetScroll = t;
          }
          this.animate.fromTo(this.animatedScroll, t, {
            duration: s,
            easing: a,
            lerp: o,
            onStart: () => {
              (r && (this.isLocked = !0), (this.isScrolling = !0));
            },
            onUpdate: (t, e) => {
              ((this.isScrolling = !0),
                (this.velocity = t - this.animatedScroll),
                (this.direction = Math.sign(this.velocity)),
                (this.animatedScroll = t),
                this.setScroll(this.scroll),
                c && (this.targetScroll = t),
                e || this.emit(),
                e &&
                  (this.reset(),
                  this.emit(),
                  null == l || l(this),
                  (this.__preventNextScrollEvent = !0),
                  requestAnimationFrame(() => {
                    delete this.__preventNextScrollEvent;
                  })));
            },
          });
        }
      }
    }
    get rootElement() {
      return this.options.wrapper === window
        ? document.documentElement
        : this.options.wrapper;
    }
    get limit() {
      return this.options.__experimental__naiveDimensions
        ? this.isHorizontal
          ? this.rootElement.scrollWidth - this.rootElement.clientWidth
          : this.rootElement.scrollHeight - this.rootElement.clientHeight
        : this.dimensions.limit[this.isHorizontal ? "x" : "y"];
    }
    get isHorizontal() {
      return "horizontal" === this.options.orientation;
    }
    get actualScroll() {
      return this.isHorizontal
        ? this.rootElement.scrollLeft
        : this.rootElement.scrollTop;
    }
    get scroll() {
      return this.options.infinite
        ? ((this.animatedScroll % (t = this.limit)) + t) % t
        : this.animatedScroll;
      var t;
    }
    get progress() {
      return 0 === this.limit ? 1 : this.scroll / this.limit;
    }
    get isSmooth() {
      return this.__isSmooth;
    }
    set isSmooth(t) {
      this.__isSmooth !== t &&
        ((this.__isSmooth = t), this.toggleClassName("lenis-smooth", t));
    }
    get isScrolling() {
      return this.__isScrolling;
    }
    set isScrolling(t) {
      this.__isScrolling !== t &&
        ((this.__isScrolling = t), this.toggleClassName("lenis-scrolling", t));
    }
    get isStopped() {
      return this.__isStopped;
    }
    set isStopped(t) {
      this.__isStopped !== t &&
        ((this.__isStopped = t), this.toggleClassName("lenis-stopped", t));
    }
    get isLocked() {
      return this.__isLocked;
    }
    set isLocked(t) {
      this.__isLocked !== t &&
        ((this.__isLocked = t), this.toggleClassName("lenis-locked", t));
    }
    get className() {
      let t = "lenis";
      return (
        this.isStopped && (t += " lenis-stopped"),
        this.isLocked && (t += " lenis-locked"),
        this.isScrolling && (t += " lenis-scrolling"),
        this.isSmooth && (t += " lenis-smooth"),
        t
      );
    }
    toggleClassName(t, e) {
      (this.rootElement.classList.toggle(t, e),
        this.emitter.emit("className change", this));
    }
  }
  ((window.PAGE_SCROLL_NORMAL = {
    ready: !1,
    local: null,
    wrap: null,
    content: null,
    cross: [],
    header: { el: null, rect: null },
    once() {
      ((this.lerp = 0.15),
        DETECT.os.win && (this.lerp = 1.5 * this.lerp),
        DETECT.reduced && (this.lerp = 0.75),
        (this.header.el = document.querySelector("header .c-lg")),
        (this.header.rect = this.header.el.getBoundingClientRect()));
    },
    onInit(t) {
      if (
        ((this.local = t || document.querySelector(".c-lc")),
        (this.wrap = DETECT.device.any
          ? document.querySelector("#page")
          : this.local.querySelector('.c-sc-w[data-type="normal"]')),
        (this.cross = []),
        this.local.querySelector('.c-sc-w[data-type="normal"]'))
      ) {
        (this.wrap && DETECT.device.any && this.wrap.scrollTo(0, 0),
          (this.content = this.local.querySelector(".c-sc-c")),
          (this.body = new h({
            lerp: this.lerp,
            wrapper: this.wrap,
            content: this.content,
          })));
        const t = document.querySelectorAll(".js-sc-c");
        for (let e = 0; e < t.length; e++) {
          const i = t[e],
            n = i.getBoundingClientRect();
          this.cross.push({
            el: i,
            rect: { top: n.top, height: n.height },
          });
        }
        (this.onInitSctollTo(), this.onInitAfter(), (this.ready = !0));
      }
    },
    scroll: { f1: 0, f2: 0, f3: 0, y: 0, p: 0, limit: { x: 0, y: 0 } },
    trigger: { elem: null, array: [] },
    onInitAfter() {
      this.body &&
        this.body.on(
          "scroll",
          ({ scroll: t, limit: e, velocity: i, direction: n, progress: r }) => {
            ((this.scroll.y = t),
              (this.scroll.limit.x = e),
              (this.scroll.limit.y = e),
              (this.scroll.p = Math.abs(r)),
              (this.scroll.f2 = Math.min(this.scroll.y / (1.5 * WH), 1)),
              this.local.style.setProperty("--f2", this.scroll.f2),
              (this.scroll.f3 = Math.min((e - t) / (1.5 * WH), 1)),
              this.local.style.setProperty("--f3", this.scroll.f3),
              this.onScroll());
          },
        );
    },
    onScroll() {
      var t, e, i;
      let n = 0;
      for (let t = 0; t < this.cross.length; t++) {
        const e = this.cross[t],
          i = e.rect.top < this.scroll.y + this.header.rect.height / 2,
          r =
            e.rect.top + e.rect.height >
            this.scroll.y + this.header.rect.height / 2;
        i && r && n++;
      }
      (0 != n
        ? this.header.el.classList.add("is-cs")
        : this.header.el.classList.remove("is-cs"),
        WEBGL.scenes.second.ready &&
          WEBGL.scenes.second.onScroll(this.scroll.y),
        null !== (t = WEBGL.contents) &&
          void 0 !== t &&
          t.ready &&
          WEBGL.contents.onScroll(this.scroll.y),
        null !== (e = WEBGL.logo) &&
          void 0 !== e &&
          e.ready &&
          WEBGL.logo.onScroll(this.scroll.y, this.scroll.p),
        null !== (i = WEBGL.icon) &&
          void 0 !== i &&
          i.ready &&
          WEBGL.icon.onScroll(this.scroll.y, this.scroll.f1));
    },
    scrollto: [],
    onInitSctollTo() {
      (this.local.querySelectorAll(".js-sc-to").forEach((t, e) => {
        this.scrollto.push({
          el: t,
          href: t.getAttribute("href"),
          click: null,
        });
      }),
        this.scrollto.forEach((t, e) => {
          ((t.click = (e) => {
            e.preventDefault();
            const i = document.querySelector(t.href);
            DETECT.device.any
              ? i
                ? gsap.to(this.wrap, {
                    duration: 1,
                    scrollTo: { y: i, autoKill: !0 },
                    ease: "power2",
                  })
                : gsap.to(this.wrap, {
                    duration: 1,
                    scrollTo: { y: WH, autoKill: !0 },
                    ease: "power2",
                  })
              : i
                ? this.body && this.body.scrollTo(i)
                : this.body && this.body.scrollTo(WH);
          }),
            t.el.addEventListener("click", t.click));
        }));
    },
    onResize() {
      ((this.header.rect = this.header.el.getBoundingClientRect()),
        this.cross.forEach((t, e) => {
          const i = t.el.getBoundingClientRect();
          ((t.rect.top = i.top - this.scroll.y), (t.rect.height = i.height));
        }));
    },
    raf(t) {
      this.body && this.body.raf(1e3 * t);
    },
    onReset() {
      ((this.scroll.y = 0),
        (this.scroll.p = 0),
        (this.scroll.limit.x = 0),
        (this.scroll.limit.y = 0));
    },
    onDestroy() {
      ((this.ready = !1),
        this.header.el.classList.remove("is-cs"),
        this.wrap &&
          DETECT.device.any &&
          !PAGE_TRANSITION.flag.isSingleToSingle &&
          this.wrap.scrollTo(0, 0),
        (this.scroll.y = 0),
        (this.scroll.p = 0),
        (this.scroll.limit.x = 0),
        (this.scroll.limit.y = 0),
        this.body && (this.body.destroy(), (this.body = null)),
        this.scrollto.forEach((t, e) => {
          (t.el.removeEventListener("click", t.click), (t.click = null));
        }),
        (this.scrollto = []));
    },
  }),
    PAGE_SCROLL_NORMAL.once());
}
