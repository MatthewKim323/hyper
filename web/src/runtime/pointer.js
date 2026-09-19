// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  "use strict";
  class n {
    constructor(t = {}) {
      ((this.ratio = t.ratio || 1),
        (this.size = t.size ? t.size * this.ratio : 64 * this.ratio),
        (this.maxAge = t.maxAge || 64),
        (this.ageRatio = t.ageRatio || 0.3),
        (this.ease = t.ease || "power2.out"),
        (this.trails = []),
        (this.intensity = 0),
        this.addEvnets());
    }
    raf(t, e) {
      for (
        this.addTouch({ x: t, y: e });
        this.trails.length > 0 && this.trails[0].age > this.maxAge;

      )
        this.trails.shift();
      for (let t = 0; t < this.trails.length; t++) {
        const e = this.trails[t];
        (e.age++, this.drawTouch(e));
      }
    }
    addTouch(t) {
      let e = 0;
      const i = this.trails[this.trails.length - 1];
      if (i) {
        const n = i.x - t.x,
          r = i.y - t.y,
          s = n * n + r * r;
        s < window.innerWidth && (e = Math.min(1e4 * s, 1));
      }
      (this.trails.push({ x: t.x, y: t.y, age: 0, force: e }),
        this.trails.length > this.maxAge &&
          this.trails.splice(0, this.trails.length - this.maxAge));
    }
    drawTouch(t) {
      if (((t.intensity = 1), t.age < this.maxAge * this.ageRatio)) {
        let e = t.age / (this.maxAge * this.ageRatio);
        t.intensity = gsap.parseEase(this.ease)(e);
      } else {
        let e =
          1 -
          (t.age - this.maxAge * this.ageRatio) /
            (this.maxAge * (1 - this.ageRatio));
        t.intensity = gsap.parseEase(this.ease)(e);
      }
      t.intensity *= t.force;
    }
    onMouseMove(t) {
      const e = {
        x: t.clientX / window.innerWidth,
        y: 1 - t.clientY / window.innerHeight,
      };
      this.addTouch(e);
    }
    addEvnets() {}
    removeEvents() {}
  }
  class r {
    constructor(t = {}) {
      ((this.prop = t),
        (this.isActive = !1),
        (this.isFirst = !1),
        (this.useRAF = !!t.useRAF && t.useRAF),
        (this.precision = t.precision ? t.precision : 100),
        (this.isMobile = !0 === t.isMobile),
        (this.ease = this.prop.ease ? this.prop.ease : 0.1),
        (this.array = []));
      ((this.easeRatio = {
        delta: 85,
        acceleration: 60,
        ...this.prop.easeRatio,
      }),
        (this.x = window.innerWidth / 2),
        (this.y = window.innerHeight / 2),
        (this.currentEvent = null),
        (this.currentTime = 0.001 * performance.now()),
        (this.lastTime = 0),
        (this.deltaTime = 0),
        "function" == typeof t.onUpdateBefore &&
          (this.onUpdateBefore = () => t.onUpdateBefore(this)),
        "function" == typeof t.onUpdateAfter &&
          (this.onUpdateAfter = () => t.onUpdateAfter(this)),
        "function" == typeof t.onMouseMoveBefore &&
          (this.onMouseMoveBefore = () => t.onMouseMoveBefore(this)),
        "function" == typeof t.onMouseMoveAfter &&
          (this.onMouseMoveAfter = () => t.onMouseMoveAfter(this)));
      ((this.move = {
        active: 0,
        duration: 1,
        ease: "power1.out",
        ...t.move,
      }),
        (this.touch = {
          enable: !1,
          active: 0,
          start: { enable: !1, x: 0 },
          ing: { x: 0, delta: { x: 0 }, ease: 0.025 },
          end: { x: 0 },
        }),
        this.onRunRabbit());
    }
    onRunRabbit() {
      this.ease.length
        ? ((this.isArray = !0), this.onInitArray())
        : ((this.isArray = !1), this.onInitSingle());
    }
    onInitSingle() {
      ((this.center = { x: 0, y: 0 }),
        (this.shader = { x: 0, y: 0 }),
        (this.delta = { x: 0, y: 0 }),
        (this.acceleration = {
          prevEvent: null,
          x: 0,
          y: 0,
          distance: 0,
          delta: { x: 0, y: 0, distance: 0 },
        }),
        this.addEvents(),
        this.onInitGetAcceleration(this.acceleration),
        this.useRAF && this.raf());
    }
    onInitArray() {
      this.addEvents();
      for (let t = 0; t < this.ease.length; t++) {
        const e = this.ease[t];
        this.array.push({
          ease: e,
          center: { x: 0, y: 0 },
          shader: { x: 0, y: 0 },
          delta: { x: 0, y: 0 },
          acceleration: {
            prevEvent: null,
            x: 0,
            y: 0,
            distance: 0,
            delta: { x: 0, y: 0, distance: 0 },
          },
          lastTime: 0,
        });
      }
      (this.isMobile ||
        this.array.forEach((t, e) => {
          this.onInitGetAcceleration(t.acceleration);
        }),
        this.useRAF && this.raf());
    }
    onInitGetAcceleration(t) {
      (clearInterval(t.interval),
        (t.interval = setInterval(() => {
          if (
            (Math.abs(t.delta.x) < 0.001 && (t.delta.x = 0),
            Math.abs(t.delta.y) < 0.001 && (t.delta.y = 0),
            Math.abs(t.delta.distance) < 0.001 && (t.delta.distance = 0),
            t.prevEvent && this.currentEvent)
          ) {
            const e = 2 * (this.currentEvent.screenX - t.prevEvent.screenX),
              i = 2 * (this.currentEvent.screenY - t.prevEvent.screenY);
            ((t.x = e / (window.innerWidth / 2)),
              (t.y = i / (window.innerHeight / 2)),
              (t.x = Math.max(-1, Math.min(1, t.x))),
              (t.y = Math.max(-1, Math.min(1, t.y))));
            const n =
              Math.sqrt(
                window.innerWidth * window.innerWidth +
                  window.innerHeight * window.innerHeight,
              ) / 2;
            ((t.distance = (Math.sqrt(e * e + i * i) / n) * 10),
              (t.distance = Math.max(0, Math.min(1, t.distance))),
              gsap.to(t.delta, {
                duration: 10,
                ease: "expo.out",
                x: 2 * t.x,
                y: 2 * t.y,
                distance: 2 * t.distance,
              }));
          }
          t.prevEvent = this.currentEvent;
        }, this.precision)));
    }
    addEvents() {
      this.isMobile
        ? ((this.onTouchStart = this.onTouchStart.bind(this)),
          (this.onTouchMove = this.onTouchMove.bind(this)),
          (this.onTouchEnd = this.onTouchEnd.bind(this)),
          window.addEventListener("touchstart", this.onTouchStart),
          window.addEventListener("touchmove", this.onTouchMove),
          window.addEventListener("touchend", this.onTouchEnd))
        : ((this.onMouseMove = this.onMouseMove.bind(this)),
          window.addEventListener("mousemove", this.onMouseMove));
    }
    removeEvents() {
      this.isMobile
        ? (window.addEventListener("touchstart", this.onTouchStart),
          window.addEventListener("touchmove", this.onTouchMove),
          window.addEventListener("touchend", this.onTouchEnd))
        : window.removeEventListener("mousemove", this.onMouseMove);
    }
    onTouchStart(t) {
      this.isActive = !0;
      let e = t.clientX;
      (t.touches && t.touches[0] && (e = t.touches[0].clientX),
        (this.touch.enable = !0),
        (this.touch.start.enable = !0),
        (this.touch.start.x = e));
    }
    onTouchMove(t) {
      let e = t.clientX;
      if (
        (t.touches && t.touches[0]
          ? (e = t.touches[0].clientX)
          : t.originalEvent &&
            t.originalEvent.changedTouches[0] &&
            (e = t.originalEvent.changedTouches[0].clientX),
        this.touch.start.enable)
      ) {
        const t = this.touch.end.x + (e - this.touch.start.x);
        this.touch.ing.x = clamp(t / window.innerWidth, -1, 1);
      }
    }
    onTouchEnd(t) {
      ((this.touch.start.enable = !1),
        (this.touch.end.x = this.touch.ing.x),
        (this.touch.ing.x = 0));
    }
    onMouseMove(t) {
      (this.onMouseMoveBefore && this.onMouseMoveBefore(this),
        this.isFirst ||
          gsap.to(this.move, {
            active: 1,
            duration: this.move.duration,
            ease: this.move.ease,
          }),
        (this.isFirst = !0),
        (this.isActive = !0),
        (this.x = t.clientX),
        (this.y = t.clientY),
        (this.currentEvent = t),
        this.onMouseMoveAfter && this.onMouseMoveAfter(this));
    }
    raf() {
      (this.isMobile ? this.onUpdateForMobile() : this.onUpdateForDesktop(),
        this.useRAF &&
          (this.onRAF = requestAnimationFrame(this.raf.bind(this))));
    }
    lerp(t, e, i) {
      return e + (t - e) * i;
    }
    onUpdateForDesktop() {
      if (
        (this.onUpdateBefore && this.onUpdateBefore(this),
        (this.currentTime = 0.001 * performance.now()),
        (this.deltaTime = this.currentTime - this.lastTime),
        this.isArray)
      )
        for (let t = 0; t < this.array.length; t++)
          this.onUpdateDelta(this.array[t]);
      else this.onUpdateDelta(this);
      ((this.lastTime = this.currentTime),
        this.onUpdateAfter && this.onUpdateAfter(this));
    }
    onUpdateForMobile() {
      ((this.touch.ing.delta.x +=
        (this.touch.ing.x - this.touch.ing.delta.x) * this.touch.ing.ease),
        (this.touch.ing.delta.x =
          Math.abs(this.touch.ing.delta.x) > 0.001
            ? this.touch.ing.delta.x
            : 0));
    }
    onUpdateDelta(t) {
      const e = Math.exp(-t.ease * this.easeRatio.delta * this.deltaTime);
      ((t.delta.x = this.lerp(t.delta.x, this.x, e)),
        (t.delta.y = this.lerp(t.delta.y, this.y, e)),
        (t.center.x = (t.delta.x - window.innerWidth / 2) / window.innerWidth),
        (t.center.y =
          (t.delta.y - window.innerHeight / 2) / window.innerHeight),
        (t.shader.x = (t.delta.x / window.innerWidth) * 2 - 1),
        (t.shader.y = (-t.delta.y / window.innerHeight) * 2 + 1));
    }
    onDestory() {
      (this.onRAF && cancelAnimationFrame(this.onRAF),
        (this.onRAF = null),
        clearInterval(this.acceleration.interval),
        this.removeEvents());
    }
  }
  ((window.TRAILS = {
    enable: !0,
    maxAge: 20,
    once() {
      this.body = new n({
        ease: "expo.out",
        maxAge: this.maxAge,
        ageRatio: 0.1,
      });
    },
    raf() {
      const t = MOUSE.body.array[1].delta.x / WW,
        e = 1 - MOUSE.body.array[1].delta.y / WH;
      this.body.raf(t, e);
    },
  }),
    TRAILS.once());
  let s = [0.025, 0.05, 0.1];
  (DETECT.reduced && (s = [1, 1, 1]),
    (window.MOUSE = {
      enable: !DETECT.reduced,
      local: null,
      params: { rotation: { z: 3 } },
      once() {
        ((this.body = new r({
          ease: s,
          easeRatio: { delta: 85, acceleration: 60 },
          isMobile: DETECT.device.any,
          move: { duration: 2 },
          useRAF: !1,
        })),
          this.onInit());
      },
      title: { el: null, rect: null },
      onInit(t) {
        this.local = t || document.querySelector(".c-lc");
      },
      onResize() {},
      raf() {
        this.body.raf();
      },
    }),
    MOUSE.once());
}
