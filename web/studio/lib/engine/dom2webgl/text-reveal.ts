/* eslint-disable @typescript-eslint/no-explicit-any */
// TextReveal:
// a plane over a DOM text block, filled with the project bg colour and dissolved by a noise mask (u_progress 0 -> 1).
import { Mesh, PlaneGeometry, ShaderMaterial } from "three";
import { store } from "../core/store";
import { projectTextRevealNoiseMaskVert } from "../shaders/project-text-reveal-noise-mask.vert.glsl";
import { projectTextRevealNoiseMaskFrag } from "../shaders/project-text-reveal-noise-mask.frag.glsl";
import { WebGLItem, type WebGLItemOptions } from "./webgl-item";

const o: any = store;

let textRevealGeometry: PlaneGeometry | null = null;
let textRevealMaterial: ShaderMaterial | null = null;

// Created lazily so importing never touches WebGL state.
function shared() {
  if (!textRevealGeometry) textRevealGeometry = new PlaneGeometry();
  if (!textRevealMaterial)
    textRevealMaterial = new ShaderMaterial({
      uniforms: {
        u_bgColor: { value: [0, 0, 0] },
        u_progress: { value: 0 },
        u_scrollPos: { value: 0 },
        u_ratio: { value: 1 },
      },
      vertexShader: projectTextRevealNoiseMaskVert,
      fragmentShader: projectTextRevealNoiseMaskFrag,
      transparent: true,
      depthTest: false,
    });
  return { geometry: textRevealGeometry, material: textRevealMaterial };
}

export class TextReveal extends WebGLItem {
  constructor(e: WebGLItemOptions) {
    super(e);
    const { geometry, material } = shared();
    this.item = new Mesh(geometry, material.clone());
    this.item.material.uniforms.u_bgColor.value = o.Project.backgroundColorGl;
    this.renderOrder = -2;
    this.add(this.item);
  }

  syncDomSize() {
    super.syncDomSize();
    if (this.widthPx > this.heightPx) this.item.material.uniforms.u_ratio.value = this.widthPx / this.heightPx;
    else this.item.material.uniforms.u_ratio.value = this.heightPx / this.widthPx;
  }

  animate(e: number, t: number) {
    super.animate(e, t);
    this.item.material.uniforms.u_scrollPos.value = e;
  }
}

export default TextReveal;
