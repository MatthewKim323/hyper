// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";

export default function initialize() {
  var n = THREE;
  window.COLOR = {
    current: "dark",
    power: { dark: 1, light: 0, powerY: 0, powerS: 0 },
    once() {
      (Object.keys(this.dark).forEach((t) => {
        const e = this.dark[t];
        e.hex
          ? ((e.three = new n.Color(e.hex)), (e.rgb = hexToRgb(e.hex)))
          : ((e.three = new n.Color(e.rgb)), (e.hex = rgbToHex(e.rgb)));
      }),
        Object.keys(this.light).forEach((t) => {
          const e = this.light[t];
          e.hex
            ? ((e.three = new n.Color(e.hex)), (e.rgb = hexToRgb(e.hex)))
            : ((e.three = new n.Color(e.rgb)), (e.hex = rgbToHex(e.rgb)));
        }),
        Object.keys(this.table).forEach((t) => {
          const e = this.table[t];
          if (
            (e.hex
              ? ((e.three = new n.Color(e.hex)), (e.rgb = hexToRgb(e.hex)))
              : ((e.three = new n.Color(e.rgb)), (e.hex = rgbToHex(e.rgb))),
            e.htmlHex && $html.style.setProperty("--c-" + t + "-0", e.hex),
            e.htmlRbg)
          ) {
            const i = hexToRgb(e.hex);
            ($html.style.setProperty("--c-" + t + "-0-r", i.r),
              $html.style.setProperty("--c-" + t + "-0-g", i.g),
              $html.style.setProperty("--c-" + t + "-0-b", i.b));
          }
        }),
        "light" === localStorage.getItem("color") &&
          ((this.current = localStorage.getItem("color")),
          this.setColor("light"),
          this.setCssColor("light")),
        ($html.dataset.currentCol = this.current),
        this.onInit(),
        $html.classList.remove("is-l-p"));
    },
    array: [],
    onInit() {
      const t = document.querySelectorAll(".js-t-mode");
      for (let e = 0; e < t.length; e++) {
        const i = t[e];
        this.array.push({ el: i, click: null });
      }
      this.array.forEach((t, e) => {
        ((t.click = (t) => {
          var e;
          (t.preventDefault(),
            this.onToggleColor(),
            null !== (e = styleMenu) &&
              void 0 !== e &&
              e.isopen &&
              styleMenu.onClose());
        }),
          t.el.addEventListener("click", t.click));
      });
    },
    onDestroy() {
      (this.array.forEach((t, e) => {
        t.click &&
          (t.el.removeEventListener("click", t.click), (t.click = null));
      }),
        (this.array = []));
    },
    onToggleColor() {
      (SPLASH.tl.sceneTo &&
        (SPLASH.tl.sceneTo.kill(), (SPLASH.tl.sceneTo = null)),
        "dark" === this.current
          ? (this.current = "light")
          : (this.current = "dark"),
        localStorage.setItem("color", this.current),
        this.setColor(this.current),
        this.setCssColor(this.current));
    },
    setColor(t) {
      (($html.dataset.currentCol = t),
        Object.keys(this.table).forEach((e) => {
          const i = this.table[e];
          this[t][e] &&
            ((i.three.r = this[t][e].three.r),
            (i.three.g = this[t][e].three.g),
            (i.three.b = this[t][e].three.b));
        }),
        "light" === t
          ? ((this.power.light = 1), (this.power.dark = 0))
          : ((this.power.light = 0), (this.power.dark = 1)));
    },
    setCssColor(t) {
      Object.keys(this[t]).forEach((e) => {
        const i = this[t][e];
        if (
          (i.htmlHex && $html.style.setProperty("--c-" + e + "-0", i.hex),
          i.htmlRbg)
        ) {
          const t = hexToRgb(i.hex);
          ($html.style.setProperty("--c-" + e + "-0-r", t.r),
            $html.style.setProperty("--c-" + e + "-0-g", t.g),
            $html.style.setProperty("--c-" + e + "-0-b", t.b));
        }
      });
    },
    anim: {
      timer: null,
      ing: !1,
      color: null,
      mask: null,
      powerY: null,
      powerS: null,
    },
    toColorMask() {
      let t = "power4.out";
      ((t = CustomEase.create(
        "custom",
        "M0,0 C0.082,0 0.143,0.014 0.222,0.09 0.298,0.164 0.356,0.356 0.398,0.504 0.447,0.68 0.49,0.816 0.55,0.882 0.622,0.961 0.734,1 1,1 ",
      )),
        this.anim.mask && this.anim.mask.kill(),
        (this.anim.mask = null),
        (this.anim.mask = gsap.timeline()),
        this.anim.mask.set(".c-mask", { y: "0%" }),
        this.anim.mask.to(".c-mask", {
          duration: 1,
          ease: t,
          y: "-100%",
          onComplete: () => {
            (this.setColor(), this.setCssColor());
          },
        }),
        this.anim.mask.to(".c-mask", {
          duration: 1,
          ease: t,
          y: "-200%",
        }));
    },
  };
}
