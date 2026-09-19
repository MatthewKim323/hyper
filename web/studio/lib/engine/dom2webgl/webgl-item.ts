/* eslint-disable @typescript-eslint/no-explicit-any */
// WebGLItem: Group synced to a DOM element.
// Position follows the ASScroll position, `_glProps` on the DOM element is mirrored onto the mesh each frame.
import { Box3, Group, Vector2, Vector3 } from "three";
import { store } from "../core/store";

const o: any = store;

export interface WebGLItemOptions {
  name?: string;
  domEl: any;
  assetType?: string | null;
  item?: any;
  elObj?: any;
}

export class WebGLItem extends Group {
  options: WebGLItemOptions;
  item: any;
  domEl: any;
  assetType: string | null | undefined;
  bbox: Box3;
  pixelScale: Vector2;
  originalPosition: Vector3;
  originalRotation: Vector3;
  updatePosition: boolean;
  animateProps: any;
  widthPx = 0;
  heightPx = 0;

  constructor(e: WebGLItemOptions) {
    super();
    this.options = Object.assign({ name: "", domEl: null, assetType: null }, e);
    if (this.options.item) {
      this.item = this.options.item;
      this.add(this.item);
    }
    this.name = this.options.name || "";
    this.domEl = this.options.domEl;
    this.domEl._webGLItem = this;
    this.assetType = this.options.assetType;
    this.bbox = new Box3();
    this.pixelScale = new Vector2();
    this.originalPosition = new Vector3();
    this.originalRotation = new Vector3();
    this.updatePosition = true;
    this.visible = false;
    this.animateProps = false;
  }

  calcPixelScale() {
    this.bbox.setFromObject(this.item);
    this.pixelScale.set(-this.bbox.min.x + this.bbox.max.x, -this.bbox.min.y + this.bbox.max.y);
  }

  syncDomSize() {
    this.widthPx = this.domEl.clientWidth;
    this.heightPx = this.domEl.clientHeight;
    this.item.scale.set(this.widthPx, this.heightPx, 1);
    if ("image" === this.assetType) {
      if (this.item.material.uniforms.u_size) this.item.material.uniforms.u_size.value = [this.widthPx, this.heightPx];
      if (this.item.material.uniforms.u_imageSize)
        this.item.material.uniforms.u_imageSize.value = [this.domEl.naturalWidth, this.domEl.naturalHeight];
    }
  }

  build() {
    if ("image" === this.assetType)
      o.TaskScheduler.enqueueTask(() => {
        this.item.material.uniforms.u_texture.value.needsUpdate = true;
        o.Gl.renderer.initTexture(this.item.material.uniforms.u_texture.value);
      });
  }

  mapAnimateProps() {
    if (this.domEl._glProps) {
      this.animateProps = { ...this.domEl._glProps };
      for (const e in this.animateProps) {
        this.animateProps[e] = {};
        if ("uniforms" === e)
          for (const t in this.domEl._glProps.uniforms) {
            this.animateProps[e][t] = {};
            this.animateProps[e][t].target = this.item.material.uniforms[t];
            this.animateProps[e][t].property = "value";
          }
        else {
          const t = e.split(".");
          this.animateProps[e].target = t.length > 1 ? this.item[t[0]] : this.item;
          this.animateProps[e].property = t[1] || t[0];
        }
      }
    }
  }

  animate(e: number, t: number) {
    const i = o.Dom2Webgl.axis as "x" | "y";
    if (this.updatePosition) {
      this.position[i] = o.Dom2Webgl.operations[o.Dom2Webgl.operator](this.originalPosition[i], e);
      if (this.animateProps) {
        for (const k in this.animateProps)
          if ("uniforms" !== k) {
            if (k === "position." + i)
              this.position[i] = o.Dom2Webgl.operations[o.Dom2Webgl.operator](
                this.originalPosition[i],
                e,
                this.domEl._glProps[k],
              );
            else this.animateProps[k].target[this.animateProps[k].property] = this.domEl._glProps[k];
          } else
            for (const u in this.animateProps[k])
              this.animateProps[k][u].target[this.animateProps[k][u].property] = this.domEl._glProps[k][u];
        if (this.item.material && this.item.material.uniforms && this.item.material.uniforms.u_time)
          this.item.material.uniforms.u_time.value = t;
        if (this.item.material && this.item.material.uniforms && this.item.material.uniforms.u_scrollPos)
          this.item.material.uniforms.u_scrollPos.value = e;
      }
    }
  }

  dispose() {
    this.domEl._webGLItem = null;
  }
}

export default WebGLItem;
