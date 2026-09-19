/* eslint-disable @typescript-eslint/no-explicit-any */
// ProjectTransition / ProjectTransitionText / ProjectScrollProgress:
// the next-project colour sweep plane, the footer texts that sweep to the next colour, and the scroll progress bar.
import { Color, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import { store } from "../../core/store";
import { $ } from "../../core/component-manager";
import { projectTransitionPlaneVert } from "../../shaders/project-transition-plane.vert.glsl";
import { projectTransitionPlaneColorSweepFrag } from "../../shaders/project-transition-plane-color-sweep.frag.glsl";
import { projectColorSweepVert } from "../../shaders/project-color-sweep.vert.glsl";
import { projectColorSweepScreenspaceFogFrag } from "../../shaders/project-color-sweep-screenspace-fog.frag.glsl";
import { WebGLItem, type WebGLItemOptions } from "../webgl-item";
import { WebGLText } from "../webgl-text";

const o: any = store;

export class ProjectTransition extends WebGLItem {
  build() {
    this.item = new Mesh(
      new PlaneGeometry(),
      new ShaderMaterial({
        vertexShader: projectTransitionPlaneVert,
        fragmentShader: projectTransitionPlaneColorSweepFrag,
        uniforms: {
          u_toColor: { value: new Color(this.domEl.dataset.nextBgcolor) },
          u_progress: { value: 0 },
          u_adjust: { value: 1 },
          u_velo: { value: 0 },
        },
        depthTest: false,
      }),
    );
    this.item.renderOrder = 0;
    this.add(this.item);
  }
}

export class ProjectTransitionText extends WebGLText {
  build() {
    super.build();
    this.item.material = new ShaderMaterial({
      vertexShader: projectColorSweepVert,
      fragmentShader: projectColorSweepScreenspaceFogFrag,
      uniforms: {
        u_fromColor: { value: new Color() },
        u_toColor: { value: new Color(this.domEl.dataset.nextColor) },
        u_progress: { value: 0 },
        u_adjust: { value: 1 },
        u_velo: { value: 0 },
        u_resolution: o.Gl.globalUniforms.u_resolution,
        fogNear: o.Gl.globalUniforms.fogNear,
        fogFar: o.Gl.globalUniforms.fogFar,
        fogColor: o.Gl.globalUniforms.fogColor,
      },
      depthTest: false,
      transparent: true,
    });
  }

  syncDomSize() {
    super.syncDomSize();
    this.item.material.uniforms.u_fromColor.value.set(this.item.color);
    this.item.material.uniforms.u_resolution.value.set(
      o.window.w * o.Gl.renderer.getPixelRatio(),
      o.window.fullHeight * o.Gl.renderer.getPixelRatio(),
    );
  }
}

export class ProjectScrollProgress extends WebGLItem {
  widthReferenceEl: HTMLElement;

  constructor(e: WebGLItemOptions) {
    super(e);
    this.widthReferenceEl = $(".js-keep-scrolling") as HTMLElement;
  }

  build() {
    this.item = new Mesh(
      new PlaneGeometry(),
      new ShaderMaterial({
        vertexShader: projectColorSweepVert,
        fragmentShader: projectColorSweepScreenspaceFogFrag,
        uniforms: {
          u_fromColor: { value: new Color(this.domEl.dataset.color) },
          u_toColor: { value: new Color(this.domEl.dataset.nextColor) },
          u_progress: { value: 0 },
          u_adjust: { value: 1 },
          u_velo: { value: 0 },
          u_resolution: o.Gl.globalUniforms.u_resolution,
          fogNear: o.Gl.globalUniforms.fogNear,
          fogFar: o.Gl.globalUniforms.fogFar,
          fogColor: o.Gl.globalUniforms.fogColor,
        },
        depthTest: false,
        transparent: true,
      }),
    );
    this.item.renderOrder = 10;
    this.scale.x = 0;
    this.add(this.item);
  }

  syncDomSize() {
    this.item.scale.set(this.widthReferenceEl.offsetWidth, 2, 1);
    this.item.material.uniforms.u_resolution.value.set(
      o.window.w * o.Gl.renderer.getPixelRatio(),
      o.window.fullHeight * o.Gl.renderer.getPixelRatio(),
    );
  }

  calcPixelScale() {}
}
