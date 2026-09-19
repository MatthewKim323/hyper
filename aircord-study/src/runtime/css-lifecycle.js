// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  ((window.styleCss = {
    elems: [],
    events: [],
    local: null,
    once() {
      document
        .querySelectorAll(".l-gl .js-c, .l-gl .u-btn-hv .t")
        .forEach((t, e) => {
          (t.addEventListener("transitionstart", (e) => {
            t.dataset.a = 1;
          }),
            t.addEventListener("transitionend", (e) => {
              t.dataset.a = 0;
            }));
        });
    },
    onInit(t) {
      this.local = t || document.querySelector(".c-lc");
      const e = this.local.querySelectorAll(
        ".a-cl .a-cl-t, .a-fd-i, .c-split .w, .u-btn-hv .t, .c-pj-t, .js-c, .js-c-child > *",
      );
      ((this.elems = [...e]), this.addEvents());
    },
    addEvents() {
      this.elems.forEach((t, e) => {
        const i = (e) => {
            t.dataset.a = 1;
          },
          n = (e) => {
            t.dataset.a = 0;
          };
        (t.addEventListener("transitionstart", i),
          t.addEventListener("transitionend", n));
        const r = { el: t, start: { func: i }, end: { func: n } };
        this.events.push(r);
      });
    },
    onDestroy() {
      for (let t = 0; t < this.events.length; t++) {
        const e = this.events[t];
        (e.el.removeEventListener("transitionstart", e.start.func),
          e.el.removeEventListener("transitionend", e.end.func));
      }
      ((this.events = []), (this.elems = []));
    },
  }),
    styleCss.once());
}
