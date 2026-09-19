/* eslint-disable @typescript-eslint/no-explicit-any */
// Menu: side panel + header toggle button.
import gsap from "gsap";
import { store } from "../core/store";
import { E } from "../core/event-bus";
import { splitText } from "./split-text";

export class Menu {
  dom: {
    nav: HTMLElement;
    inner: HTMLElement;
    button: HTMLElement;
    buttonBg: HTMLElement;
    buttonInnerBg: HTMLElement;
    buttonInnerIcon: Element;
    icon: Element;
    iconInner: NodeListOf<Element>;
    footerCr: HTMLElement;
    footerBtn: HTMLElement;
    menu: HTMLElement;
    menuInner: HTMLElement;
    menuItem: NodeListOf<HTMLAnchorElement>;
    menuText: NodeListOf<HTMLElement>;
    menuHoverText: NodeListOf<HTMLElement>;
    menuLinks: NodeListOf<HTMLElement>;
    socials: NodeListOf<HTMLElement>;
    worldIcon: HTMLElement | null;
    underline: NodeListOf<HTMLElement>;
    menuWrapper: HTMLElement;
  };
  menuItems: HTMLElement[];
  menuItemTl: gsap.core.Timeline[] = [];
  menuOpen = false;
  menuIsAnimating = false;
  menuWidth = "41rem";
  activeItem: HTMLElement | false = false;
  clickedItem: HTMLElement | null = null;
  tl: gsap.core.Timeline | null | undefined = null;
  hoverTL!: gsap.core.Timeline;
  openTL!: gsap.core.Timeline;
  btnTL!: gsap.core.Timeline;
  splitMenuChars: any;
  splitMenuHoverChars: any;

  constructor() {
    E.bindAll(this);
    const e = document.querySelector(".js-navigation") as HTMLElement,
      t = document.querySelector(".js-menu") as HTMLElement;
    this.dom = {
      nav: e,
      inner: e.querySelector(".js-nav-inner") as HTMLElement,
      button: e.querySelector(".js-menu-toggle") as HTMLElement,
      buttonBg: e.querySelector(".js-menu-toggle-bg") as HTMLElement,
      buttonInnerBg: e.querySelector(".js-menu-toggle-inner-bg") as HTMLElement,
      buttonInnerIcon: e.querySelector(".js-menu-toggle-inner-icon") as Element,
      icon: e.querySelector(".js-menu-icon") as Element,
      iconInner: e.querySelectorAll(".js-menu-icon-circle"),
      footerCr: document.querySelector(".js-footer-cr") as HTMLElement,
      footerBtn: document.querySelector(".js-footer-cta") as HTMLElement,
      menu: t,
      menuInner: t.querySelector(".js-menu-inner") as HTMLElement,
      menuItem: t.querySelectorAll(".js-menu-item"),
      menuText: t.querySelectorAll(".js-menu-text"),
      menuHoverText: t.querySelectorAll(".js-menu-hover-text"),
      menuLinks: t.querySelectorAll(".js-menu-link"),
      socials: t.querySelectorAll(".js-social-links"),
      worldIcon: t.querySelector<HTMLElement>(".js-menu-world-icon"),
      underline: t.querySelectorAll(".js-active-underline"),
      menuWrapper: document.querySelector(".js-menu-wrapper") as HTMLElement,
    };
    this.menuItems = [...document.querySelectorAll<HTMLElement>(".js-menu-item")];
    this.build();
  }

  build() {
    this.updateActiveItem();
    this.splitText();
    this.setElemsPosition();
    this.buildMenuItemTimelines();
    this.openMenuTL();
    this.addEvents();
    if (!store.isTouch) this.menuToggleHoverTL();
  }

  addEvents() {
    E.on(store.events.RESIZE, this.onResize);
    E.on("click", [this.dom.button, this.dom.menuWrapper], this.handleToggle);
    E.on("click", this.dom.menuItem, this.clickItem);
    if (!store.isTouch) {
      E.on("mouseenter", this.dom.button, this.onMouseEnterMenuToggle);
      E.on("mouseleave", this.dom.button, this.onMouseLeaveMenuToggle);
      E.on("mouseenter", this.dom.menuItem, this.mouseEvents);
      E.on("mouseleave", this.dom.menuItem, this.mouseEvents);
    }
  }

