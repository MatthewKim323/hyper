/* eslint-disable @typescript-eslint/no-explicit-any */
// Navigation / HeaderNav: top-right nav items, char roll hover, hide on scroll.
import gsap from "gsap";
import { store } from "../core/store";
import { E } from "../core/event-bus";
import { splitText } from "./split-text";

export class Navigation {
  dom: {
    nav: HTMLElement;
    inner: HTMLElement;
    items: NodeListOf<HTMLElement>;
    iconInner: NodeListOf<Element>;
    text: NodeListOf<HTMLElement>;
    hoverText: NodeListOf<HTMLElement>;
  };
  navItems: Element[];
  navItemTl: any[] = [];
  hidden = false;
  isClosed?: boolean;
  navInnerWidth: number;
  navItemsTl!: gsap.core.Timeline;
  splitNavItemText: any;
  splitNavItemHoverText: any;
  tl: any;

  constructor() {
    E.bindAll(this);
    const e = document.querySelector(".js-navigation") as HTMLElement;
    this.dom = {
      nav: e,
      inner: e.querySelector(".js-nav-inner") as HTMLElement,
      items: e.querySelectorAll(".js-nav-item"),
      iconInner: e.querySelectorAll(".js-menu-icon-circle"),
      text: e.querySelectorAll(".js-nav-item-text"),
      hoverText: e.querySelectorAll(".js-nav-item-hover-text"),
    };
    this.navItems = [...document.querySelectorAll(".js-nav-item")];
    this.navInnerWidth = this.dom.inner.offsetWidth;
    this.build();
  }

  build() {
    this.splitText();
    this.navItemsTimeline();
    this.addEvents();
  }

  addEvents() {
    E.on("mouseenter", this.dom.items, this.mouseEvents);
    E.on("mouseleave", this.dom.items, this.mouseEvents);
  }

  splitText() {
    this.splitNavItemText = splitText(this.dom.text, { type: "chars", charsClass: "js-nav-item-chars" });
    this.splitNavItemHoverText = splitText(this.dom.hoverText, {
      type: "chars",
      charsClass: "js-nav-item-hover-chars",
    });
    gsap.set(".js-nav-item-hover-chars", {
      yPercent: 150,
      onComplete: () => {
        document.querySelectorAll<HTMLElement>(".nav-item__text--hover").forEach((e) => (e.style.opacity = "1"));
      },
    });
  }

  handleScroll(e: number) {
    if (store.mq.sm.matches) e > 0 ? this.hideNavItems() : this.showNavItems();
  }

  navItemsTimeline() {
    this.navItemsTl = gsap.timeline({ paused: true, defaults: { ease: "expo.inOut" } });
    this.navItemsTl
      .to(this.dom.items, { x: this.navInnerWidth, ease: "expo.in", stagger: -0.04, duration: 0.8 })
      .to(this.dom.iconInner[0], { x: 9, ease: "expo.inOut", duration: 0.6 }, "<0.2")
      .to(this.dom.iconInner[1], { x: -9, ease: "expo.inOut", duration: 0.6 }, "<")
      .set(this.dom.inner, { autoAlpha: 0 });
  }

  hideNavItems() {
    if (this.hidden) return;
    this.hidden = true;
    this.navItemsTl.play();
  }

  showNavItems() {
    if (!this.hidden) return;
    this.hidden = false;
    this.navItemsTl.reverse();
  }

  onResize() {
    if (store.mq.sm.matches) this.isClosed ? this.hideNavItems() : this.showNavItems();
  }

  mouseEvents(e: MouseEvent) {
    const t = e.target as HTMLElement;
    this.tl = this.navItemTl[this.navItems.indexOf(t)];
    if (e.type === "mouseenter")
      gsap
        .timeline({ defaults: { ease: "circ.inOut" } })
        .to(t.querySelectorAll(".js-nav-item-chars"), { yPercent: -120, stagger: { each: 0.014 } })
        .to(t.querySelectorAll(".js-nav-item-hover-chars"), { yPercent: 0, stagger: { each: 0.014 } }, "<0.014");
    else if (e.type === "mouseleave")
      gsap
        .timeline({ defaults: { ease: "circ.inOut" } })
        .to(t.querySelectorAll(".js-nav-item-chars"), { yPercent: 0, stagger: { each: 0.014 } })
        .to(t.querySelectorAll(".js-nav-item-hover-chars"), { yPercent: 150, stagger: { each: 0.014 } }, "<0.014");
  }

  destroy() {
    this.showNavItems();
  }
}

export default Navigation;
