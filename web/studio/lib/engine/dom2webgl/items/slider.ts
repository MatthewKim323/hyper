/* eslint-disable @typescript-eslint/no-explicit-any */
// Slider: WebGL drag slider (.js-slider-wrap),
// active slide full width, neighbours squeezed to the second image width, hover inner-scale, prev/next buttons.
import { Group, MathUtils, Mesh, PlaneGeometry, Raycaster, ShaderMaterial, Texture, Vector2 } from "three";
import gsap from "gsap";
import E from "../../core/event-bus";
import { store } from "../../core/store";
import { projectSliderImageVert } from "../../shaders/project-slider-image.vert.glsl";
import { projectSliderImageCoverEdgeRgbshiftFrag } from "../../shaders/project-slider-image-cover-edge-rgbshift.frag.glsl";
import { WebGLItem, type WebGLItemOptions } from "../webgl-item";

const o: any = store;

export class Slider extends WebGLItem {
  dom: any;
  built: boolean;
  active: boolean;
  slideCount: number;
  dragPos: number;
  maxDragPos: number;
  smoothDragPos: number;
  minWidth: number;
  dragSpeed: number;
  origPositions: number[];
  activeIndex: number;
  raycastObjects: any[];
  hoveredItem: any;
  mouseDown: boolean;
  raycaster: Raycaster;
  hasDragged = false;
  dragProgress = 0;
  leftEdge = 0;
  rightEdge = 0;
  positionOffsetLimit = 0;

  prevSlide = () => {
    const e = this.activeIndex - 1;
    if (e < 0) return;
    this.activeIndex = e;
    this.dragPos = -this.origPositions[e];
    this.updateButtonStates();
    this.updateIndexText();
  };

  nextSlide = () => {
    const e = this.activeIndex + 1;
    if (e > this.slideCount - 1) return;
    this.activeIndex = e;
    this.dragPos = -this.origPositions[e];
    this.updateButtonStates();
    this.updateIndexText();
  };

  onMouseDown = ({ event: e }: any) => {
    if (this.dom.wrap.contains(e.target)) {
      document.body.style.userSelect = "none";
      this.mouseDown = true;
      if (this.hoveredItem) this.slideMouseLeave();
    }
  };

  onMouseUp = () => {
    document.body.style.removeProperty("user-select");
    this.mouseDown = false;
    if (this.hasDragged) {
      const e = this.origPositions.reduce((a, t) =>
        Math.abs(t - -this.dragPos) < Math.abs(a - -this.dragPos) ? t : a,
      );
      this.activeIndex = this.origPositions.indexOf(e);
      this.updateButtonStates();
      this.updateIndexText();
      this.dragPos = -e;
    } else if (this.hoveredItem) {
      this.dragPos = -this.hoveredItem.parent.origPos;
      this.activeIndex = this.hoveredItem.slideIndex;
      this.updateButtonStates();
      this.updateIndexText();
      this.slideMouseLeave();
    }
    this.hasDragged = false;
  };

  onDrag = ({ ox: e, px: t, x: i, event: ev }: any) => {
    if (!this.dom.wrap.contains(ev.target)) return;
    if (Math.abs(e - i) < 2) return;
    this.dragPos -= (t - i) * this.dragSpeed;
    this.dragPos = MathUtils.clamp(this.dragPos, this.maxDragPos, 0);
    this.hasDragged = true;
    this.dragProgress = this.dragPos / this.maxDragPos;
    this.dom.wrap.dataset.cursorProgress = this.dragProgress;
    E.emit("cursor:progress", this.dragProgress);
  };

  onEnter = () => {
    this.active = true;
  };

  onLeave = () => {
    this.active = false;
  };

  onNavMouseEnter = (e: any) => {
    gsap.fromTo(e.target.querySelector("span"), { x: "-101%" }, { x: "0%", duration: 0.5, ease: "expo.out" });
  };