  splitText() {
    this.splitMenuChars = splitText(this.dom.menuText, { type: "chars", charsClass: "js-menu-chars" });
    this.splitMenuHoverChars = splitText(this.dom.menuHoverText, { type: "chars", charsClass: "js-menu-hover-chars" });
  }

  setElemsPosition() {
    for (let e = 0; e < this.dom.menuItem.length; e++) {
      const t = this.dom.menuItem[e].querySelectorAll(".js-menu-chars");
      gsap.set(t, { scaleX: 0, opacity: 0, x: (e: number) => e * (0.9 * e) + "px" });
    }
    gsap.set(this.dom.menuItem, { x: (e: number) => 10 * (e + 1) + "%" });
    gsap.set(".js-menu-hover-chars", { scaleX: "0", opacity: 0 });
    gsap.set(".js-menu-hover-text", { opacity: 1, x: "-10%" });
  }

  buildMenuItemTimelines() {
    for (let e = 0; e < this.menuItems.length; e++) {
      const t = this.menuItems[e],
        i = t.querySelectorAll(".js-menu-chars"),
        s = t.querySelectorAll(".js-menu-hover-chars"),
        o = t.querySelector(".js-menu-hover-text"),
        n = t.querySelector(".js-menu-number"),
        r = t.querySelector(".js-menu-world-icon"),
        a = gsap.timeline({ paused: true, defaults: { ease: "expo.inOut", duration: 0.8 } });
      a.to(i, { scaleX: 0, opacity: 0, x: "50%", duration: 0.6, stagger: 0.03 })
        .to(s, { scaleX: 1, opacity: 1, duration: 0.6, stagger: 0.03 }, "<0.1")
        .to(o, { x: "5%" }, "<")
        .to(n, { x: "100%" }, "<");
      if (r) a.to(r, { x: "40%", y: "-40%", scaleX: -1 }, "<");
      this.menuItemTl.push(a);
    }
  }

  mouseEvents(e: MouseEvent) {
    if (e.target === this.activeItem) return;
    const t = e.target as HTMLElement;
    this.tl = this.menuItemTl[this.menuItems.indexOf(t)];
    if (e.type === "mouseenter") {
      if (this.menuIsAnimating) return;
      if (!this.tl.isActive()) store.Audio?.play({ key: "audio.navlinks_hover", isInteraction: true });
      this.tl.play();
    } else if (e.type === "mouseleave") {
      this.tl?.reverse();
      this.tl = null;
    }
  }

  clickItem(e: MouseEvent) {
    this.clickedItem = (e.target as HTMLElement).closest(".js-menu-item");
    if (this.clickedItem === this.activeItem) return;
    if (!(this.menuIsAnimating || store.isTouch))
      (this.clickedItem!.querySelector(".js-menu-text") as HTMLElement).style.opacity = "0";
    this.closeMenu();
  }

  onMouseEnterMenuToggle() {
    if (this.menuOpen) return;
    this.hoverTL.play();
    gsap
      .timeline()
      .to(this.dom.buttonBg, { scale: 1.15, duration: 0.25, ease: "none" })
      .to(this.dom.buttonBg, { scale: 1, duration: 0.25, ease: "none" }, "<0.15");
  }

  onMouseLeaveMenuToggle() {
    if (!this.menuOpen) this.hoverTL.reverse();
  }

  menuToggleHoverTL() {
    this.hoverTL = gsap.timeline({ paused: true }).to(this.dom.icon, { rotate: "180deg", ease: "expo.inOut", duration: 0.5 });
  }

  isOpen() {
    return store.body.classList.contains("has-open-mobile-menu");
  }

  handleToggle() {
    if (this.isOpen())
      gsap
        .timeline({ defaults: { ease: "none", duration: 0.1 } })
        .to(this.dom.buttonInnerBg, { scale: 0.9 })
        .to(this.dom.buttonInnerBg, {
          scale: 1,
          onComplete: () => {
            this.closeMenu();
          },
        });
    else {
      this.openMenu();
      gsap
        .timeline({ defaults: { ease: "none", duration: 0.1 } })
        .to(this.dom.buttonBg, { scale: 0.9 })
        .to(this.dom.buttonBg, { scale: 1 });
    }
  }

