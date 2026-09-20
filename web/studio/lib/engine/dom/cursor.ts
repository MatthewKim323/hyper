/* eslint-disable @typescript-eslint/no-explicit-any */
// Cursor: lerped ring with squash/stretch and data-cursor states.
import gsap from "gsap";
import { store } from "../core/store";
import { E } from "../core/event-bus";
import { WORLD_PATH } from "../router/routes";

// The ring replaces the system cursor on pointer devices once the site is entered (the gate keeps the native one).
function nativeCursor(show: boolean) {
  document.documentElement.classList.toggle("native-cursor-off", !show);
}

// Over buttons and 3D hover targets, the ring shrinks to a dot and remains visible.
const HIDDEN_SCALE = 0.35;

export class Cursor {
  dom!: {
    el: HTMLElement;
    wrap: HTMLElement;
    inner: HTMLElement;
    circle: HTMLElement;
    hold: { inner: HTMLElement; outer: HTMLElement };
    video: { outer: Element; play: Element; pause: Element; icon: Element };
    drag: HTMLElement;
    progressWrap: HTMLElement;
    progressRing: Element;
    clickHoldPrompt: HTMLElement;
    link: HTMLElement | null;
  };
  enabled = false;
  hasEntered = false;
  isMouseDown = false;
  hasPlayed = false;
  reverseOnEnd = false;
  timeout: any = null;
  stopMouseMove = false;
  stopSqueeze = false;
  clickHoldPromptActive = false;
  currentState: string | null = null;
  selectors = "a, button, [data-cursor]";
  mouse = { x: -100, y: -100 };
  pos = { x: 0, y: 0 };
  speed = 0.2;
  clickHoldTl!: gsap.core.Timeline;
  videoCursorTl!: gsap.core.Timeline;
  enterNavItemTl?: gsap.core.Timeline;
  leaveNavItemTl?: gsap.core.Timeline;
  linkPosition?: DOMRect;
  width = 0;
  height = 0;
  [key: string]: any;

  updateProgress = (e: number | string) => {
    const p = Number(e);
    gsap.set(this.dom.progressRing, { strokeDashoffset: Math.round(2.44 * (100 - 100 * p)) });
    if (p <= 0) gsap.set(this.dom.progressRing, { opacity: 0 });
    else gsap.set(this.dom.progressRing, { opacity: 1 });
  };

  changeState = (e: any) => {
    if (!this.enabled) return;
    const t = e.type,
      i = (e.currentTarget.dataset.cursor && e.currentTarget.dataset.cursor.split(" ")) || ["link"];
    if (this.enabled)
      switch (t) {
        case "mouseenter":
          this[i[0] + "Enter"] && this[i[0] + "Enter"](e, i[1]);
          break;
        case "mouseleave":
          this[i[0] + "Leave"] && this[i[0] + "Leave"](e, i[1]);
          break;
        case "mousedown":
          this[i[0] + "Down"] && this[i[0] + "Down"](e, i[1]);
          break;
        case "mouseup":
          this[i[0] + "Up"] && this[i[0] + "Up"](e, i[1]);
      }
    this.currentState = t === "mouseleave" ? null : i[0];
  };

  hideEnter = () => {
    gsap.to(this.dom.wrap, { scale: HIDDEN_SCALE, opacity: 1, ease: "expo.out", duration: 0.8 });
  };

  hideLeave = () => {
    gsap.to(this.dom.wrap, { scale: 1, opacity: 1, ease: "expo.out", duration: 0.8 });
  };

  navWrapperEnter = (_e?: any) => {
    this.stopSqueeze = true;
    this.stopMouseMove = true;
  };

  navWrapperLeave = () => {
    this.stopMouseMove = false;
  };

  navItemEnter = (e: any) => {
    if (this.leaveNavItemTl) this.leaveNavItemTl.clear();
    gsap.set(this.dom.circle, { rotate: 0, scale: 1 });
    if (this.clickHoldPromptActive) {
      gsap.to(this.dom.clickHoldPrompt, { scale: 0, opacity: 0, ease: "expo.out", duration: 0.8 });
      gsap.to(this.dom.inner, { autoAlpha: 1, ease: "expo.out", duration: 0.8 });
    }
    this.enterNavItemTimeline(e);
  };

  navItemLeave = (_e?: any) => {
    if (this.enterNavItemTl) this.enterNavItemTl.clear();
    this.leaveNavItemTl = gsap.timeline().to(this.dom.circle, {
      width: "2.2rem",
      ease: "expo.out",
      duration: 0.2,
      onComplete: () => {
        this.stopSqueeze = false;
        gsap.set(this.dom.circle, { clearProps: "all" });
      },
    });
    if (this.clickHoldPromptActive) {
      gsap.to(this.dom.clickHoldPrompt, { scale: 1, opacity: 1, ease: "expo.out", duration: 0.8 });
      gsap.to(this.dom.inner, { autoAlpha: 0, ease: "expo.out", duration: 0.8 });
    }
  };

