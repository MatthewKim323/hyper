// Recovered responsive implementation. See PROVENANCE.md.
export default function initialize() {
  window.styleInview = {
    local: null,
    targets: [],
    observer: null,
    onInit(t) {
      ((this.local = t || document.querySelector(".c-lc")),
        (this.inview = document.querySelectorAll(".js-iv")),
        (this.targets = [...this.inview]),
        this.targets.length &&
          ((this.options = { threshold: 0 }),
          (this.observer = new IntersectionObserver(
            this.listerner,
            this.options,
          )),
          this.targets.forEach((t, e) => {
            this.observer.observe(t);
          })));
    },
    onReInit() {
      (this.onDestroy(), this.onInit());
    },
    listerner(t) {
      t.forEach((t, e) => {
        const i = t.target;
        t.isIntersecting
          ? ((i.dataset.shown = 1), (i.dataset.visible = 1))
          : (i.dataset.visible = 0);
      });
    },
    onDestroy() {
      this.observer &&
        (this.targets.forEach((t, e) => {
          this.observer.disconnect(t);
        }),
        (this.targets = []),
        (this.observer = null));
    },
  };
}
