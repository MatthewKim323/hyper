// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  ((window.styleMenu = {
    isopen: !1,
    power: 0,
    open: null,
    close: null,
    once() {
      document.querySelector(".js-c-mu").addEventListener("click", (t) => {
        (t.preventDefault(), this.onClose());
      });
      document.querySelector(".js-t-mu").addEventListener("click", (t) => {
        (t.preventDefault(), this.onToggle());
      });
    },
    onToggle() {
      this.isopen ? this.onClose() : this.onOpen();
    },
    onOpen() {
      ((this.isopen = !0),
        ($html.dataset.menuOpened = this.isopen),
        this.open && this.open.kill(),
        (this.open = gsap.to(this, {
          power: 1,
          duration: 1.4,
          ease: "power4.out",
        })));
    },
    onClose() {
      ((this.isopen = !1),
        ($html.dataset.menuOpened = this.isopen),
        this.open && this.open.kill(),
        (this.open = gsap.to(this, {
          power: 0,
          duration: 1.2,
          ease: "power4.out",
        })));
    },
  }),
    styleMenu.once());
}
