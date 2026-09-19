/* eslint-disable @typescript-eslint/no-explicit-any */
// Dom2Webgl manager: builds a WebGL item for every `[dom2webgl]` element
// (images/videos -> WebGLImage, `c:Name` -> component map), syncs them to the DOM via Dom2WebglObserver
// and moves them with ASScroll each frame (RAF index 3).
import E from "../core/event-bus";
import { store } from "../core/store";
import { ResourceTracker } from "../core/dispose";
import { components } from "./components";
import { WebGLImage } from "./webgl-image";

const o: any = store;

export class Dom2Webgl {
  selector = "dom2webgl";
  resourceTracker: ResourceTracker;
  components: Record<string, any>;
  els: Element[] = [];
  visibleEls: any[] = [];
  webGLItems: Record<string, any> = {};
  componentIds: Record<string, number> = {};
  firstObservation = true;
  smoothScrollPos = 0;
  operator: "+" | "-" = "-";
  axis: "x" | "y" = "y";
  operations: Record<string, (e: number, t: number, i?: number) => number> = {};

  onRaf = (e: number) => {
    this.smoothScrollPos = o.ASScroll.currentPos;
    this.animateDomEls(e);
  };

  onElIntersect = (e: any) => {
    if (!this.firstObservation && e.updateSize) {
      e.updateSize = false;
      this.updateDom2Webgl(e);
    }
  };

  onFirstObservation = (e: any[]) => {
    if (this.firstObservation) {
      this.firstObservation = false;
      for (let t = 0; t < e.length; t++) {
        this.webGLItems[e[t].params.webglEl].mapAnimateProps();
        this.webGLItems[e[t].params.webglEl].visible = true;
        this.updateDom2Webgl(e[t]);
        e[t].updateSize = false;
      }
    }
  };

  onResize = () => {
    for (let e = 0; e < o.Dom2WebglObserver.els.length; e++) {
      o.Dom2WebglObserver.unobserve(o.Dom2WebglObserver.els[e].el);
      this.webGLItems[o.Dom2WebglObserver.els[e].params.webglEl].syncDomSize();
      o.Dom2WebglObserver.observe(o.Dom2WebglObserver.els[e].el);
    }
    this.firstObservation = true;
    o.Dom2WebglObserver.firstObservationFired = true;
    this.updateAxis();
  };

  constructor() {
    this.updateAxis();
    this.resourceTracker = new ResourceTracker();
    this.components = components;
    E.on(o.events.RESIZE, this.onResize);
    E.on("dom2webgl", this.onElIntersect);
    E.on("firstObservation", this.onFirstObservation);
    o.RAFCollection.add(this.onRaf, 3);
  }

  build() {
    this.els = [];
    const e = document.querySelectorAll(`[${this.selector}]`);
    this.visibleEls = o.Dom2WebglObserver.visibleEls;
    this.webGLItems = {};
    this.componentIds = {};
    this.firstObservation = true;
    const t = e.length;
    for (let i = 0; i < t; i++) {
      let w: string;
      const el: any = e[i];
      const s = el.attributes[this.selector].value;
      const n: any = { el, updateSize: true, params: {} };
      if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) {
        if (o.isTouch) {
          el.style.visibility = "visible";
          continue;
        }
        w = this.addImage(el);
      } else {
        if (!s.includes("c:")) continue;
        const c = s.substring(2);
        if (!this.components[c]) continue;
        w = this.addComponent(c, s, n);
      }
      n.params.webglEl = w;
      this.els.push(el);
      if (el instanceof HTMLVideoElement) {
        n.enter = () => {
          el.play();
        };
        n.leave = () => {
          el.pause();
        };
      }
      o.Dom2WebglObserver.els.push(n);
    }
  }

  addComponent(e: string, t: string, i: any) {
    const s = t + this.componentIdGen(e);
    this.webGLItems[s] = new this.components[e]({ name: s, domEl: i.el, assetType: "component", elObj: i });
    return s;
  }

  componentIdGen(e: string) {
    if (!this.componentIds[e]) this.componentIds[e] = 0;
    return this.componentIds[e]++;
  }

  addImage(e: any) {
    const t = e.attributes.dom2webgl.value;
    this.webGLItems[t] = new WebGLImage({ name: t, domEl: e });
    return t;
  }

  enable() {
    for (const e in this.webGLItems) {
      o.Dom2WebglObserver.observe(this.webGLItems[e].domEl);
      if (this.webGLItems[e].build) this.webGLItems[e].build();
      this.resourceTracker.track(this.webGLItems[e]);
      this.webGLItems[e].calcPixelScale();
      this.webGLItems[e].syncDomSize();
      o.Gl.scene.add(this.webGLItems[e]);
    }
  }

  animateDomEls(e: number) {
    for (const t in this.webGLItems) this.webGLItems[t].animate(this.smoothScrollPos, e);
  }

  updateDom2Webgl(e: any) {
    const t = e.el._glProps && e.el._glProps["position.x"] ? parseFloat(e.el._glProps["position.x"]) : 0;
    const i = e.el._glProps && e.el._glProps["position.y"] ? parseFloat(e.el._glProps["position.y"]) : 0;
    const s = -o.window.w / 2 + (e.bcr.x + e.bcr.width / 2) - t + (o.ASScroll.isHorizontal ? this.smoothScrollPos : 0);
    const n = o.window.fullHeight / 2 - e.bcr.y - e.bcr.height / 2 + i - (o.ASScroll.isHorizontal ? 0 : this.smoothScrollPos);
    const item = this.webGLItems[e.params.webglEl];
    item.position.x = s;
    item.position.y = n;
    item.originalPosition.copy(item.position.clone());
  }

  updateAxis() {
    [this.operator, this.axis] = o.ASScroll.isHorizontal ? ["+", "x"] : ["-", "y"];
    this.operations = {
      "+": (e, t, i) => e - t + (i || 0),
      "-": (e, t, i) => e + t - (i || 0),
    };
  }

  reset() {
    this.resourceTracker.dispose();
    this.els = [];
    this.visibleEls = [];
    this.webGLItems = {};
  }
}

export default Dom2Webgl;