  openMenu() {
    store.body.classList.add("has-open-mobile-menu");
    this.menuIsAnimating = true;
    this.menuOpen = true;
    this.dom.menuWrapper.style.display = "block";
    this.openTL.play();
    this.btnTL.play();
    setTimeout(() => store.Audio?.play({ key: "audio.menu_swoosh" }), 100);
    store.ASScroll?.disable();
    if (store.ProjectMenu) store.ProjectMenu.allowControl = false;
  }

  closeMenu() {
    store.body.classList.remove("has-open-mobile-menu");
    this.menuIsAnimating = true;
    this.menuOpen = false;
    this.dom.menuWrapper.style.display = "none";
    this.openTL.reverse();
    this.btnTL.reverse();
    setTimeout(() => store.Audio?.play({ key: "audio.menu_close" }), 400);
    if (store.ProjectMenu) store.ProjectMenu.allowControl = true;
    store.ASScroll?.enable();
  }

  openMenuTL() {
    this.openTL = gsap
      .timeline({
        repeatRefresh: true,
        paused: true,
        defaults: { ease: "expo.inOut", duration: 1 },
        onComplete: () => {
          this.menuIsAnimating = false;
          if (this.tl) this.tl.play();
        },
        onReverseComplete: () => {
          this.updateActiveItem();
          this.menuIsAnimating = false;
          this.dom.menuText.forEach((e) => {
            e.style.opacity = "1";
          });
          this.dom.menu.style.removeProperty("transform");
          this.dom.menuInner.style.removeProperty("transform");
        },
      })
      .to(this.dom.menu, { x: "0%" }, 0)
      .to(this.dom.menuInner, { x: "0%" }, 0);
    this.openTL.to(this.dom.menuItem, { x: 0 }, "<").to(this.dom.underline, { width: "100%", x: 0 }, "<");
    for (let e = 0; e < this.dom.menuItem.length; e++) {
      const t = this.dom.menuItem[e].querySelectorAll(".js-menu-chars");
      this.openTL.to(t, { x: 0, opacity: 1, scaleX: 1, stagger: 0.02 }, "<");
    }
    if (this.dom.worldIcon) this.openTL.to(this.dom.worldIcon, { opacity: 1, scaleX: 1 }, "<0.1");
    this.openTL
      .to(this.dom.menuLinks, { opacity: 1, stagger: 0.075 }, this.dom.worldIcon ? "<0.1" : "<0.2")
      .to([this.dom.inner, this.dom.footerCr], { autoAlpha: 0, duration: 0.4 }, "<")
      .to(this.dom.socials, { opacity: 1, duration: 0.7 }, "<");
    if (!store.mq.lg.matches) this.openTL.to(this.dom.footerBtn, { opacity: 0, duration: 0.4 }, "<");
    this.btnTL = gsap
      .timeline({ paused: true, defaults: { ease: "expo.inOut" } })
      .to(this.dom.buttonInnerBg, { scale: 1, duration: 1 }, "<")
      .to(this.dom.buttonInnerIcon, { rotate: 0, scale: 1, duration: 1 }, "<")
      .to(this.dom.iconInner[0], { x: 4.5, duration: 0.5 }, "<0.1")
      .to(this.dom.iconInner[1], { x: -4.5, duration: 0.5 }, "<");
  }

  updateActiveItem() {
    this.activeItem = false;
    for (let e = 0; e < this.dom.menuItem.length; e++) {
      this.dom.menuItem[e].classList.remove("active");
      if (this.dom.menuItem[e].href === location.href) {
        this.dom.menuItem[e].classList.add("active");
        this.activeItem = this.dom.menuItem[e];
      }
    }
  }

  onResize() {
    this.menuWidth = store.mq.lg.matches ? "40vw" : "100%";
  }

  destroy() {
    // Invoke optional navigation setup only when provided.
    (this as any).showNavItems?.();
  }
}

export default Menu;
