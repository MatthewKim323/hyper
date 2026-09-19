/* eslint-disable @typescript-eslint/no-explicit-any */
// SvgButton: svg.js-drawn pill button with fill/border hover timelines
// and the contact content-toggle select state.
import gsap from "gsap";
import { SVG } from "@svgdotjs/svg.js";
import { store } from "../core/store";
import { E } from "../core/event-bus";

// GSAP 3.6 measured hidden SVG elements by temporarily reparenting them.
// Keep that measurement behavior for buttons built inside .d-none: a default-size
// SVG is 300x150, so yPercent 120 resolves to 180px. GSAP 3.15 needs this patch.
function patchBBox(el: SVGGraphicsElement) {
  let b: DOMRect | undefined;
  try {
    b = el.getBBox();
  } catch {
    b = undefined;
  }
  if (b && (b.width || b.height)) return;
  const native = el.getBBox.bind(el);
  el.getBBox = function (): DOMRect {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const parent = el.parentNode,
      next = el.nextSibling,
      css = el.style.cssText;
    document.documentElement.appendChild(svg);
    svg.appendChild(el);
    el.style.display = "block";
    let r: DOMRect;
    try {
      r = native();
    } catch {
      r = new DOMRect(0, 0, 0, 0);
    }
    if (parent) {
      if (next) parent.insertBefore(el, next);
      else parent.appendChild(el);
    }
    document.documentElement.removeChild(svg);
    el.style.cssText = css;
    return r;
  };
}

export class SvgButton {
  static get selector() {
    return ".js-btn:not(.js-manager-ignore)";
  }

  dom: {
    el: HTMLElement;
    btnInner: HTMLElement | null;
    btnContent: HTMLElement | null;
    btnContentCloned: HTMLElement | null;
    btnIcon: Element | null;
  };
  btnWidth: number;
  btnHeight: number;
  svgSettings = { width: "100%", height: "100%", strokeWidth: 2, rx: "1.3em", ry: "3em" };
  buttonType: string | undefined;
  togglecontent: string | undefined;
  canvas: any;
  btnBorder: any;
  btnBorderHover: any;
  // After build, this field holds the background rectangle.
  buildBtnBg: any;
  borderSections: any;
  contentTimeline!: gsap.core.Timeline;
  borderTimeline!: gsap.core.Timeline;
  selectTimeline!: gsap.core.Timeline;

  constructor(e: HTMLElement) {
    E.bindAll(this);
    this.dom = {
      el: e,
      btnInner: e.querySelector(".js-btn-inner"),
      btnContent: e.querySelector(".js-btn-content"),
      btnContentCloned: e.querySelector(".js-btn-content-cloned"),
      btnIcon: e.querySelector(".js-btn-icon"),
    };
    this.btnWidth = e.clientWidth;
    this.btnHeight = e.clientHeight;
    this.buttonType = e.dataset.btn;
    this.togglecontent = e.dataset.togglecontent;
    this.buildBtnBg = this._buildBtnBg;
    this.build();
    this.addEvents();
  }

  build() {
    this.buildSvgCanvas();
    if (this.buttonType === "border") this.buildBtnBorder();
    if (this.buttonType === "fill") this.buildBtnBg();
    this.buildBtnFill();
    this.cloneContent("cloned");
    this.buildAnimateContentTl();
    if (this.buttonType === "border") {
      this.buildRevealBorder();
      this.buildMaskSections();
      this.buildRevealBorderTl();
    }
    if (this.togglecontent !== "none" && this.buttonType === "border") {
      this.buildselectableBtn();
      if (this.dom.el === document.querySelector(".js-btn-selected")) {
        store.contentToggle.activeButton = this;
        this.setActiveButton();
      }
    }
  }

  addEvents() {
    E.on("mouseenter", this.dom.el, this.mouseEvents);
    E.on("mouseleave", this.dom.el, this.mouseEvents);
    if (
      this.togglecontent === "none" ||
      this.buttonType === "fill" ||
      ((this.dom.el as HTMLAnchorElement).href && !this.dom.el.getAttribute("href")!.startsWith("#"))
    )
      return;
    E.on("click", this.dom.el, this.click);
  }

  buildSvgCanvas() {
    this.canvas = SVG().addTo(this.dom.el).size(this.btnWidth, this.btnHeight);
  }

