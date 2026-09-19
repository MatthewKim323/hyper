// Recovered responsive implementation. See PROVENANCE.md.
export default function initialize() {
  ((window.styleMail = {
    local: null,
    array: [],
    once() {
      document.querySelectorAll(".l-gl .js-mail-to").forEach((t, e) => {
        const i = t.dataset.mail;
        t.addEventListener("click", (t) => {
          (t.preventDefault(), (location.href = "mailto:" + i));
        });
      });
    },
    onInit(t) {
      this.local = t || document.querySelector(".c-lc");
      (this.local.querySelectorAll(".js-mail-to").forEach((t, e) => {
        this.array.push({ el: t, mail: t.dataset.mail, click: null });
      }),
        this.array.forEach((t, e) => {
          ((t.click = (e) => {
            (e.preventDefault(), (location.href = "mailto:" + t.mail));
          }),
            t.el.addEventListener("click", t.click));
        }));
    },
    onDestroy() {
      (this.array.forEach((t, e) => {
        (t.el.removeEventListener("click", t.click), (t.click = null));
      }),
        (this.array = []));
    },
  }),
    styleMail.once());
}
