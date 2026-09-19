// Recovered responsive implementation. See PROVENANCE.md.
export default function initialize() {
  ((window.ACTION = {
    clickTime: 250,
    clickMove: 100,
    timeDiff: 0,
    startTime: 0,
    endTime: 0,
    clickAble: !1,
    start: { x: 0, y: 0, enable: !1 },
    ing: { x: 0, y: 0, xy: 0 },
    body: { x: 0, y: 0 },
    end: { x: 0, y: 0, xy: 0 },
    once() {
      (document.addEventListener("pointerdown", (t) => this.onTouchStart(t), {
        passive: !0,
      }),
        document.addEventListener("pointermove", (t) => this.onTouchMove(t), {
          passive: !0,
        }),
        document.addEventListener("pointerup", (t) => this.onTouchEnd(t)));
    },
    onTouchStart(t) {
      this.startTime = new Date().getTime();
      let e = t.clientX,
        i = t.clientY;
      (t.touches &&
        t.touches[0] &&
        ((e = t.touches[0].clientX), (i = t.touches[0].clientY)),
        (this.start.x = e),
        (this.start.y = i),
        (this.body.x = e),
        (this.body.y = i));
    },
    onTouchMove(t) {
      let e = t.clientX,
        i = t.clientY;
      (t.touches && t.touches[0]
        ? ((e = t.touches[0].clientX), (i = t.touches[0].clientY))
        : t.originalEvent &&
          t.originalEvent.changedTouches[0] &&
          ((e = t.originalEvent.changedTouches[0].clientX),
          (i = t.originalEvent.changedTouches[0].clientY)),
        (this.body.x = e),
        (this.body.y = i),
        (this.ing.x = this.start.x - e),
        (this.ing.y = this.start.y - i),
        (this.ing.xy = Math.sqrt(
          this.ing.x * this.ing.x + this.ing.y * this.ing.y,
        )));
    },
    onTouchEnd(t) {
      let e = t.clientX,
        i = t.clientY;
      if (t.changedTouches && t.changedTouches.length > 0) {
        const n = t.changedTouches[0];
        ((e = n.clientX), (i = n.clientY));
      }
      ((this.body.x = e),
        (this.body.y = i),
        (this.end.x = this.start.x - e),
        (this.end.y = this.start.y - i),
        (this.end.xy = Math.sqrt(
          this.end.x * this.end.x + this.end.y * this.end.y,
        )),
        (this.endTime = new Date().getTime()),
        (this.timeDiff = this.endTime - this.startTime),
        this.end.xy < this.clickMove
          ? ((this.clickAble = !0), this.onClick(e, i))
          : (this.clickAble = !1));
    },
    onClick(t, e) {
      WEBGL.screen.onClick(t, e);
    },
  }),
    ACTION.once());
}