  buildBtnBorder() {
    this.btnBorder = this.canvas
      .rect(this.svgSettings.width, this.svgSettings.height)
      .attr({ fill: "none", stroke: "#000", class: "btn__border btn__rect", x: 1, y: 1 })
      .stroke({ width: this.svgSettings.strokeWidth })
      .radius(this.svgSettings.rx, this.svgSettings.ry);
  }

  _buildBtnBg() {
    this.buildBtnBg = this.canvas
      .rect(this.svgSettings.width, this.svgSettings.height)
      .attr({ fill: "none", stroke: "#000", class: "btn__bg btn__rect", x: 1, y: 1 })
      .stroke({ width: this.svgSettings.strokeWidth })
      .radius(this.svgSettings.rx, this.svgSettings.ry);
  }

  buildBtnFill() {
    const e = this.canvas
        .rect(this.svgSettings.width, this.svgSettings.height)
        .attr({ fill: "#000", stroke: "#000", class: "btn__fill btn__rect", x: 1, y: 1 })
        .stroke({ width: this.svgSettings.strokeWidth })
        .radius(this.svgSettings.rx, this.svgSettings.ry),
      t = this.canvas.rect(this.svgSettings.width, this.svgSettings.height).attr({ fill: "#000" }),
      i = this.canvas
        .rect(this.svgSettings.width, this.svgSettings.height)
        .attr({ fill: "#fff", stroke: "#fff", class: "btn__fill-mask js-btn-fill" })
        .stroke({ width: this.svgSettings.strokeWidth }),
      s = this.canvas.mask().add(t).add(i);
    e.maskWith(s);
    if (this.buttonType === "fill") {
      const e2 = t.clone().attr({ fill: "#fff" }),
        s2 = i.clone().attr({ fill: "#000", stroke: "#000" }),
        o = this.canvas.mask().add(e2).add(s2);
      this.buildBtnBg.maskWith(o);
    }
    this.dom.el.querySelectorAll<SVGGraphicsElement>(".js-btn-fill").forEach(patchBBox);
    gsap.set(this.dom.el.querySelectorAll(".js-btn-fill"), { yPercent: 120 });
  }

  cloneContent(e: string) {
    const t = this.dom.btnContent!.cloneNode(true) as HTMLElement;
    this.dom.btnInner!.append(t);
    t.classList.add("btn__content--" + e, "js-btn-content-" + e);
    t.classList.remove("js-btn-" + e);
    const i = t.querySelector(".btn__icon");
    t.querySelector(".btn__text")!.classList.add("btn__text--" + e);
    if (i) i.classList.add("btn__icon--" + e);
  }

  buildAnimateContentTl() {
    this.contentTimeline = gsap
      .timeline({ paused: true, defaults: { ease: "expo.inOut", duration: 0.6 } })
      .to(this.dom.el.querySelector(".js-btn-content"), { y: "250%" }, "<")
      .to(this.dom.el.querySelector(".js-btn-content-cloned"), { y: 0, duration: 0.8 }, "<");
    if (this.dom.el.querySelector(".js-btn-icon"))
      this.contentTimeline
        .to(this.dom.el.querySelector(".js-btn-icon"), { x: "200%" }, "<")
        .to(this.dom.el.querySelector(".js-btn-content-cloned .btn__icon"), { x: 0, duration: 0.8 }, "<");
    if (this.buttonType === "fill")
      this.contentTimeline.to(this.dom.el.querySelectorAll(".js-btn-fill"), { yPercent: 0 }, "<");
    this.contentTimeline.call(
      () => {
        if (!this.contentTimeline.reversed()) store.Audio?.play({ key: "audio.hover" });
      },
      [],
      0.1,
    );
  }

  buildRevealBorder() {
    this.borderSections = { borderRight: "", borderBottom: "", borderLeft: "" };
    this.btnBorderHover = this.canvas
      .rect(this.svgSettings.width, this.svgSettings.height)
      .attr({ fill: "none", stroke: "#000", class: "btn__border--hover btn__rect", x: 1, y: 1 })
      .stroke({ width: this.svgSettings.strokeWidth })
      .radius(this.svgSettings.rx, this.svgSettings.ry);
  }

