// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  PAGE_TRANSITION.goto = {
    el: null,
    array: [],
    onInit() {
      (this.removeEvents(), (this.el = document.querySelectorAll(".js-a")));
      for (let t = 0; t < this.el.length; t++) {
        const e = this.el[t];
        this.array.push({
          el: e,
          next: { name: e.dataset.to, slug: e.dataset.slug },
          href: null,
          type: e.dataset.type,
          touchable: e.classList.contains("js-a-touch"),
          draggable: "true" === e.dataset.draggable,
          trigger: !1,
          startTime: 0,
          endTime: 0,
          click: null,
          pointerdown: null,
          pointerup: null,
          pointerenter: null,
          prefetch: !1,
        });
      }
      this.addEvents();
    },
    addEvents() {
      this.array.forEach((t, e) => {
        ((t.goto = () => {
          PAGE_TRANSITION.ing ||
            ((t.href = t.el.getAttribute("href")),
            (PAGE_TRANSITION.next.url = t.href),
            (PAGE_TRANSITION.next.name = t.next.name),
            (PAGE_TRANSITION.next.slug = t.next.slug),
            PAGE_TRANSITION.onGoto(t));
        }),
          t.touchable && DETECT.device.any
            ? ((t.click = (t) => {
                t.preventDefault();
              }),
              (t.pointerdown = (e) => {
                t.goto();
              }))
            : t.draggable
              ? ((t.click = (t) => {
                  t.preventDefault();
                }),
                (t.pointerdown = (e) => {
                  t.trigger ||
                    ((t.startTime = new Date().getTime()), (t.trigger = !0));
                }),
                (t.pointerup = (e) => {
                  if (t.trigger) {
                    t.endTime = new Date().getTime();
                    (t.endTime - t.startTime < ACTION.clickTime &&
                      ACTION.clickAble &&
                      t.goto(),
                      (t.trigger = !1));
                  }
                }),
                (t.pointerenter = () => {
                  t.prefetch ||
                    ((t.prefetch = !0),
                    (t.href = t.el.getAttribute("href")),
                    t.href && barba.prefetch(t.href));
                }))
              : ((t.click = (e) => {
                  (e.preventDefault(), t.goto());
                }),
                (t.pointerenter = () => {
                  t.prefetch ||
                    ((t.prefetch = !0),
                    (t.href = t.el.getAttribute("href")),
                    t.href && barba.prefetch(t.href));
                })),
          t.click && t.el.addEventListener("click", t.click),
          DETECT.device.any
            ? (t.el.addEventListener("pointerdown", t.pointerdown, {
                passive: !0,
              }),
              t.el.addEventListener("pointerup", t.pointerup))
            : (t.el.addEventListener("pointerdown", t.pointerdown),
              t.el.addEventListener("pointerup", t.pointerup),
              t.el.addEventListener("pointerenter", t.pointerenter)));
      });
    },
    removeEvents() {
      (this.array.forEach((t, e) => {
        (t.click && t.el.removeEventListener("click", t.click),
          t.pointerdown &&
            t.el.removeEventListener("pointerdown", t.pointerdown),
          t.pointerup && t.el.removeEventListener("pointerup", t.pointerup),
          t.pointerenter &&
            t.el.removeEventListener("pointerenter", t.pointerenter),
          (t.click = null),
          (t.pointerdown = null),
          (t.pointerup = null),
          (t.pointerenter = null));
      }),
        (this.array = []));
    },
  };
}
