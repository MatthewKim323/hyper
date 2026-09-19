import { ShaderMaterial, UniformsUtils, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';

/**
 * SavePass variant: CopyShader into a caller-owned render target,
 * `needsSwap = false`, plus `setSize` forwarding to the target. Used by ProjectMenu.
 */
export class SavePass extends Pass {
  textureID: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  uniforms: Record<string, { value: any }>;
  material: ShaderMaterial;
  renderTarget: WebGLRenderTarget;
  fsQuad: FullScreenQuad;

  constructor(e?: WebGLRenderTarget) {
    super();
    if (CopyShader === undefined) console.error('THREE.SavePass relies on CopyShader');
    const t = CopyShader;
    this.textureID = 'tDiffuse';
    this.uniforms = UniformsUtils.clone(t.uniforms);
    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: t.vertexShader,
      fragmentShader: t.fragmentShader,
    });
    if (e === undefined) {
      this.renderTarget = new WebGLRenderTarget(window.innerWidth, window.innerHeight);
      this.renderTarget.texture.name = 'SavePass.rt';
    } else {
      this.renderTarget = e;
    }
    this.needsSwap = false;
    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(e: WebGLRenderer, _t: WebGLRenderTarget, i: WebGLRenderTarget) {
    if (this.uniforms[this.textureID]) this.uniforms[this.textureID].value = i.texture;
    e.setRenderTarget(this.renderTarget);
    if (this.clear) e.clear();
    this.fsQuad.render(e);
  }

  setSize(e: number, t: number) {
    this.renderTarget.setSize(e, t);
  }
}