  buildMaskSections() {
    const e = this.canvas.rect(this.svgSettings.width, this.svgSettings.height).attr({ fill: "#fff" }),
      t = this.canvas
        .rect("0%", "0%")
        .attr({ x: "50%", y: "-6px", fill: "#000", class: "btn__clip-right js-right-reveal" }),
      i = this.canvas.rect("0%", "25%").attr({ y: "84%", fill: "#000", class: "btn__clip-bottom js-bottom-reveal" }),
      s = this.canvas
        .rect("15%", "0%")
        .attr({ x: "0", y: "10%", fill: "#000", class: "btn__clip-left js-left-reveal" }),
      o = this.canvas.mask().add(e).add(t).add(i).add(s);
    this.btnBorder.maskWith(o);
    const n = e.clone().attr({ fill: "#000" }),
      r = t.clone().attr({ fill: "#fff" }),
      a = i.clone().attr({ fill: "#fff" }),
      l = s.clone().attr({ fill: "#fff" }),
      c = this.canvas.mask().add(n).add(r).add(a).add(l);
    this.btnBorderHover.maskWith(c);
  }

  buildRevealBorderTl() {
    this.borderTimeline = gsap
      .timeline({ paused: true, defaults: { duration: 0.1 } })
      .set(this.dom.el.querySelectorAll(".js-right-reveal"), { height: "18%" })
      .to(this.dom.el.querySelectorAll(".js-right-reveal"), { width: "50%", ease: "expo.in", duration: 0.25 })
      .to(this.dom.el.querySelectorAll(".js-right-reveal"), { height: "100%", ease: "none", duration: 0.12 })
      .to(this.dom.el.querySelectorAll(".js-bottom-reveal"), { width: "100%", ease: "none", duration: 0.12 }, "-=0.01")
      .to(this.dom.el.querySelectorAll(".js-left-reveal"), { height: "100%", ease: "none" })
      .to(this.dom.el.querySelectorAll(".js-left-reveal"), { width: "51%", ease: "expo.out", duration: 0.25 });
  }

  buildselectableBtn() {
    this.cloneContent("select");
    this.selectTimeline = gsap
      .timeline({ paused: true, defaults: { ease: "expo.inOut", duration: 0.6 } })
      .to(
        this.dom.el.querySelector(".js-btn-content-cloned"),
        {
          y: "250%",
          onComplete: () => {
            gsap.set(this.dom.el.querySelector(".js-btn-content-cloned"), { y: "-120%", opacity: 0 });
          },
          onReverseComplete: () => {
            gsap.set(this.dom.el.querySelector(".js-btn-content-cloned"), { y: "-120%", opacity: 1 });
          },
        },
        "<",
      )
      .to(this.dom.el.querySelector(".js-btn-content-select"), { y: 0, duration: 0.8 }, "<");
    if (this.dom.btnIcon)
      this.selectTimeline
        .to(this.dom.el.querySelector(".js-btn-content-cloned .btn__icon"), { x: "200%" }, "<")
        .to(this.dom.el.querySelector(".js-btn-content-select .btn__icon"), { x: 0, duration: 0.8 }, "<");
    this.selectTimeline.to(this.dom.el.querySelectorAll(".js-btn-fill"), { yPercent: 0 }, "<");
  }

  mouseEvents(e: MouseEvent) {
    if (store.contentToggle && store.contentToggle.activeButton && e.target === store.contentToggle.activeButton.dom.el)
      return;
    if (e.type === "mouseenter") {
      this.contentTimeline.play();
      if (this.buttonType === "border") this.borderTimeline.play();
    } else if (e.type === "mouseleave") {
      this.contentTimeline.reverse();
      if (this.buttonType === "border") this.borderTimeline.reverse();
    }
  }

  click(e: Event) {
    e.preventDefault();
    if (store.contentToggle.sectionTl[0].isActive() || store.contentToggle.sectionTl[1].isActive()) return;
    this.setActiveButton(e);
  }

  setActiveButton(e?: Event) {
    if (!e) {
      setTimeout(() => {
        this.contentTimeline.progress(1);
        this.borderTimeline.progress(1);
        this.selectTimeline.progress(1);
      }, 1);
      store.contentToggle.updateContent(e);
      return;
    }
    const active = store.contentToggle.activeButton;
    if (active && this.dom.el !== active.dom.el) {
      this.borderTimeline.play();
      this.selectTimeline.play();
      this.contentTimeline.play();
      active.borderTimeline.reverse();
      active.selectTimeline.reverse();
      active.contentTimeline.reverse();
    }
    if (store.contentToggle) {
      store.contentToggle.activeButton = this;
      store.contentToggle.updateContent(e);
    }
  }

  destroy() {
    this.canvas.clear();
    E.off("mouseenter", this.dom.el, this.mouseEvents);
    E.off("mouseleave", this.dom.el, this.mouseEvents);
    E.off("click", this.dom.el, this.click);
  }
}

export default SvgButton;