  onNavMouseLeave = (e: any) => {
    gsap.to(e.target.querySelector("span"), { x: "101%", duration: 0.5, ease: "expo.out" });
  };

  constructor(e: WebGLItemOptions) {
    super(e);
    this.dom = {
      wrap: this.domEl.closest(".js-slider-wrap"),
      images: this.domEl.querySelectorAll(".js-slider-image"),
    };
    this.dom.prev = this.dom.wrap.querySelector(".js-slider-prev");
    this.dom.next = this.dom.wrap.querySelector(".js-slider-next");
    this.dom.index = this.dom.wrap.querySelector(".js-slider-index");
    gsap.set([this.dom.prev.querySelector("span"), this.dom.next.querySelector("span")], { x: "-101%" });
    this.built = false;
    this.active = false;
    this.slideCount = this.dom.images.length;
    this.dragPos = 0;
    this.maxDragPos = 0;
    this.smoothDragPos = 0;
    this.minWidth = 0;
    this.dragSpeed = o.isTouch ? 0.75 : 0.5;
    this.origPositions = [];
    this.activeIndex = 0;
    this.raycastObjects = [];
    this.hoveredItem = false;
    this.mouseDown = false;
    e.elObj.enter = this.onEnter;
    e.elObj.leave = this.onLeave;
    this.raycaster = new Raycaster();
  }

  build() {
    const e = new ShaderMaterial({
      vertexShader: projectSliderImageVert,
      fragmentShader: projectSliderImageCoverEdgeRgbshiftFrag,
      uniforms: {
        u_texture: { value: null },
        u_imageSize: { value: new Vector2() },
        u_meshSize: { value: new Vector2() },
        u_resolution: o.Gl.globalUniforms.u_resolution,
        u_innerScale: { value: 1 },
      },
    });
    for (let t = 0; t < this.dom.images.length; t++) {
      const i: any = new Group();
      const n: any = new Mesh(new PlaneGeometry(), e.clone());
      const r = new Image();
      r.crossOrigin = "";
      const a = new Texture(r);
      r.addEventListener(
        "load",
        () => {
          a.needsUpdate = true;
          o.Gl.renderer.initTexture(a);
        },
        { once: true },
      );
      r.src = this.dom.images[t].src;
      n.material.uniforms.u_texture.value = a;
      n.material.uniforms.u_imageSize.value.set(this.dom.images[t].naturalWidth, this.dom.images[t].naturalHeight);
      a.needsUpdate = true;
      n.slideIndex = t;
      i.add(n);
      this.add(i);
      this.raycastObjects.push(n);
    }
    this.built = true;
    this.addEvents();
  }

  animate() {
    this.position.y = this.originalPosition.y + o.ASScroll.currentPos;
    if (!this.active) return;
    if (!this.built) return;
    this.smoothDragPos += 0.1 * (this.dragPos - this.smoothDragPos);
    for (let e = 0; e < this.slideCount; e++) {
      const t: any = this.children[e];
      t.position.x = t.origPos + this.smoothDragPos;
      const i = MathUtils.clamp(
        2 * ((Math.abs(t.position.x) - this.leftEdge) / (this.rightEdge - this.leftEdge) - 0.5),
        0,
        1,
      );
      const s = MathUtils.clamp(2 * ((t.position.x - this.leftEdge) / (this.rightEdge - this.leftEdge) - 0.5), -1, 1);
      t.children[0].scale.x = Math.max(this.widthPx * (1 - i), this.minWidth);
      t.children[0].position.x = MathUtils.clamp(
        0.5 * this.widthPx * s,
        -this.positionOffsetLimit,
        this.positionOffsetLimit,
      );
      t.children[0].material.uniforms.u_meshSize.value.x = t.children[0].scale.x;
    }
    if (this.mouseDown) return;
    this.raycaster.setFromCamera(o.mouse.glNormalized, o.Gl.camera);
    const e = this.raycaster.intersectObjects(this.raycastObjects, false);
    if (e.length) {
      if (this.hoveredItem !== e[0].object) {
        if (this.hoveredItem) {
          this.slideMouseLeave();
          this.hoveredItem = false;
          this.dom.wrap.style.cursor = "default";
        }
        if ((e[0].object as any).slideIndex !== this.activeIndex) {
          this.hoveredItem = e[0].object;
          this.dom.wrap.style.cursor = "pointer";
          this.slideMouseEnter();
        }
      }
    } else if (this.hoveredItem) {
      this.slideMouseLeave();
      this.hoveredItem = false;
      this.dom.wrap.style.cursor = "default";
    }
  }

