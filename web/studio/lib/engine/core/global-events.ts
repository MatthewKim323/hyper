/* eslint-disable @typescript-eslint/no-explicit-any */
// GlobalEvents: pointer/touch/resize plumbing, emits GRAF from gsap.ticker.
import gsap from "gsap";
import E from "./event-bus";
import { store, events } from "./store";

type Pos = { x: number; y: number };

// lodash.debounce(fn, wait) with default options (trailing edge only).
function debounce<T extends (...args: any[]) => void>(fn: T, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}

function heightDivHeight(): number {
  const el = document.querySelector(".height-div");
  return el ? el.clientHeight : window.innerHeight;
}

export class GlobalEvents {
  mousePos: Pos = { x: 0, y: 0 };
  prevMousePos: Pos = { x: 0, y: 0 };
  origMousePos: Pos = { x: 0, y: 0 };
  dragging = false;

  constructor() {
    E.bindAll(this, ["addTouchEvents", "onPointerMove", "onPointerUp", "onPointerDown", "onRaf"]);
    store.events = events;
    if ("ontouchstart" in document.documentElement) {
      store.isTouch = true;
      store.body.classList.add("is-touch");
      this.detectMouse();
    }
    if (store.isTouch) this.addTouchEvents();
    else this.addMouseEvents();
    this.onResize();
    gsap.ticker.add(this.onRaf);
  }

  onRaf(time: number) {
    if (store.Gui) store.Gui.fps.begin();
    E.emit(store.events.RAF, time);
    if (store.Gui) store.Gui.fps.end();
  }

  onResize() {
    document.documentElement.style.setProperty("--screen-height", `${window.innerHeight}px`);
    document.documentElement.style.setProperty("--vh", 0.01 * store.window.h + "px");
    store.window.fullHeight = heightDivHeight();
    window.addEventListener(
      "resize",
      debounce(() => {
        document.documentElement.style.setProperty("--vh", 0.01 * store.window.h + "px");
        if (store.isTouch && store.window.w === window.innerWidth) return;
        store.window.w = window.innerWidth;
        store.window.h = window.innerHeight;
        store.window.fullHeight = heightDivHeight();
        if (store.ASScroll) store.ASScroll.resize({ width: store.window.w, height: store.window.h });
        E.emit(store.events.RESIZE);
      }, 150),
    );
  }

  addMouseEvents() {
    window.addEventListener("mousemove", this.onPointerMove, { passive: true });
    window.addEventListener("mousedown", this.onPointerDown);
    window.addEventListener("mouseup", this.onPointerUp);
    window.addEventListener("dragend", this.onPointerUp);
    window.addEventListener("contextmenu", this.onPointerUp);
  }

  addTouchEvents() {
    window.addEventListener("touchmove", this.onPointerMove as any);
    window.addEventListener("touchstart", this.onPointerDown as any);
    window.addEventListener("touchend", this.onPointerUp);
  }

  onPointerMove(e: any) {
    this.mousePos = {
      x: e.changedTouches ? e.changedTouches[0].clientX : e.clientX,
      y: e.changedTouches ? e.changedTouches[0].clientY : e.clientY,
    };
    store.mouse.x = this.mousePos.x;
    store.mouse.y = this.mousePos.y;
    store.mouse.gl.set(this.mousePos.x - store.window.w / 2, -this.mousePos.y + store.window.h / 2);
    store.mouse.glNormalized.set(
      (this.mousePos.x / store.window.w) * 2 - 1,
      (-this.mousePos.y / store.window.h) * 2 + 1,
    );
    store.mouse.glScreenSpace.set(this.mousePos.x / store.window.w, 1 - this.mousePos.y / store.window.h);
    E.emit(store.events.MOUSEMOVE, { mousePos: this.mousePos, event: e });
    if (this.dragging) {
      E.emit(store.events.MOUSEDRAG, {
        ox: this.origMousePos.x,
        px: this.prevMousePos.x,
        x: this.mousePos.x,
        oy: this.origMousePos.y,
        py: this.prevMousePos.y,
        y: this.mousePos.y,
        event: e,
      });
      this.prevMousePos = { x: this.mousePos.x, y: this.mousePos.y };
    }
  }

  onPointerDown(e: any) {
    if (store.Gui && store.Gui.element.contains(e.target)) return;
    this.mousePos =
      this.origMousePos =
      this.prevMousePos =
        {
          x: e.changedTouches ? e.changedTouches[0].clientX : e.clientX,
          y: e.changedTouches ? e.changedTouches[0].clientY : e.clientY,
        };
    store.mouse.x = this.mousePos.x;
    store.mouse.y = this.mousePos.y;
    store.mouse.gl.set(this.mousePos.x - store.window.w / 2, -this.mousePos.y + store.window.h / 2);
    store.mouse.glNormalized.set(
      (this.mousePos.x / store.window.w) * 2 - 1,
      (-this.mousePos.y / store.window.h) * 2 + 1,
    );
    store.mouse.glScreenSpace.set(this.mousePos.x / store.window.w, 1 - this.mousePos.y / store.window.h);
    E.emit(store.events.MOUSEDOWN, { mousePos: this.mousePos, event: e });
    this.dragging = true;
  }

  onPointerUp(e: any) {
    if (store.Gui && store.Gui.element.contains(e.target)) return;
    E.emit(store.events.MOUSEUP, { event: e });
    this.dragging = false;
  }

  detectMouse() {
    window.addEventListener("mousemove", (e) => {
      if (Math.abs(e.movementX) > 0 || Math.abs(e.movementY) > 0) {
        store.isTouch = false;
        store.body.classList.remove("is-touch");
        // TOUCHMOUSE may be absent from the configured event map.
        E.emit((store.events as any).TOUCHMOUSE);
      }
    });
  }
}
