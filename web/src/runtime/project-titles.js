// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  window.styleProjects = {
    ready: !1,
    local: null,
    obj: {},
    keys: [],
    wrap: {},
    onInit(t) {
      ((this.local = t || document.querySelector(".c-lc")),
        (this.sync = this.local.querySelectorAll(".c-sc-sync")),
        (this.main = this.local.querySelector(".c-mn")),
        (this.wrap.el = this.local.querySelector(".c-sc-body")),
        (this.wrap.mouseenter = null),
        (this.wrap.mouseleave = null),
        (this.wrap.mousemove = null),
        (this.ready = !1),
        this.wrap.el &&
          (this.sync.forEach((t, e) => {
            const i = t.dataset.slug;
            ((this.obj[i] = { i: e, el: t, mouseenter: null }),
              this.keys.push(i));
          }),
          Object.keys(this.obj).forEach((t) => {
            const e = this.obj[t];
            e.mouseenter = () => {
              this.main.dataset.index = e.i;
            };
          }),
          (this.wrap.mouseenter = () => {
            this.main.classList.add("is-hv-p");
          }),
          this.wrap.el.addEventListener("mouseenter", this.wrap.mouseenter),
          (this.wrap.mouseleave = () => {
            this.main.classList.remove("is-hv-p");
          }),
          this.wrap.el.addEventListener("mouseleave", this.wrap.mouseleave),
          (this.wrap.mousemove = () => {
            this.main.classList.add("is-hv-p");
          }),
          this.wrap.el.addEventListener("mousemove", this.wrap.mousemove),
          (this.ready = !0)));
    },
    onMouseEnter(t) {
      var e;
      null !== (e = WEBGL.icon) &&
        void 0 !== e &&
        e.body &&
        WEBGL.icon.body.onMouseEnter("arrow", "0");
      for (let e = 0; e < this.keys.length; e++) {
        const i = this.keys[e],
          n = this.obj[i];
        i === t.slug && n.mouseenter();
      }
    },
    onMouseLeave(t) {},
    onDestroy() {
      ((this.ready = !1),
        this.wrap.mouseenter &&
          (this.wrap.el.removeEventListener("mouseenter", this.wrap.mouseenter),
          (this.wrap.mouseenter = null)),
        this.wrap.mouseleave &&
          (this.wrap.el.removeEventListener("mouseleave", this.wrap.mouseleave),
          (this.wrap.mouseleave = null)),
        this.wrap.mousemove &&
          (this.wrap.el.removeEventListener("mousemove", this.wrap.mousemove),
          (this.wrap.mousemove = null)),
        (this.wrap = {}),
        (this.sync = null),
        (this.obj = {}),
        (this.keys = []));
    },
  };
}
