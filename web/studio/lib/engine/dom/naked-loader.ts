// NakedLoader: in-transition loader (white cube, optional "(Loading)" label).
import gsap from "gsap";
import { splitText } from "./split-text";

export class NakedLoader {
  dom: {
    loader: HTMLElement;
    loaderWrap: HTMLElement;
    loaderBox: HTMLElement[];
    text: HTMLElement;
    textSplit: Element[];
  };

  constructor() {
    this.dom = {
      loader: document.querySelector(".js-naked-loader") as HTMLElement,
      loaderWrap: document.querySelector(".js-naked-loader-wrap") as HTMLElement,
      loaderBox: Array.prototype.slice.call(document.querySelectorAll(".js-naked-loader-box")),
      text: document.querySelector(".js-naked-loader-text") as HTMLElement,
      textSplit: [],
    };
    this.dom.textSplit = splitText(".js-naked-loader-text > div", { type: "chars" }).chars;
  }

  show(e = "ffffff", t = false, i: Element | false = false) {
    gsap.set([this.dom.loader, this.dom.loaderBox], { backgroundColor: "#" + e });
    const s = gsap
      .timeline({ defaults: { ease: "expo.inOut" } })
      .fromTo(this.dom.loader, { autoAlpha: 0 }, { autoAlpha: 1, duration: 1 })
      .fromTo(this.dom.loaderWrap, { scale: 0 }, { scale: t ? 0.5 : 1, duration: 0.8 }, "<")
      .call(
        () => {
          this.dom.loader.classList.add("loader--animate");
        },
        undefined,
        0.6,
      );
    if (t) {
      if (i) {
        const { x, y, width, height } = i.getBoundingClientRect();
        gsap.set(this.dom.text, { x: x + width / 2, y: y + height / 2 });
      }
      s.set(this.dom.text, { visibility: "visible" }, 0).fromTo(
        this.dom.textSplit,
        { y: "100%" },
        { y: "0%", stagger: 0.03, duration: 0.7, ease: "power3.inOut" },
        0,
      );
    }
    return s;
  }

  hide(e = false) {
    const t = gsap
      .timeline({ defaults: { ease: "power4.out" } })
      .to(this.dom.loader, { autoAlpha: 0, duration: 0.8 })
      .to(this.dom.loaderWrap, { scale: 0, duration: 0.9 }, "<")
      .call(() => {
        this.dom.loader.classList.remove("loader--animate");
      });
    if (e) t.set(this.dom.text, { visibility: "hidden", x: 0, y: 0 });
    return t;
  }
}

export default NakedLoader;
