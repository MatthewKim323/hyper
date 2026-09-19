/* eslint-disable @typescript-eslint/no-explicit-any */
// GridSlider: `.js-grid-slider` drag row of dom2webgl images.
// Drag x 1.5, lerp 0.15, items get `_glProps` position.x/z (data-z) and u_edgeFade; the intro text pushes back in z and fades.
import { MathUtils } from "three";
import gsap from "gsap";
import E from "../core/event-bus";
import { store } from "../core/store";

const o: any = store;

export class GridSlider {
  static get selector() {
    return ".js-grid-slider";
  }

  sliderEl: HTMLElement;
  dom: { text: HTMLElement; itemWrap: HTMLElement; items: NodeListOf<any> };
  dragPos: number;
  smoothDragPos: number;
  dragProgress: number;
  smoothDragProgress: number;
  maxDragPos = 0;

  onRaf = () => {
    this.smoothDragPos += 0.15 * (this.dragPos - this.smoothDragPos);
    this.smoothDragProgress += 0.15 * (this.dragProgress - this.smoothDragProgress);
    for (let e = 0; e < this.dom.items.length; e++) {
      const t = this.dom.items[e];
      gsap.set(t, { x: this.smoothDragPos, glProps: { "position.x": this.smoothDragPos } } as any);
    }
    this.dom.text.style.transform = `translate3d(0px, 0px, ${-200 * this.smoothDragProgress * 4}px)`;
    this.dom.text.style.opacity = String(1 - 5 * this.smoothDragProgress);
  };

  onDrag = ({ ox: e, px: t, x: i, event: ev }: any) => {
    if (!this.sliderEl.contains(ev.target)) return;
    if (Math.abs(e - i) < 2) return;
    this.dragPos -= 1.5 * (t - i);
    this.dragPos = MathUtils.clamp(this.dragPos, this.maxDragPos, 0);
    this.dragProgress = this.dragPos / this.maxDragPos;
    this.sliderEl.dataset.cursorProgress = String(this.dragProgress);
    E.emit("cursor:progress", this.dragProgress);
  };

  onResize = () => {
    const { left: e } = this.dom.itemWrap.getBoundingClientRect();
    this.maxDragPos = -this.dom.itemWrap.scrollWidth - e + o.window.w - 50;
  };

  constructor(e: HTMLElement) {
    this.sliderEl = e;
    this.dom = {
      text: this.sliderEl.querySelector(".js-grid-slider-text") as HTMLElement,
      itemWrap: this.sliderEl.querySelector(".js-slider-items") as HTMLElement,
      items: this.sliderEl.querySelectorAll(".js-slider-item"),
    };
    this.dragPos = 0;
    this.smoothDragPos = 0;
    this.dragProgress = 0;
    this.smoothDragProgress = 0;
    o.AssetLoader.loaded.then(() => {
      this.build();
      this.addEvents();
    });
  }

  build() {
    for (let e = 0; e < this.dom.items.length; e++) {
      this.dom.items[e]._originalZ = this.dom.items[e].dataset.z || 0;
      this.dom.items[e]._glProps = {
        "position.x": 0,
        "position.z": this.dom.items[e]._originalZ,
        uniforms: { u_edgeFade: 1 },
      };
    }
    this.onResize();
  }

  addEvents() {
    E.on(o.events.MOUSEDRAG, this.onDrag);
    E.on(o.events.RESIZE, this.onResize);
    o.RAFCollection.add(this.onRaf, 4);
  }

  destroy() {
    E.off(o.events.MOUSEDRAG, this.onDrag);
    E.off(o.events.RESIZE, this.onResize);
    o.RAFCollection.remove(this.onRaf);
  }
}

export default GridSlider;