  enterNavItemTimeline = (e: any) => {
    if (this.enterNavItemTl) this.enterNavItemTl.clear();
    this.linkPosition = e.target.getBoundingClientRect();
    this.width = e.target.offsetWidth;
    this.height = e.target.offsetHeight;
    this.enterNavItemTl = gsap
      .timeline()
      .to(this.mouse, {
        x: this.linkPosition!.left + this.width / 2,
        y: this.linkPosition!.top + this.height / 2,
        ease: "expo.out",
        duration: 0.2,
      })
      .to(this.dom.circle, { width: this.width + "px", ease: "expo.inOut", duration: 0.65 }, "<");
  };

  mouseDown = () => {
    if (!this.enabled) return;
    this.isMouseDown = true;
    gsap.timeline().to(this.dom.inner, { scale: 0.8, duration: 0.2 });
    // Six pages now share the "projects" view slug (both product routes and the /dev
    // previews), so the slug no longer identifies the gallery. Click-and-hold selects a
    // grid item, which only exists in the world, so key on the route instead.
    if ((location.pathname.replace(/\/+$/, "") || "/") !== WORLD_PATH) return;
    const e = this.clickHoldTl,
      t = this.isMouseDown;
    this.timeout = setTimeout(function () {
      if (t) e.play();
    }, 250);
  };

  mouseUp = () => {
    clearTimeout(this.timeout);
    this.isMouseDown = false;
    if (this.clickHoldTl.isActive()) this.reverseOnEnd = true;
    else if (this.hasPlayed) this.clickHoldTl.reverse();
    else gsap.timeline().to(this.dom.inner, { scale: 1, duration: 0.2 });
  };

  clickHoldTimeline = () => {
    this.clickHoldTl = gsap.timeline({
      paused: true,
      onComplete: () => {
        this.hasPlayed = true;
        if (this.reverseOnEnd) this.clickHoldTl.reverse();
      },
      onReverseComplete: () => {
        this.hasPlayed = false;
        this.reverseOnEnd = false;
        gsap.timeline().to(this.dom.inner, { scale: 1, duration: 0.2 });
      },
    });
    this.clickHoldTl
      .to(this.dom.inner, { scale: 0, duration: 0.2 })
      .to(this.dom.hold.inner, { scale: 0.65, duration: 0.2, ease: "expo.out" }, "<0.05")
      .to(this.dom.hold.outer, { scale: 1, duration: 0.2, ease: "expo.out" }, "<0.05");
  };

  videoEnter = () => {
    this.videoCursorTl.play();
    gsap.to(this.dom.progressWrap, { scale: 1, duration: 0.3, ease: "power1.inOut" });
  };

  videoLeave = () => {
    this.videoCursorTl.reverse();
    gsap.to(this.dom.progressWrap, { scale: 0, duration: 0.3, ease: "power1.inOut" });
    this.updateProgress(0);
  };

  dragEnter = (e: any) => {
    if (e.target.dataset.cursorProgress) this.updateProgress(e.target.dataset.cursorProgress);
    gsap.to(this.dom.drag, { scale: 1, duration: 0.3, ease: "power1.inOut" });
    gsap.to(this.dom.progressWrap, { scale: 1, duration: 0.3, ease: "power1.inOut" });
  };

  dragLeave = () => {
    gsap.to(this.dom.drag, { scale: 0, duration: 0.3, ease: "power1.inOut" });
    gsap.to(this.dom.progressWrap, { scale: 0, duration: 0.3, ease: "power1.inOut" });
    this.updateProgress(0);
  };

  videoCursorTimeline = () => {
    gsap.set([this.dom.video.outer, this.dom.video.icon, this.dom.video.play, this.dom.video.pause], {
      transformOrigin: "center",
      scale: 0,
    });
    this.videoCursorTl = gsap.timeline({ paused: true }).to([this.dom.video.outer, this.dom.video.icon], {
      scale: 1,
      duration: 0.3,
      ease: "power1.inOut",
      transformOrigin: "center",
    });
  };

  showClickHoldPrompt = () => {
    if (store.isTouch) return;
    this.clickHoldPromptActive = true;
    gsap
      .timeline()
      .to(this.dom.clickHoldPrompt, { autoAlpha: 1, duration: 0.5, ease: "expo.out" })
      .to(this.dom.inner, { autoAlpha: 0, duration: 0.2, ease: "expo.out" }, "<0.25");
  };

