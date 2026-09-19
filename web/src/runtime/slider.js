// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  "use strict";
  class n {
    constructor(t) {
      ((this.prop = t),
        (this.el = t.el),
        (this.index = t.index || 0),
        (this.rect = {}),
        (this.ul = t.el.querySelector("[data-slide-ul]")),
        (this.li = t.el.querySelectorAll("[data-slide-li]")),
        (this.position = []));
      for (let t = 0; t < this.li.length; t++) {
        const e = this.li[t];
        this.position.push({ el: e, left: 0, width: 0 });
      }
      ((this.outer = Number(t.outer) ? Number(t.outer) : 0),
        (this.gutter = Number(t.gutter) ? Number(t.gutter) : 0),
        (this.guttertype = t.guttertype),
        (this.gutter_x = window.innerWidth * this.gutter),
        (this.outer_x = window.innerWidth * this.outer),
        (this.total = 0),
        (this.max = 0),
        (this.min = 0),
        (this.ease = t.ease
          ? t.ease
          : Number(this.el.dataset.ease)
            ? Number(this.el.dataset.ease)
            : 0.1),
        (this.speed = t.speed ? t.speed : 0),
        (this.x = 0),
        (this.progress = 0),
        (this.start = { enable: !1, x: 0 }),
        (this.ing = { x: 0 }),
        (this.end = { x: 0 }),
        (this.control = {
          ing: !1,
          tl: null,
          nextElem: t.nextElem || !1,
          prevElem: t.prevElem || !1,
          numElem: t.numElem || !1,
          numListeners: [],
          currentIndex: 0,
          max: this.li.length,
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
          (this.onDragEnd = () => t.onDragEnd(this)),
        this.initIntersection(),
        this.onResize(),
        this.addEvents());
    }
    onResetSlideTo() {
      this.control.tl &&
        (this.control.tl.kill(),
        (this.control.tl = null),
        (this.control.ing = !1));
    }
    onSlideToNext(t) {
      (t.preventDefault(),
        this.control.nextElem &&
          (this.control.currentIndex++,
          this.control.currentIndex >= this.control.max &&
            (this.control.currentIndex = 0),
          this.onSlideTo(-this.position[this.control.currentIndex].left)));
    }
    getCurrentIndex() {
      for (let t = 0; t < this.position.length; t++) {
        let e = this.position[t];
        if (
          -this.x + window.innerWidth / 2 >= e.left &&
          -this.x + window.innerWidth / 2 < e.left + e.width
        )
          return t;
      }
      return -1;
    }
    onSlideToPrev(t) {
      (t.preventDefault(),
        this.control.prevElem &&
          (this.control.currentIndex--,
          this.control.currentIndex < 0 &&
            (this.control.currentIndex = this.control.max - 1),
          this.onSlideTo(-this.position[this.control.currentIndex].left)));
    }
    onClickToIndex(t, e) {
      e.preventDefault();
      const i = Number(t.dataset.index);
      ((this.control.currentIndex = i),
        this.onSlideTo(-this.position[this.control.currentIndex].left));
    }
    onSlideToIndex(t = 2, e = "power4.out") {
      this.onSlideTo(-this.position[this.control.currentIndex].left, t, e);
    }
    onSlideTo(t = 0, e = 2, i = "power4.out") {
      (this.onResetSlideTo(),
        (this.control.ing = !0),
        (this.control.tl = gsap.to(this, {
          x: t,
          duration: e,
          ease: i,
          onComplete: () => {
            this.control.ing = !1;
          },
        })));
    }
    initIntersection() {
      ((this.targets = [this.el]),
        this.targets.length &&
          ((this.options = { threshold: 0 }),
          (this.observer = new IntersectionObserver(
            this.listerner,
            this.options,
          )),
          this.targets.forEach((t, e) => {
            this.observer.observe(t);
          })));
    }
    listerner(t) {
      t.forEach((t, e) => {
        const i = t.target;
        t.isIntersecting
          ? ((i.dataset.shown = 1), (i.dataset.visible = 1))
          : (i.dataset.visible = 0);
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
        this.removeEvents());
    }
    onResize() {
      switch (
        ((this.rect = this.el.getBoundingClientRect()), this.guttertype)
      ) {
        case "vw":
          ((this.gutter_x = window.innerWidth * this.gutter),
            (this.outer_x = window.innerWidth * this.outer));
          break;
        case "%":
          ((this.gutter_x = this.rect.width * this.gutter),
            (this.outer_x = this.rect.width * this.outer));
          break;
        case "px":
          ((this.gutter_x = this.gutter), (this.outer_x = this.outer));
          break;
        default:
          ((this.gutter_x = 0), (this.outer_x = 0));
      }
      this.total = 0;
      for (let t = 0; t < this.li.length; t++) {
        const e = this.li[t].getBoundingClientRect();
        (this.gutter_x &&
          (this.li[t].style.margin = `0px ${this.gutter_x / 2}px`),
          (this.position[t].left = this.total),
          (this.position[t].width = e.width),
          (this.total += e.width + this.gutter_x));
      }
      ((this.total = this.total + this.outer_x + this.gutter_x),
        (this.max = this.total - this.rect.width),
        (this.ul.style.margin = `0px ${this.outer_x / 2 + this.gutter_x / 2}px`),
        (this.ul.style.width = this.total + "px"));
    }
    onTouchStart(t) {
      if (
        "BUTTON" === t.target.tagName ||
        "A" === t.target.tagName ||
        "INPUT" === t.target.tagName ||
        "LABEL" === t.target.tagName
      )
        return !1;
      this.onDragStart && this.onDragStart();
      let e = t.clientX,
        i = t.clientY;
      (t.touches &&
        t.touches[0] &&
        ((e = t.touches[0].clientX), (i = t.touches[0].clientY)),
        this.total > this.rect.width &&
          ((this.start.enable = !0),
          (this.el.dataset.slideDragging = 1),
          (this.start.x = e)));
    }
    onTouchMove(t) {
      let e = t.clientX,
        i = t.clientY;
      if (
        (t.touches && t.touches[0]
          ? ((e = t.touches[0].clientX), (i = t.touches[0].clientY))
          : t.originalEvent &&
            t.originalEvent.changedTouches[0] &&
            ((e = t.originalEvent.changedTouches[0].clientX),
            (i = t.originalEvent.changedTouches[0].clientY)),
        this.start.enable)
      ) {
        this.onResetSlideTo();
        const t = this.end.x + (e - this.start.x) * this.speed;
        ((this.ing.x = t > this.min ? this.min : t < -this.max ? -this.max : t),
          this.onDragging &&
            0 != this.ing.x &&
            this.ing.x != this.total &&
            this.onDragging());
      }
    }
    onTouchEnd(t) {
      (this.onDragEnd && this.onDragEnd(),
        (this.start.enable = !1),
        (this.el.dataset.slideDragging = 0),
        (this.end.x = this.ing.x));
    }
    addEvents() {
      if (
        ((this.onTouchStart = this.onTouchStart.bind(this)),
        (this.onTouchMove = this.onTouchMove.bind(this)),
        (this.onTouchEnd = this.onTouchEnd.bind(this)),
        (this.onResize = this.onResize.bind(this)),
        this.el.addEventListener("touchstart", this.onTouchStart, {
          passive: !0,
        }),
        this.el.addEventListener("touchmove", this.onTouchMove, {
          passive: !0,
        }),
        this.el.addEventListener("touchend", this.onTouchEnd),
        this.el.addEventListener("mousedown", this.onTouchStart),
        this.el.addEventListener("mousemove", this.onTouchMove),
        this.el.addEventListener("mouseup", this.onTouchEnd),
        this.el.addEventListener("mouseleave", this.onTouchEnd),
        window.addEventListener("resize", this.onResize),
        this.control.prevElem &&
          ((this.onSlideToPrev = this.onSlideToPrev.bind(this)),
          this.control.prevElem.addEventListener("click", this.onSlideToPrev)),
        this.control.nextElem &&
          ((this.onSlideToNext = this.onSlideToNext.bind(this)),
          this.control.nextElem.addEventListener("click", this.onSlideToNext)),
        this.control.numElem)
      )
        for (let t = 0; t < this.control.numElem.length; t++) {
          const e = this.control.numElem[t];
          this.onClickToIndex = this.onClickToIndex.bind(this);
          const i = (t) => this.onClickToIndex(e, t);
          (e.addEventListener("click", i),
            this.control.numListeners.push({ el: e, listener: i }));
        }
    }
    removeEvents() {
      (this.el.removeEventListener("touchstart", this.onTouchStart),
        this.el.removeEventListener("touchmove", this.onTouchMove),
        this.el.removeEventListener("touchend", this.onTouchEnd),
        this.el.removeEventListener("mousedown", this.onTouchStart),
        this.el.removeEventListener("mousemove", this.onTouchMove),
        this.el.removeEventListener("mouseup", this.onTouchEnd),
        this.el.removeEventListener("mouseleave", this.onTouchEnd),
        window.removeEventListener("resize", this.onResize),
        this.control.prevElem &&
          this.control.prevElem.removeEventListener(
            "click",
            this.onSlideToPrev,
          ),
        this.control.nextElem &&
          this.control.nextElem.removeEventListener(
            "click",
            this.onSlideToNext,
          ),
        this.control.numElem &&
          this.control.numListeners.forEach(({ el: t, listener: e }) => {
            t.removeEventListener("click", e);
          }));
    }
    raf() {
      parseInt(this.el.dataset.visible) &&
        (this.onUpdateBefore && this.onUpdateBefore(),
        this.control.ing
          ? ((this.ing.x = this.x), (this.end.x = this.ing.x))
          : ((this.control.currentIndex = this.getCurrentIndex()),
            (this.x += (this.ing.x - this.x) * this.ease)),
        (this.progress = Math.round(Math.abs((this.x / this.max) * 100))),
        (this.ul.style.transform = `translate3d(${this.x}px, 0px, 0px )`),
        this.onUpdateAfter && this.onUpdateAfter());
    }
    onUpdateAfter() {}
    onUpdateBefore() {}
    onDragStart() {}
    onDragging() {}
    onDragEnd() {}
  }
  window.styleSlider = {
    array: [],
    onInit(t) {
      if (
        ((this.local = t || document.querySelector(".c-lc")),
        (this.el = this.local.querySelectorAll("[data-slide]")),
        this.el.length)
      )
        for (let t = 0; t < this.el.length; t++) {
          const e = this.el[t],
            i = e.querySelectorAll("[data-slide-to]"),
            r = new n({
              index: t,
              el: e,
              guttertype: "css",
              speed: 5,
              ease: 0.1,
              nextElem: e.querySelector("[data-slide-to-next]"),
              prevElem: e.querySelector("[data-slide-to-prev]"),
              numElem: i,
              onDragStart(t) {
                $html.classList.add("is-dragging");
              },
              onDragging(t) {
                var e;
                null === (e = WEBGL.contents) ||
                  void 0 === e ||
                  e.onDragging(t.index);
              },
              onDragEnd(t) {
                var e;
                ($html.classList.remove("is-dragging"),
                  null === (e = WEBGL.contents) ||
                    void 0 === e ||
                    e.onDragEnd(t.index, 2, "expo.out", 0),
                  t.onSlideToIndex(2, "power2.out"));
              },
              onUpdateAfter(t) {
                var e;
                for (let e = 0; e < i.length; e++) {
                  const n = i[e];
                  t.control.currentIndex === e
                    ? n.classList.add("is-active")
                    : n.classList.remove("is-active");
                }
                null === (e = WEBGL.contents) || void 0 === e || e.onSlide();
              },
            });
          this.array.push({ wrap: e, slider: r });
        }
    },
    raf() {
      for (let t = 0; t < this.array.length; t++) {
        const e = this.array[t];
        e.slider && e.slider.raf();
      }
    },
    onDestroy() {
      $html.classList.remove("is-dragging");
      for (let t = 0; t < this.array.length; t++) {
        const e = this.array[t];
        e.slider && e.slider.onDestroy();
      }
      this.array = [];
    },
  };
}