  slideMouseEnter() {
    const e = this.hoveredItem;
    gsap.to(e.material.uniforms.u_innerScale, { value: 1.05, duration: 0.5, ease: "expo.out" });
    if (!o.isTouch) o.Cursor.hideEnter();
  }

  slideMouseLeave() {
    const e = this.hoveredItem;
    gsap.to(e.material.uniforms.u_innerScale, { value: 1, duration: 0.5, ease: "expo.out" });
    if (!o.isTouch) o.Cursor.hideLeave();
  }

  addEvents() {
    E.on(o.events.MOUSEDOWN, this.onMouseDown);
    E.on(o.events.MOUSEUP, this.onMouseUp);
    E.on(o.events.MOUSEDRAG, this.onDrag);
    E.on("click", this.dom.prev, this.prevSlide);
    E.on("click", this.dom.next, this.nextSlide);
    if (!o.isTouch) {
      E.on("mouseenter", [this.dom.prev, this.dom.next], this.onNavMouseEnter);
      E.on("mouseleave", [this.dom.prev, this.dom.next], this.onNavMouseLeave);
    }
  }

  updateButtonStates() {
    this.dom.prev.disabled = 0 === this.activeIndex;
    this.dom.next.disabled = this.activeIndex === this.slideCount - 1;
    this.dragProgress = this.dragPos / this.maxDragPos;
    this.dom.wrap.dataset.cursorProgress = this.dragProgress;
    E.emit("cursor:progress", this.dragProgress);
  }

  updateIndexText() {
    this.dom.index.innerHTML = this.activeIndex + 1;
  }

  syncDomSize() {
    this.widthPx = this.domEl.clientWidth;
    this.heightPx = this.domEl.clientHeight;
    this.minWidth = this.dom.images[1].clientWidth;
    const e = o.mq.xs.matches ? 15 : o.mq.sm.matches ? 25 : 35;
    this.leftEdge = -this.minWidth - 33.5;
    this.rightEdge = this.minWidth + 33.5;
    this.positionOffsetLimit = this.widthPx / 2 - this.minWidth / 2;
    this.maxDragPos = (-this.minWidth - e) * (this.slideCount - 1);
    for (let t = 0; t < this.slideCount; t++) {
      const c: any = this.children[t];
      c.children[0].scale.set(this.widthPx, this.heightPx, 1);
      c.children[0].material.uniforms.u_meshSize.value.set(this.widthPx, this.heightPx);
      c.children[0].material.uniforms.u_resolution.value.set(o.window.w, o.window.fullHeight);
      c.origPos = (this.minWidth + e) * t;
      this.origPositions[t] = c.origPos;
    }
  }

  calcPixelScale() {}

  dispose() {
    super.dispose();
    E.off(o.events.MOUSEDOWN, this.onMouseDown);
    E.off(o.events.MOUSEUP, this.onMouseUp);
    E.off(o.events.MOUSEDRAG, this.onDrag);
    E.off("click", this.dom.prev, this.prevSlide);
    E.off("click", this.dom.next, this.nextSlide);
    if (!o.isTouch) {
      E.off("mouseenter", [this.dom.prev, this.dom.next], this.onNavMouseEnter);
      E.off("mouseleave", [this.dom.prev, this.dom.next], this.onNavMouseLeave);
    }
  }
}

export default Slider;