  hideClickHoldPrompt = () => {
    if (store.isTouch) return;
    this.clickHoldPromptActive = false;
    gsap
      .timeline()
      .to(this.dom.clickHoldPrompt, { autoAlpha: 0, duration: 0.3, ease: "sine.out" })
      .to(this.dom.inner, { autoAlpha: 1, duration: 0.2, ease: "expo.out" }, "<");
  };

  constructor() {
    const e = document.querySelector(".js-cursor") as HTMLElement;
    if (store.isTouch) {
      e.remove();
      return;
    }
    E.bindAll(this, ["onMouseMove", "onRaf"]);
    this.dom = {
      el: e,
      wrap: e.querySelector(".js-cursor-wrap") as HTMLElement,
      inner: e.querySelector(".js-cursor-inner") as HTMLElement,
      circle: e.querySelector(".js-cursor-circle") as HTMLElement,
      hold: {
        inner: e.querySelector(".js-cursor-hold-inner") as HTMLElement,
        outer: e.querySelector(".js-cursor-hold-outer") as HTMLElement,
      },
      video: {
        outer: e.querySelector(".js-cursor-video-outer") as Element,
        play: e.querySelector(".js-cursor-video-play") as Element,
        pause: e.querySelector(".js-cursor-video-pause") as Element,
        icon: e.querySelector(".js-cursor-video-icon") as Element,
      },
      drag: e.querySelector(".js-cursor-drag") as HTMLElement,
      progressWrap: e.querySelector(".js-cursor-progress") as HTMLElement,
      progressRing: e.querySelector(".js-cursor-progress-ring") as Element,
      clickHoldPrompt: e.querySelector(".js-cursor-click-hold-prompt") as HTMLElement,
      link: document.querySelector(".js-nav-item"),
    };
    this.clickHoldTimeline();
    this.videoCursorTimeline();
    this.addEvents();
  }

  disable() {
    if (store.isTouch) return;
    this.enabled = false;
    // Route transitions suspend hover reactions, but the ring must keep following the pointer.
    this.mouseUp();
    this.reset();
    this.hideLeave();
    this.dragLeave();
    this.navWrapperLeave();
    this.navItemLeave();
  }

  enable() {
    if (store.isTouch) return;
    this.reset();
    this.stopMouseMove = false;
    this.stopSqueeze = false;
    this.enabled = true;
    this.hasEntered = true;
    // first enable happens once the intro gate is gone; from then on the ring is the only cursor
    nativeCursor(false);
    gsap.to(this.dom.el, { autoAlpha: 1, duration: 0.5 });
    this.hideLeave();
    const hovered = document.elementFromPoint(this.mouse.x, this.mouse.y)?.closest<HTMLElement>(this.selectors);
    if (hovered) {
      if (hovered.closest('[data-cursor="navWrapper"]')) this.navWrapperEnter();
      this.changeState({ type: "mouseenter", currentTarget: hovered, target: hovered });
    }
  }

  addEvents() {
    E.on(store.events.MOUSEMOVE, this.onMouseMove);
    E.on(store.events.MOUSEDOWN, this.mouseDown);
    E.on(store.events.MOUSEUP, this.mouseUp);
    E.on(store.events.RAF, this.onRaf);
    E.delegate("mouseenter", this.selectors, this.changeState);
    E.delegate("mouseleave", this.selectors, this.changeState);
    E.delegate("mousedown", this.selectors, this.changeState);
    E.delegate("mouseup", this.selectors, this.changeState);
    E.on("cursor:progress", this.updateProgress);
  }

  getAngle(e: number, t: number) {
    return (180 * Math.atan2(t, e)) / Math.PI;
  }

  getSqueeze(e: number, t: number) {
    const i = Math.sqrt(Math.pow(e, 2) + Math.pow(t, 2));
    return Math.min(i / 200, 0.55);
  }

  onRaf() {
    if (!this.hasEntered) return;
    const e = Math.round(this.mouse.x - this.pos.x),
      t = Math.round(this.mouse.y - this.pos.y);
    this.pos.x += e * this.speed;
    this.pos.y += t * this.speed;
    const i = this.getAngle(e, t),
      s = this.getSqueeze(e, t),
      o = "translate3d(" + this.pos.x + "px ," + this.pos.y + "px, 0)";
    this.dom.el.style.transform = o;
    if (this.stopSqueeze) return;
    const n = "scale(" + (1 + s) + ", " + (1 - s) + ")",
      r = "rotate(" + i + "deg)";
    this.dom.circle.style.transform = r + n;
  }

  onMouseMove({ event: t }: { mousePos: { x: number; y: number }; event: MouseEvent }) {
    if (this.stopMouseMove) return;
    this.mouse.x = t.clientX;
    this.mouse.y = t.clientY;
  }

  reset() {
    if (this.currentState && this[this.currentState + "Leave"]) this[this.currentState + "Leave"]();
    this.currentState = null;
  }
}

export default Cursor;
