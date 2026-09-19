// Recovered responsive implementation. See PROVENANCE.md.
export default function initialize() {
  ((window.styleTextArea = {
    textArray: [
      { t: "a", timer: null },
      { t: "i", timer: null },
      { t: "r", timer: null },
      { t: "c", timer: null },
      { t: "o", timer: null },
      { t: "r", timer: null },
      { t: "d", timer: null },
      { t: " f", timer: null },
      { t: "o", timer: null },
      { t: "n", timer: null },
      { t: "t", timer: null },
    ],
    onInit(t) {
      ((this.local = t || document.querySelector(".c-lc")),
        (this.textarea = this.local.querySelector(".js-textarea")),
        this.textarea &&
          ((this.input = (t) => {
            t.target.value = t.target.value.replace(
              /[^a-zA-Z0-9!-/:-@¥[-`{-~* ]/g,
              "",
            );
          }),
          this.textarea.addEventListener("input", this.input),
          (this.listerner = (t) => {
            t.forEach((t, e) => {
              t.isIntersecting
                ? (this.textarea.dataset.shown ||
                    ((this.textarea.dataset.shown = 1), this.onShow()),
                  (this.textarea.dataset.visible = 1))
                : (this.textarea.dataset.visible = 0);
            });
          }),
          (this.observer = new IntersectionObserver(this.listerner, {
            threshold: 0,
          })),
          this.observer.observe(this.textarea)));
    },
    timer: null,
    onShow() {
      this.textArray.forEach((t, e) => {
        (clearTimeout(t.timer),
          (t.timer = setTimeout(
            () => {
              ((this.textarea.value += t.t),
                e === this.textArray.length - 1 &&
                  (clearTimeout(t.timer), this.textarea.focus()));
            },
            75 * (e + 1),
          )));
      });
    },
    onDestroy() {
      (this.textArray.forEach((t, e) => {
        clearTimeout(t.timer);
      }),
        this.textarea &&
          this.input &&
          this.textarea.removeEventListener("input", this.input),
        this.observer &&
          (this.observer.disconnect(this.textarea),
          (this.observer = null),
          (this.listerner = null)));
    },
  }),
    styleTextArea.onInit(),
    (window.styleAtag = {
      el: null,
      array: [],
      onInit(t) {
        if (
          (this.onDestroy(),
          (this.local = t || document.querySelector(".c-lc")),
          (this.el = this.local.querySelectorAll("a")),
          this.el.length)
        ) {
          for (let t = 0; t < this.el.length; t++) {
            const e = this.el[t];
            this.array.push({ el: e, dragstart: null });
          }
          this.array.forEach((t, e) => {
            ((t.dragstart = (t) => {
              t.preventDefault();
            }),
              t.el.addEventListener("dragstart", t.dragstart));
          });
        }
      },
      onDestroy() {
        (this.array.forEach((t, e) => {
          (t.el.removeEventListener("dragstart", t.dragstart),
            (t.dragstart = null));
        }),
          (this.array = []),
          (this.el = null));
      },
    }),
    styleAtag.onInit());
}
