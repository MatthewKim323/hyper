// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  ((window.styleAccordion = {
    array: [],
    onInit(t) {
      if (
        ((this.local = t || document.querySelector(".c-lc")),
        (this.el = this.local.querySelectorAll(".js-acc")),
        this.el.length)
      ) {
        for (let t = 0; t < this.el.length; t++) {
          const e = this.el[t];
          this.array.push({
            el: e,
            isopen: !1,
            click: null,
            toggle: e.querySelector(".js-t-acc"),
            body: e.querySelector(".js-acc-body"),
          });
        }
        this.array.forEach((t, e) => {
          ((t.click = (e) => {
            (e.preventDefault(),
              t.isopen
                ? (gsap.to(t.body, {
                    height: 0,
                    duration: 1.5,
                    ease: "power4.out",
                  }),
                  (t.isopen = !1),
                  t.el.classList.remove("is-open"))
                : (gsap.to(t.body, {
                    height: "auto",
                    duration: 1,
                    ease: "power4.out",
                  }),
                  (t.isopen = !0),
                  t.el.classList.add("is-open")));
          }),
            t.toggle.addEventListener("click", t.click));
        });
      }
    },
    onDestroy() {},
  }),
    styleAccordion.onInit());
}
