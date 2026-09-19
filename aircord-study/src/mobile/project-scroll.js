// Recovered responsive implementation. See PROVENANCE.md.
export default function initialize() {
  "use strict";
  class n {
    constructor(t = {}) {
      var e, i, n, r, s, o, a, l, h, c, u;
      ((this.prop = t),
        (this.ready = !1),
        (this.inview = !1 !== t.inview),
        (this.stopped = !0),
        (this.ing = !1),
        (this.delta1 = 0),
        (this.delta2 = 0),
        (this.reduced = !!t.reduced && t.reduced),
        (this.fillscreen = !!t.fillscreen && t.fillscreen),
        (this.autocenter = !!t.autocenter && t.autocenter),
        (this.dom = void 0 === t.dom || t.dom),
        (this.html = document.querySelector("html")),
        (this.keyScroll = !1 !== t.keyScroll),
        (this.detail = { x: 0, y: 0, d: 0 }),
        (this.currentIndex = 0),
        (this.centerIndex = 0),
        (this.disableDragByTagName = t.disableDragByTagName || [
          "BUTTON",
          "A",
          "INPUT",
          "LABEL",
        ]),
        (this.enableDragByClassName = t.enableDragByClassName || []),
        (this.wrap = { el: this.prop.wrap, rect: null }),
        this.wrap.el,
        (this.body = {
          el: this.wrap.el.querySelector(this.prop.body),
          rect: null,
        }),
        this.body.el,
        (this.content = {
          el: this.body.el.querySelector(this.prop.content),
          rect: { width: 0, height: 0 },
          before: null,
          after: null,
        }),
        this.content.el,
        (this.position = {
          el: document.querySelector(".c-position"),
          value: 0,
        }),
        (this.dir = t.dir ? t.dir : "vr"),
        (this.infinite = !!t.infinite && t.infinite),
        (this.body.el.dataset.dir = this.dir),
        (this.touchDir = t.touchDir ? t.touchDir : this.dir),
        (this.totalHeight = 0),
        (this.windowHeight =
          "hr" === this.dir ? window.innerWidth : window.innerHeight),
        (this.ease = {
          power: this.prop.ease ? this.prop.ease : 0.2,
          origin: this.prop.ease ? this.prop.ease : 0.2,
        }));
      this.autoscroll = { enable: !1, speed: 0.1, x: 0, y: 0, ...t.autoscroll };
      ((this.touch = {
        enable: !0,
        thumb: !1,
        pivot: !1,
        delta: 0,
        ratio: 1.8,
        active: !1,
        start: { delta: 0, x: 0, y: 0 },
        dist: { x: 0, y: 0, xy: 0 },
        ing: { x: 0, y: 0, xy: 0 },
        dir: 0,
        throw: { event: null, buffer: null },
        ...t.touch,
      }),
        (this.scroll = {
          dir: "down",
          progress: 0,
          loop: 0,
          x: 0,
          y: 0,
          top: 0,
          left: 0,
        }),
        (this.after = { tl: null }),
        (this.scrollto = { tl: null, ing: !1 }));
      const d =
          null != t && null !== (e = t.timers) && void 0 !== e && e.complete
            ? Number(t.timers.complete)
            : 30,
        p =
          null != t && null !== (i = t.timers) && void 0 !== i && i.after
            ? Number(t.timers.after)
            : 500,
        m =
          null != t && null !== (n = t.timers) && void 0 !== n && n.resize
            ? Number(t.timers.resize)
            : 500;
      ((this.timers = {
        complete: { timer: null, wait: d },
        after: { timer: null, wait: p },
        resize: { timer: null, wait: m },
      }),
        (this.speed = t.speed || 100),
        "vr" === this.dir &&
          (this.speed *= window.innerHeight / window.innerWidth),
        (this.power = {
          max: t.max ? t.max : 4,
          hitory: [],
          delta1: 0,
          delta2: 0,
          pow0: { value: 0 },
          pow1: {
            value: 0,
            duration:
              (null == t || null === (r = t.power1) || void 0 === r
                ? void 0
                : r.duration) || 0.2,
            ease:
              (null == t || null === (s = t.power1) || void 0 === s
                ? void 0
                : s.ease) || "power1.out",
            tween: null,
          },
          pow2: {
            value: 0,
            duration:
              (null == t || null === (o = t.power2) || void 0 === o
                ? void 0
                : o.duration) || 1,
            ease:
              (null == t || null === (a = t.power2) || void 0 === a
                ? void 0
                : a.ease) || "power1.out",
            tween: null,
          },
        }),
        "function" == typeof t.onUpdateBefore &&
          (this.onUpdateBefore = () => t.onUpdateBefore(this)),
        "function" == typeof t.onUpdateAfter &&
          (this.onUpdateAfter = () => t.onUpdateAfter(this)),
        "function" == typeof t.onDragStart &&
          (this.onDragStart = () => t.onDragStart(this)),
        "function" == typeof t.onDragging &&
          (this.onDragging = () => t.onDragging(this)),
        "function" == typeof t.onDragEnd &&
          (this.onDragEnd = () => t.onDragEnd(this)));
      const f = t.scrollbar.wrapClassName
          ? "." + t.scrollbar.wrapClassName
          : ".c-scbar",
        g = t.scrollbar.thumbClassName
          ? "." + t.scrollbar.thumbClassName
          : ".c-thumb",
        v = t.scrollbar.pivotClassName
          ? "." + t.scrollbar.pivotClassName
          : ".c-pivot",
        _ = document.querySelector(f),
        y = document.querySelector(g);
      (null !== (l = this.prop) &&
      void 0 !== l &&
      null !== (h = l.scrollbar) &&
      void 0 !== h &&
      h.enable &&
      _ &&
      y
        ? ((_.dataset.dir = this.dir),
          (this.scrollbar = {
            progress: 0,
            enable: !0,
            wrap: { el: _, rect: { width: 0, height: 0 } },
            thumb: {
              el: y,
              before: y.querySelectorAll(v)[0],
              after: y.querySelectorAll(v)[1],
              volume: 0,
              px: 0,
            },
          }))
        : (this.scrollbar = { enable: !1 }),
        this.reduced && (this.touch.ratio = 1));
      const x =
        !0 ===
        (null === (c = this.prop) ||
        void 0 === c ||
        null === (u = c.sync) ||
        void 0 === u
          ? void 0
          : u.enable);
      if (((this.sync = { enable: !1, body: null, el: null }), x)) {
        var S, w, E, T;
        const t = this.wrap.el.querySelectorAll(
            null === (S = this.prop) ||
              void 0 === S ||
              null === (w = S.sync) ||
              void 0 === w
              ? void 0
              : w.el,
          ),
          e = this.wrap.el.querySelector(
            null === (E = this.prop) ||
              void 0 === E ||
              null === (T = E.sync) ||
              void 0 === T
              ? void 0
              : T.body,
          );
        ((this.sync.enable = !(!t.length || !e)),
          (this.sync.body = e),
          (this.sync.el = t),
          this.wrap.el.classList.add("is-scroll-sync"));
      }
      ((this.control = {
        index: 0,
        ing: !1,
        enable: !1,
        duration: 1,
        ease: "power2.out",
        ...t.control,
      }),
        this.onRunRabbit());
    }
    onRunRabbit() {
      if (this.content.el && this.body.el) {
        const i = this.body.el.querySelectorAll(this.prop.section);
        if (this.fillscreen)
          for (let t = 0; t < i.length; t++) {
            const e = i[t];
            ((e.style.width = window.innerWidth + "px"),
              (e.style.height = window.innerHeight + "px"));
          }
        else
          for (let t = 0; t < i.length; t++) {
            const e = i[t];
            ((e.style.width = "auto"), (e.style.height = "auto"));
          }
        const n = this.body.el.querySelectorAll(this.prop.section + ".c-clone");
        for (let t = 0; t < n.length; t++) this.content.el.removeChild(n[t]);
        if (this.sync.enable) {
          var t, e;
          const i = this.wrap.el.querySelectorAll(
            (null === (t = this.prop) ||
            void 0 === t ||
            null === (e = t.sync) ||
            void 0 === e
              ? void 0
              : e.el) + ".c-clone",
          );
          for (let t = 0; t < i.length; t++) this.wrap.el.removeChild(i[t]);
        }
        for (; this.totalHeight <= 1.5 * this.windowHeight; ) {
          const t = this.body.el.querySelectorAll(this.prop.section);
          for (let e = 0; e < t.length; e++) {
            const i = t[e].getBoundingClientRect(),
              n = "hr" === this.dir ? i.width : i.height;
            this.totalHeight += 0 === n ? this.windowHeight : n;
          }
          if (this.totalHeight <= 1.5 * this.windowHeight)
            for (let e = 0; e < t.length; e++) {
              const i = t[e].cloneNode(!0);
              if (
                (i.classList.add("c-clone"),
                this.content.el.append(i),
                this.sync.enable)
              ) {
                const t = this.wrap.el
                  .querySelectorAll(this.prop.sync.el)
                  [e].cloneNode(!0);
                (t.classList.add("c-clone"), this.sync.body.append(t));
              }
            }
        }
        ((this.ready = !0),
          (this.stopped = !1),
          this.addEvents(),
          this.onInitInterSection(),
          this.onResize(0),
          this.autocenter && this.onScrollToIndex(0));
      }
    }
    get ease() {
      return this._ease;
    }
    get speed() {
      return this._speed;
    }
    set ease(t) {
      this._ease = this._easeorigin = t;
    }
    set speed(t) {
      this._speed = t;
    }
    onInitInterSection() {
      this.sections = {
        el: this.body.el.querySelectorAll(this.prop.section),
        elems: [],
      };
      for (let i = 0; i < this.sections.el.length; i++) {
        var t, e;
        const n = this.sections.el[i];
        n.dataset.index = i;
        const r = n.getBoundingClientRect(),
          s = this.sync.enable
            ? this.wrap.el.querySelectorAll(
                null === (t = this.prop) ||
                  void 0 === t ||
                  null === (e = t.sync) ||
                  void 0 === e
                  ? void 0
                  : e.el,
              )[i]
            : null,
          o = n.dataset.slug ? n.dataset.slug : null;
        this.sections.elems.push({
          el: n,
          slug: o,
          sync: s,
          inner: n.querySelector(this.prop.inner),
          rect: r,
          selected: !1,
          centered: !1,
          visible: !0,
          progress: 0,
          x: 0,
          y: 0,
          cx: 0,
          cy: 0,
        });
      }
      this.inview &&
        ((this.targets = [...this.sections.el]),
        this.targets.length &&
          ((this.options = { threshold: 0 }),
          (this.observer = new IntersectionObserver(
            this.onVisibleChange,
            this.options,
          )),
          this.targets.forEach((t, e) => {
            this.observer.observe(t);
          })));
    }
    onVisibleChange(t) {
      t.forEach((t) => {
        const e = t.target,
          i = t.isIntersecting;
        if (
          (i
            ? ((e.dataset.shown = 1), (e.dataset.visible = 1))
            : (e.dataset.visible = 0),
          this.sync.enable)
        ) {
          const t = Number(e.dataset.index),
            n = this.sections.elems[t].sync;
          i
            ? ((n.dataset.shown = 1), (n.dataset.visible = 1))
            : (n.dataset.visible = 0);
        }
      });
    }
    onDestroy() {
      const t = this;
      (this.observer &&
        (this.targets.forEach((e, i) => {
          t.observer.disconnect(e);
        }),
        (this.targets = null),
        (this.observer = null)),
        this.removeEvents(),
        this.onReset());
    }
    onComplete() {
      ((this.power.pow0.value = 0),
        this.power.pow1.tween && this.power.pow1.tween.kill(),
        (this.power.pow1.tween = gsap.to(
          this.power.pow1,
          this.power.pow1.duration,
          { value: 0 },
        )),
        this.power.pow2.tween && this.power.pow2.tween.kill(),
        (this.power.pow2.tween = gsap.to(
          this.power.pow2,
          this.power.pow2.duration,
          { value: 0 },
        )),
        (this.ing = !1));
    }
    onTouchComplete() {
      this.ing = !1;
    }
    getMaxIndex(t) {
      let e = 0,
        i = -1 / 0;
      for (let n = 0, r = t.length; n < r; n++)
        i < t[n] && ((i = t[n]), (e = n));
      return e;
    }
    getMinIndex(t) {
      let e = 0,
        i = 1 / 0;
      for (let n = 0, r = t.length; n < r; n++)
        i > t[n] && ((i = t[n]), (e = n));
      return e;
    }
    onAfter(t = 1, e = "power2.out") {
      if (!this.autocenter) return !1;
      const i =
          "hr" === this.dir
            ? this.sections.elems[0].rect.width
            : this.sections.elems[0].rect.height,
        n =
          "hr" === this.dir
            ? this.content.rect.width
            : this.content.rect.height,
        r = this.centerIndex + 1,
        s = this.scroll.progress - this.scroll.loop;
      ((this.isLastSection = s <= 1 && s >= 1 - 1 / this.sections.elems.length),
        (this.isFirstSection = 1 === r || this.isLastSection),
        this.fillscreen &&
          (this.isFirstSection = 1 === r && this.isLastSection));
      let o = r * i + this.scroll.loop * n - this.windowHeight / 2 - i / 2;
      (this.isFirstSection &&
        "down" === this.scroll.dir &&
        (o =
          r * i + (this.scroll.loop + 1) * n - this.windowHeight / 2 - i / 2),
        this.isFirstSection &&
          "up" === this.scroll.dir &&
          (o =
            r * i + (this.scroll.loop + 1) * n - this.windowHeight / 2 - i / 2),
        (this.after.tl = gsap.to(this, { duration: t, ease: e, delta1: o })));
    }
    onScrollTo(t = 0, e = 1, i = 0, n = "power2.out") {
      (this.onReset(),
        (this.scrollto.ing = !0),
        (this.autoscroll.x = 0),
        (this.autoscroll.y = 0),
        (this.scrollto.tl = gsap.to(this, {
          duration: e,
          ease: n,
          delay: i,
          delta1: t,
          onComplete: () => {
            this.scrollto.ing = !1;
          },
        })));
    }
    setScrollTo(t = 0) {
      if (
        (this.onReset(),
        (this.delta1 = t),
        (this.autoscroll.x = 0),
        (this.autoscroll.y = 0),
        this.infinite)
      )
        ((this.scroll.x = this.delta1),
          (this.scroll.left = this.scroll.x % this.content.rect.width),
          (this.scroll.y = this.delta1),
          (this.scroll.top = this.scroll.y % this.content.rect.height));
      else {
        if ("hr" === this.dir)
          this.delta1 = this.clamp(
            this.delta1,
            0,
            this.content.rect.width - window.innerWidth,
          );
        else
          this.delta1 = this.clamp(
            this.delta1,
            0,
            this.content.rect.height - window.innerHeight,
          );
        ((this.delta2 = this.delta1),
          (this.scroll.x = this.delta2),
          (this.scroll.left = this.delta2),
          (this.scroll.y = this.delta2),
          (this.scroll.top = this.delta2));
      }
    }
    onScrollToIndex(t = this.currentIndex, e = 1, i = 0, n = "power2.out") {
      (this.onReset(),
        (this.scrollto.ing = !0),
        (this.autoscroll.x = 0),
        (this.autoscroll.y = 0),
        this.reduced && (e = 0.2));
      const r =
          "hr" === this.dir
            ? this.sections.elems[0].rect.width
            : this.sections.elems[0].rect.height,
        s =
          "hr" === this.dir
            ? this.content.rect.width
            : this.content.rect.height,
        o = this.clamp(t + 1, 0, this.sections.elems.length),
        a = this.scroll.progress - this.scroll.loop;
      let l = o * r + this.scroll.loop * s - this.windowHeight / 2 - r / 2;
      ((this.isLastSection = a <= 1 && a >= 1 - 1 / this.sections.elems.length),
        this.isLastSection &&
          "down" === this.scroll.dir &&
          (l =
            o * r + (this.scroll.loop + 1) * s - this.windowHeight / 2 - r / 2),
        this.isLastSection &&
          "up" === this.scroll.dir &&
          (l =
            o * r + (this.scroll.loop + 1) * s - this.windowHeight / 2 - r / 2),
        (this.scrollto.tl = gsap.to(this, {
          duration: e,
          ease: n,
          delay: i,
          delta1: l,
          onComplete: () => {
            this.scrollto.ing = !1;
          },
        })));
    }
    setScrollToIndex(t = this.currentIndex) {
      (this.onReset(), this.reduced && (s = 0.2));
      const e =
          "hr" === this.dir
            ? this.sections.elems[0].rect.width
            : this.sections.elems[0].rect.height,
        i =
          "hr" === this.dir
            ? this.content.rect.width
            : this.content.rect.height,
        n = this.clamp(t + 1, 0, this.sections.elems.length),
        r = this.scroll.progress - this.scroll.loop;
      this.isLastSection = r <= 1 && r >= 1 - 1 / this.sections.elems.length;
      let o = n * e + this.scroll.loop * i - this.windowHeight / 2 - e / 2;
      if (
        (this.isLastSection &&
          "down" === this.scroll.dir &&
          (o =
            n * e + (this.scroll.loop + 1) * i - this.windowHeight / 2 - e / 2),
        this.isLastSection &&
          "up" === this.scroll.dir &&
          (o =
            n * e + (this.scroll.loop + 1) * i - this.windowHeight / 2 - e / 2),
        (this.delta1 = o),
        this.infinite)
      )
        ((this.scroll.x = this.delta1),
          (this.scroll.left = this.scroll.x % this.content.rect.width),
          (this.scroll.y = this.delta1),
          (this.scroll.top = this.scroll.y % this.content.rect.height));
      else {
        if ("hr" === this.dir)
          this.delta1 = this.clamp(
            this.delta1,
            0,
            this.content.rect.width - window.innerWidth,
          );
        else
          this.delta1 = this.clamp(
            this.delta1,
            0,
            this.content.rect.height - window.innerHeight,
          );
        ((this.delta2 = this.delta1),
          (this.scroll.x = this.delta2),
          (this.scroll.left = this.delta2),
          (this.scroll.y = this.delta2),
          (this.scroll.top = this.delta2));
      }
      if ("hr" === this.dir)
        ((this.scroll.progress = this.scroll.x / this.content.rect.width),
          (this.scroll.loop = Math.floor(this.scroll.progress)));
      else
        ((this.scroll.progress = this.scroll.y / this.content.rect.height),
          (this.scroll.loop = Math.floor(this.scroll.progress)));
    }
    onScrollToNext() {
      if (this.scrollto.ing) return !1;
      ((this.control.index = this.currentIndex - 1),
        this.setScrollToIndex(this.control.index),
        this.control.index >= 0 &&
        this.control.index < this.sections.elems.length - 1
          ? ((this.control.index += 1),
            this.onScrollToIndex(
              this.control.index,
              this.control.duration,
              0,
              this.control.ease,
            ))
          : ((this.control.index = -1),
            this.setScrollToIndex(-1),
            this.onScrollToIndex(
              0,
              this.control.duration,
              0,
              this.control.ease,
            )));
    }
    onScrollToPrev() {
      if (this.scrollto.ing) return !1;
      ((this.control.index = this.currentIndex - 1),
        this.setScrollToIndex(this.control.index),
        0 === this.control.index
          ? ((this.control.index = -1),
            this.onScrollToIndex(
              this.control.index,
              this.control.duration,
              0,
              this.control.ease,
            ),
            (this.control.index = this.sections.elems.length - 1))
          : this.control.index === this.sections.elems.length - 1
            ? ((this.control.index = this.sections.elems.length - 1),
              this.setScrollToIndex(this.sections.elems.length - 1),
              this.onScrollToIndex(
                this.sections.elems.length - 2,
                this.control.duration,
                0,
                this.control.ease,
              ))
            : ((this.control.index -= 1),
              this.onScrollToIndex(
                this.control.index,
                this.control.duration,
                0,
                this.control.ease,
              )));
    }
    scrollSet() {
      if (!this.touch.thumb) return !1;
      this.onReset();
      const t =
          "hr" === this.dir
            ? this.sections.elems[0].rect.width
            : this.sections.elems[0].rect.height,
        e =
          "hr" === this.dir
            ? this.content.rect.width
            : this.content.rect.height;
      if ("hr" === this.dir) {
        const i =
            (this.touch.start.x - this.scrollbar.thumb.px / 2) /
            window.innerWidth,
          n = this.autocenter ? Math.round((i * e) / t) * t : i * e;
        this.detail.d =
          this.scroll.left =
          this.scroll.x =
          this.delta1 =
          this.delta2 =
            n;
      } else {
        const i =
            (this.touch.start.y - this.scrollbar.thumb.px / 2) /
            window.innerHeight,
          n = this.autocenter ? Math.round((i * e) / t) * t : i * e;
        this.detail.d =
          this.scroll.top =
          this.scroll.y =
          this.delta1 =
          this.delta2 =
            n;
      }
      this.power.delta1 = Math.abs(this.detail.d);
    }
    getSpeed(t = 1) {
      this.power.hitory.length > 2 && !this.reduced
        ? (this.power.hitory.shift(),
          this.power.hitory.push(this.power.delta2),
          (this.power.pow0.value = Math.min(
            Math.abs((this.power.hitory[0] - this.power.hitory[2]) * t),
            this.power.max,
          )),
          (this.power.pow1.tween = gsap.to(this.power.pow1, {
            duration: this.power.pow1.duration,
            ease: this.power.pow1.ease,
            value: this.power.pow0.value,
          })),
          (this.power.pow2.tween = gsap.to(this.power.pow2, {
            duration: this.power.pow2.duration,
            ease: this.power.pow2.ease,
            value: this.power.pow0.value,
          })))
        : this.power.hitory.push(this.power.delta2);
    }
    clamp(t, e, i) {
      return Math.min(Math.max(t, e), i);
    }
    roundToNearest(t, e = 1e-6) {
      return Math.abs(1 - Math.abs(t)) < e ? Math.sign(t) : t;
    }
    raf() {
      if (!this.ready) return !1;
      if (
        (this.onUpdateBefore && this.onUpdateBefore(),
        this.reduced != this.prop.reduced &&
          (this.onReset(),
          this.reduced
            ? ((this.ease.power = this.ease.origin = 1),
              (this.touch.ratio = 1),
              (this.prop.reduced = !0))
            : ((this.ease.power = this.ease.origin =
                this.prop.ease ? this.prop.ease : 0.2),
              (this.touch.ratio = this.prop.touch.ratio),
              (this.prop.reduced = !1))),
        this.infinite)
      )
        (!this.autoscroll.enable ||
          this.touch.active ||
          this.scrollto.ing ||
          (this.autoscroll.x += this.autoscroll.speed),
          (this.scroll.x +=
            this.autoscroll.x +
            (this.delta1 - this.scroll.x) * this.ease.power),
          0.001 >= Math.abs(this.scroll.x) && (this.scroll.x = 0),
          (this.scroll.left = this.scroll.x % this.content.rect.width),
          !this.autoscroll.enable ||
            this.touch.active ||
            this.scrollto.ing ||
            (this.autoscroll.y += this.autoscroll.speed),
          (this.scroll.y +=
            this.autoscroll.y +
            (this.delta1 - this.scroll.y) * this.ease.power),
          0.001 >= Math.abs(this.scroll.y) && (this.scroll.x = 0),
          (this.scroll.top = this.scroll.y % this.content.rect.height));
      else {
        if ("hr" === this.dir)
          this.delta1 = this.clamp(
            this.delta1,
            0,
            this.content.rect.width - window.innerWidth,
          );
        else
          this.delta1 = this.clamp(
            this.delta1,
            0,
            this.content.rect.height - window.innerHeight,
          );
        ((this.delta2 += (this.delta1 - this.delta2) * this.ease.power),
          (this.scroll.x += (this.delta2 - this.scroll.x) * this.ease.power),
          0.001 >= Math.abs(this.scroll.x) && (this.scroll.x = 0),
          (this.scroll.left = this.delta2),
          (this.scroll.y += (this.delta2 - this.scroll.y) * this.ease.power),
          0.001 >= Math.abs(this.scroll.y) && (this.scroll.x = 0),
          (this.scroll.top = this.delta2));
      }
      if ("hr" === this.dir)
        ((this.scroll.progress = this.scroll.x / this.content.rect.width),
          (this.scroll.loop = Math.floor(this.scroll.progress)));
      else
        ((this.scroll.progress = this.scroll.y / this.content.rect.height),
          (this.scroll.loop = Math.floor(this.scroll.progress)));
      if ("hr" === this.dir) {
        this.position.value =
          (this.scroll.left % this.content.rect.width) /
          this.content.rect.width;
        for (let t = 0; t < this.sections.elems.length; t++) {
          const e = this.sections.elems[t];
          ((e.x = -1 * this.scroll.left),
            (e.y = 0),
            e.x < -e.rect.width - e.rect.left &&
              (e.x = e.x + this.content.rect.width),
            e.rect.left - -1 * e.x - window.innerWidth > 0 &&
              (e.x = e.x - this.content.rect.width));
          const i = e.x + e.rect.left,
            n = i + e.rect.width > 0,
            r = i - e.rect.width < window.innerWidth;
          ((e.cx = this.clamp(
            (i + window.innerWidth / 2) / window.innerWidth - 0.5,
            -1,
            1,
          )),
            Math.abs(e.cx) < 0.5
              ? ((this.currentIndex = t + 1), (e.selected = !0))
              : (e.selected = !1),
            (e.progress =
              r && n
                ? Math.abs(i / window.innerWidth) < 0.001
                  ? 0
                  : this.roundToNearest(i / window.innerWidth)
                : 2));
        }
        (this.scrollbar.enable &&
          ((this.scrollbar.progress =
            this.position.value * this.scrollbar.wrap.rect.width),
          this.position.value < 0
            ? ((this.scrollbar.thumb.before.style.transform = `translate3d(${this.scrollbar.progress + this.scrollbar.wrap.rect.width}px, 0, 0)`),
              (this.scrollbar.thumb.after.style.transform = `translate3d(${this.scrollbar.progress}px, 0, 0)`))
            : ((this.scrollbar.thumb.before.style.transform = `translate3d(${this.scrollbar.progress - this.scrollbar.wrap.rect.width}px, 0, 0)`),
              (this.scrollbar.thumb.after.style.transform = `translate3d(${this.scrollbar.progress}px, 0, 0)`))),
          this.infinite ||
            (this.position.value =
              this.scroll.left /
              (this.content.rect.width - window.innerWidth)));
      } else {
        this.position.value =
          (this.scroll.top % this.content.rect.height) /
          this.content.rect.height;
        for (let t = 0; t < this.sections.elems.length; t++) {
          const e = this.sections.elems[t];
          ((e.x = 0),
            (e.y = -1 * this.scroll.top),
            e.y < -e.rect.height - e.rect.top &&
              (e.y = e.y + this.content.rect.height),
            e.rect.top - -1 * e.y - window.innerHeight > 0 &&
              (e.y = e.y - this.content.rect.height));
          const i = e.y + e.rect.top,
            n = i + e.rect.height > 0,
            r = i - e.rect.height < window.innerHeight;
          ((e.cy = this.clamp(
            (i + window.innerHeight / 2) / window.innerHeight - 0.5,
            -1,
            1,
          )),
            Math.abs(e.cy) < 0.5
              ? ((this.currentIndex = t + 1), (e.selected = !0))
              : (e.selected = !1),
            (e.progress =
              r && n
                ? Math.abs(i / window.innerHeight) < 0.001
                  ? 0
                  : this.roundToNearest(i / window.innerHeight)
                : 2));
        }
        (this.scrollbar.enable &&
          ((this.scrollbar.progress =
            this.position.value * this.scrollbar.wrap.rect.height),
          this.position.value < 0
            ? ((this.scrollbar.thumb.before.style.transform = `translate3d(0, ${this.scrollbar.progress}px, 0)`),
              (this.scrollbar.thumb.after.style.transform = `translate3d(0, ${this.scrollbar.progress + this.scrollbar.wrap.rect.height}px, 0)`))
            : ((this.scrollbar.thumb.before.style.transform = `translate3d(0, ${this.scrollbar.progress - this.scrollbar.wrap.rect.height}px, 0)`),
              (this.scrollbar.thumb.after.style.transform = `translate3d(0, ${this.scrollbar.progress}px, 0)`))),
          this.infinite ||
            (this.position.value =
              this.scroll.top /
              (this.content.rect.height - window.innerHeight)));
      }
      let t = [],
        e = [];
      for (let i = 0; i < this.sections.elems.length; i++) {
        const n = this.sections.elems[i];
        if (n.selected) {
          const r = "hr" === this.dir ? n.cx : n.cy;
          (t.push(Math.abs(r - 0.5)), e.push(i));
        }
      }
      this.onUpdateAfter && this.onUpdateAfter();
    }
    onReset() {
      (this.after.tl && (this.after.tl.kill(), (this.after.tl = null)),
        this.scrollto.tl &&
          (this.scrollto.tl.kill(),
          (this.scrollto.tl = null),
          (this.scrollto.ing = !1)),
        clearTimeout(this.timers.complete.timer),
        clearTimeout(this.timers.after.timer));
    }
    getDetail(t) {
      let e = 0;
      const i = t.deltaX
          ? -t.deltaX
          : t.wheelDeltaX
            ? t.wheelDeltaX
            : -t.detail,
        n = t.deltaY ? -t.deltaY : t.wheelDeltaY ? t.wheelDeltaY : -t.detail,
        r = t.deltaY ? -t.deltaY : t.wheelDelta ? t.wheelDelta : -t.detail,
        s = t.detail;
      if (
        ((e = s ? (r ? ((r / s / 40) * s > 0 ? 1 : -1) : -s / 3) : r / 120), s)
      ) {
        if (n) {
          return {
            x: (i / s / 40) * s > 0 ? 1 : -1,
            y: (n / s / 40) * s > 0 ? 1 : -1,
            d: e,
          };
        }
        return { x: 0, y: -s / 3, d: e };
      }
      return { x: i / 120, y: n / 120, d: e };
    }
    stop() {
      this.stopped = !0;
    }
    start() {
      this.stopped = !1;
    }
    onWheel(t) {
      if (!this.ready || this.stopped) return !1;
      this.onReset();
      const e = this.getDetail(t);
      ((this.detail.d = e.x + e.y),
        (this.delta1 += -this.detail.d * this.speed),
        (this.power.delta1 += Math.abs(this.detail.d)),
        (this.power.delta2 += Math.abs(this.detail.d)),
        this.getSpeed(1),
        (this.ing = !0),
        (this.scroll.dir = this.detail.d < 0 ? "down" : "up"),
        (this.timers.complete.timer = setTimeout(() => {
          this.onComplete();
        }, this.timers.complete.wait)),
        (this.timers.after.timer = setTimeout(() => {
          this.onAfter();
        }, this.timers.after.wait)));
    }
    onResize(t) {
      if (!this.ready) return !1;
      const e = 0 === t ? 0 : this.timers.resize.wait;
      ((this.windowHeight =
        "hr" === this.dir ? window.innerWidth : window.innerHeight),
        clearTimeout(this.timers.resize.timer),
        (this.timers.resize.timer = setTimeout(() => {
          if (this.fillscreen)
            for (let t = 0; t < this.sections.elems.length; t++) {
              const e = this.sections.elems[t];
              ((e.el.style.width = window.innerWidth + "px"),
                (e.el.style.height = window.innerHeight + "px"));
            }
          else
            for (let t = 0; t < this.sections.elems.length; t++) {
              const e = this.sections.elems[t];
              ((e.el.style.width = "auto"), (e.el.style.height = "auto"));
            }
          if (((this.content.el.style.width = "auto"), "hr" === this.dir)) {
            let t = 0;
            for (let e = 0; e < this.sections.elems.length; e++) {
              const i = this.sections.elems[e];
              (!this.sync.enable &&
                this.dom &&
                (i.el.style.transform = "translate3d(0, 0, 0)"),
                (i.rect = i.el.getBoundingClientRect()),
                (t += i.rect.width));
            }
            this.content.el.style.width = t + "px";
          }
          for (let t = 0; t < this.sections.elems.length; t++) {
            const e = this.sections.elems[t];
            ((e.y = 0),
              !this.sync.enable &&
                this.dom &&
                (e.el.style.transform = "translate3d(0, 0, 0)"),
              (e.rect = e.el.getBoundingClientRect()),
              (e.x = this.scroll.left),
              (e.y = this.scroll.top),
              !this.sync.enable &&
                this.dom &&
                (e.el.style.transform =
                  "translate3d(" + -e.x + "px, " + -e.y + "px, 0)"));
          }
          if (
            ((this.body.rect = this.body.el.getBoundingClientRect()),
            (this.content.rect = this.content.el.getBoundingClientRect()),
            this.scrollbar.enable)
          )
            if (
              ((this.scrollbar.wrap.rect =
                this.scrollbar.wrap.el.getBoundingClientRect()),
              "hr" === this.dir)
            )
              ((this.scrollbar.thumb.scale =
                window.innerWidth / this.content.rect.width),
                (this.scrollbar.thumb.volume =
                  this.scrollbar.wrap.rect.width / this.content.rect.width),
                (this.scrollbar.thumb.px =
                  this.scrollbar.thumb.scale * this.scrollbar.wrap.rect.width),
                (this.scrollbar.thumb.before.style.width =
                  this.scrollbar.thumb.px + "px"),
                (this.scrollbar.thumb.after.style.width =
                  this.scrollbar.thumb.px + "px"),
                (this.scrollbar.thumb.before.style.height = "100%"),
                (this.scrollbar.thumb.after.style.height = "100%"));
            else
              ((this.scrollbar.thumb.scale =
                window.innerHeight / this.content.rect.height),
                (this.scrollbar.thumb.volume =
                  this.scrollbar.wrap.rect.height / this.content.rect.height),
                (this.scrollbar.thumb.px =
                  this.scrollbar.thumb.scale * this.scrollbar.wrap.rect.height),
                (this.scrollbar.thumb.before.style.height =
                  this.scrollbar.thumb.px + "px"),
                (this.scrollbar.thumb.after.style.height =
                  this.scrollbar.thumb.px + "px"),
                (this.scrollbar.thumb.before.style.width = "100%"),
                (this.scrollbar.thumb.after.style.width = "100%"));
        }, e)));
    }
    onTouchStart(t) {
      (this.onDragStart && this.onDragStart(), (this.draggable = !0));
      for (let e = 0; e < this.disableDragByTagName.length; e++) {
        const i = this.disableDragByTagName[e];
        t.target.tagName === i && (this.draggable = !1);
      }
      for (let e = 0; e < this.enableDragByClassName.length; e++) {
        const i = this.enableDragByClassName[e];
        t.target.classList.contains(i) && (this.draggable = !0);
      }
      if (this.stopped && this.draggable) return !1;
      (this.onReset(),
        (this.touch.thumb = t.target.classList.contains(
          this.prop.scrollbar.thumbClassName,
        )),
        (this.touch.pivot = t.target.classList.contains(
          this.prop.scrollbar.pivotClassName,
        )),
        this.touch.pivot && this.html.classList.add("is-dragging"));
      let e = t.clientX,
        i = t.clientY;
      (t.touches &&
        t.touches[0] &&
        ((e = t.touches[0].clientX), (i = t.touches[0].clientY)),
        (this.touch.start.x = e),
        (this.touch.start.y = i),
        (this.touch.dist.x = 0),
        (this.touch.dist.y = 0),
        (this.touch.dist.xy = 0),
        t.touches && t.touches.length > 1 && t.preventDefault(),
        (this.touch.active = !0),
        (this.touch.start.delta = this.delta1),
        (this.power.pow0.value = 0),
        this.scrollSet());
    }
    onTouchMove(t) {
      if (this.touch.thumb || this.stopped) return !1;
      let e = t.clientX,
        i = t.clientY;
      if (
        (t.touches && t.touches[0]
          ? ((e = t.touches[0].clientX), (i = t.touches[0].clientY))
          : t.originalEvent &&
            t.originalEvent.changedTouches[0] &&
            ((e = t.originalEvent.changedTouches[0].clientX),
            (i = t.originalEvent.changedTouches[0].clientY)),
        (this.touch.ing.x = e),
        (this.touch.ing.y = i),
        (this.touch.dist.x = this.touch.start.x - e),
        (this.touch.dist.y = this.touch.start.y - i),
        (this.touch.dist.xy = this.touch.dist.x + this.touch.dist.y),
        this.touch.active)
      )
        if ((this.onDragging(), this.touch.pivot && this.scrollbar.enable))
          switch (this.touchDir) {
            case "auto":
            case "hr":
              ((this.touch.delta =
                (1 * -this.touch.dist.x) / this.scrollbar.thumb.volume +
                this.touch.start.delta),
                (this.delta1 = this.touch.delta),
                (this.power.delta1 += Math.abs(this.touch.dist.x)));
              break;
            default:
              ((this.touch.delta =
                (1 * -this.touch.dist.y) / this.scrollbar.thumb.volume +
                this.touch.start.delta),
                (this.delta1 = this.touch.delta),
                (this.power.delta1 += Math.abs(this.touch.dist.y)));
          }
        else
          switch (this.touchDir) {
            case "auto":
              ((this.touch.delta =
                this.touch.dist.xy *
                  this.touch.ratio *
                  Math.abs(1 + this.power.pow0.value) +
                this.touch.start.delta),
                (this.touch.dir = this.touch.dist.xy > 0 ? 1 : -1),
                (this.touch.throw.buffer = window.innerHeight),
                (this.delta1 = this.touch.delta),
                (this.power.delta1 += this.touch.dist.xy * this.touch.ratio));
              break;
            case "hr":
              ((this.touch.delta =
                this.touch.dist.x *
                  this.touch.ratio *
                  Math.abs(1 + this.power.pow0.value) +
                this.touch.start.delta),
                (this.touch.dir = this.touch.dist.x > 0 ? 1 : -1),
                (this.touch.throw.buffer = window.innerHeight),
                (this.delta1 = this.touch.delta),
                (this.power.delta1 += Math.abs(
                  this.touch.dist.x * this.touch.ratio,
                )));
              break;
            default:
              ((this.touch.delta =
                this.touch.dist.y *
                  this.touch.ratio *
                  Math.abs(1 + this.power.pow0.value) +
                this.touch.start.delta),
                (this.touch.dir = this.touch.dist.y > 0 ? 1 : -1),
                (this.touch.throw.buffer = 1.5 * window.innerHeight),
                (this.delta1 = this.touch.delta),
                (this.power.delta1 += Math.abs(
                  this.touch.dist.y * this.touch.ratio,
                )));
          }
    }
    onTouchEnd(t) {
      if (
        (this.onDragEnd && this.onDragEnd(), this.touch.thumb || this.stopped)
      )
        return !1;
      ((this.touch.pivot = !1),
        (this.touch.thumb = !1),
        this.html.classList.remove("is-dragging"),
        (this.timers.complete.timer = setTimeout(() => {
          this.onTouchComplete();
        }, this.timers.complete.wait)),
        (this.timers.after.timer = setTimeout(() => {
          this.onAfter();
        }, this.timers.after.wait)),
        (this.touch.dist.x = 0),
        (this.touch.dist.y = 0),
        (this.touch.dist.xy = 0),
        (this.touch.active = !1),
        (this.power.pow0.value = 0));
    }
    onKeyScroll(t) {
      if (!this.ready || this.stopped) return !1;
      switch ((this.onReset(), t.code)) {
        case "ArrowRight":
        case "ArrowDown":
          this.delta1 += 40;
          break;
        case "ArrowUp":
        case "ArrowLeft":
          this.delta1 -= 40;
          break;
        case "Space":
          "hr" === this.dir
            ? (this.delta1 += window.innerWidth)
            : (this.delta1 += window.innerHeight);
      }
      ((this.timers.complete.timer = setTimeout(() => {
        this.onComplete();
      }, this.timers.complete.wait)),
        (this.timers.after.timer = setTimeout(() => {
          this.onAfter();
        }, this.timers.after.wait)));
    }
    onKeyControl(t) {
      if (!this.ready || this.stopped) return !1;
      switch (t.code) {
        case "Space":
        case "ArrowRight":
        case "ArrowDown":
          this.onScrollToNext();
          break;
        case "ArrowUp":
        case "ArrowLeft":
          this.onScrollToPrev();
      }
    }
    addEvents() {
      ((this.onWheel = this.onWheel.bind(this)),
        (this.onResize = this.onResize.bind(this)),
        (this.onTouchStart = this.onTouchStart.bind(this)),
        (this.onTouchMove = this.onTouchMove.bind(this)),
        (this.onTouchEnd = this.onTouchEnd.bind(this)),
        this.keyScroll && (this.onKeyScroll = this.onKeyScroll.bind(this)),
        this.control.enable &&
          (this.onKeyControl = this.onKeyControl.bind(this)),
        window.addEventListener("wheel", this.onWheel, { passive: !0 }),
        window.addEventListener("resize", this.onResize),
        this.touch.enable &&
          window.addEventListener("touchstart", this.onTouchStart, {
            passive: !0,
          }),
        this.touch.enable &&
          window.addEventListener("touchmove", this.onTouchMove, {
            passive: !0,
          }),
        this.touch.enable &&
          window.addEventListener("touchend", this.onTouchEnd),
        this.touch.enable &&
          window.addEventListener("mousedown", this.onTouchStart),
        this.touch.enable &&
          window.addEventListener("mousemove", this.onTouchMove),
        this.touch.enable &&
          window.addEventListener("mouseup", this.onTouchEnd),
        this.touch.enable &&
          document.addEventListener("mouseleave", this.onTouchEnd),
        this.keyScroll &&
          document.addEventListener("keydown", this.onKeyScroll),
        this.control.enable &&
          document.addEventListener("keydown", this.onKeyControl));
    }
    removeEvents() {
      (window.removeEventListener("wheel", this.onWheel),
        window.removeEventListener("resize", this.onResize),
        this.touch.enable &&
          window.removeEventListener("touchstart", this.onTouchStart),
        this.touch.enable &&
          window.removeEventListener("touchmove", this.onTouchMove),
        this.touch.enable &&
          window.removeEventListener("touchend", this.onTouchEnd),
        this.touch.enable &&
          window.removeEventListener("mousedown", this.onTouchStart),
        this.touch.enable &&
          window.removeEventListener("mousemove", this.onTouchMove),
        this.touch.enable &&
          window.removeEventListener("mouseup", this.onTouchEnd),
        this.touch.enable &&
          document.removeEventListener("mouseleave", this.onTouchEnd),
        this.keyScroll &&
          document.removeEventListener("keydown", this.onKeyScroll),
        this.control.enable &&
          document.removeEventListener("keydown", this.onKeyControl));
    }
    onDragStart() {}
    onDragging() {}
    onDragEnd() {}
  }
  window.PAGE_SCROLL_PROJECTS = {
    local: null,
    params: {
      speed: getParam("pj-s-s") ? Number(getParam("pj-s-s")) : 50,
      ease: 0.125,
      timers: { complete: 50, after: 500, resize: 500 },
    },
    ready: !1,
    wrap: null,
    section: null,
    onInit(t) {
      ((this.local = t || document.querySelector(".c-lc")),
        (this.wrap = this.local.querySelector('.c-sc-w[data-type="projects"]')),
        (this.section = this.local.querySelectorAll(".c-sc-sec")),
        this.wrap &&
          this.section &&
          ((this.body = new n({
            wrap: this.wrap,
            body: ".c-sc-body",
            content: ".c-sc-c",
            section: ".c-sc-sec",
            inner: ".c-sc-inner",
            speed: this.params.speed,
            ease: this.params.ease,
            dir: "hr",
            touchDir: "auto",
            infinite: !0,
            fillscreen: !1,
            autocenter: !1,
            reduced: !1,
            inview: !1,
            dom: !1,
            autoscroll: { enable: !0, speed: (WW / VW) * 0.15 },
            enableDragByClassName: [".c-sc-pivot"],
            scrollbar: {
              enable: !0,
              wrapClassName: "c-scbar",
              thumbClassName: "c-thumb",
              pivotClassName: "c-pivot",
            },
            timers: {
              complete: this.params.timers.complete,
              after: this.params.timers.after,
              resize: this.params.timers.resize,
            },
            touch: { enable: !0, ratio: 1.8 },
            power2: { duration: WEBGL.screen.acc.s, ease: WEBGL.screen.acc.e },
            sync: { enable: !0, body: ".c-sc-sync-body", el: ".c-sc-sync" },
            scroll: { progress: this.scroll.p },
            onDragStart(t) {
              $html.classList.add("is-dragging");
            },
            onDragEnd(t) {
              $html.classList.remove("is-dragging");
            },
            onUpdateAfter: (t) => {
              for (let e = 0; e < t.sections.elems.length; e++) {
                const i = t.sections.elems[e];
                i.cx;
                i.sync && this.onUpdateControl(e, i.sync.dataset.visible, i.cx);
              }
            },
          })),
          DETECT.os.win &&
            ((this.body.ease.power = 0.625 * this.params.ease),
            (this.body.speed = 1.1 * this.params.speed)),
          (this.scroll.offset =
            -WW / 2 +
            WEBGL.screen.dom.sync.width / 2 -
            WEBGL.screen.dom.sync.padding),
          0 === this.scroll.body
            ? this.body.setScrollTo(this.scroll.offset)
            : this.body.setScrollTo(this.scroll.body),
          this.onResize(),
          (this.ready = !0),
          this.onInitControl(),
          this.local.classList.add("is-scroll-ready")));
    },
    control: { el: null, array: [] },
    onInitControl() {
      this.control.el = this.local.querySelectorAll(".js-projects-scroll-to");
      for (let t = 0; t < this.control.el.length; t++) {
        const e = this.control.el[t];
        this.control.array.push({
          el: e,
          click: null,
          index: Number(e.dataset.index),
        });
      }
      this.control.array.forEach((t, e) => {
        ((t.click = (e) => {
          (e.preventDefault(),
            this.body &&
              this.body.onScrollToIndex(t.index, 1, 0, "power2.out"));
        }),
          t.el.addEventListener("click", t.click));
      });
    },
    onUpdateControl(t, e, i) {
      const n = this.control.array[t];
      n &&
        n.el &&
        (n.el.style.setProperty("--cx-a", 1 - Math.abs(i)),
        (n.el.dataset.visible = e));
    },
    scroll: { width: 0, offset: 0, body: 0, x: 0, p: 0 },
    onResize() {
      this.body && this.body.onResize();
    },
    time: 0,
    acc: 0,
    raf() {
      var t, e, i;
      if (
        (null !== (t = this.body) &&
          void 0 !== t &&
          null !== (e = t.content) &&
          void 0 !== e &&
          null !== (i = e.rect) &&
          void 0 !== i &&
          i.width &&
          (this.scroll.width = this.body.content.rect.width),
        this.body && this.ready)
      ) {
        (this.body.raf(),
          (this.acc = this.body.power.pow2.value / 4),
          (this.scroll.offset =
            -WW / 2 +
            WEBGL.screen.dom.sync.width / 2 -
            WEBGL.screen.dom.sync.padding / 2),
          (this.scroll.body = this.body.scroll.x));
        let t =
          ((this.scroll.body - this.scroll.offset) % this.scroll.width) /
          this.scroll.width;
        (isNaN(t) && (t = 0), (this.scroll.p = t < 0 ? 1 + t : t));
      }
    },
    onDestroy() {
      ($html.classList.remove("is-dragging"),
        this.control.array.forEach((t, e) => {
          (t.el.removeEventListener("click", t.click), (t.click = null));
        }),
        (this.control.array = []),
        this.body &&
          (this.body.onDestroy(), (this.body = null), (this.wrap = null)),
        (this.ready = !1));
    },
  };
}
