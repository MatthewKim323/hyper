import { HalfFloatType, PerspectiveCamera, Scene, Vector2, WebGLRenderer, WebGLRenderTarget } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GammaCorrectionShader } from "three/examples/jsm/shaders/GammaCorrectionShader.js";

/** Linear scene render, restrained highlight bloom, then one display conversion. */
export function createAtriumPipeline(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 2 : 0 });
  const composer = new EffectComposer(renderer, target);
  const beauty = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new Vector2(1, 1), .24, .55, .88);
  const display = new ShaderPass(GammaCorrectionShader);
  composer.addPass(beauty);
  composer.addPass(bloom);
  composer.addPass(display);
  return {
    render() { composer.render(); },
    resize(width: number, height: number) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(width, height); },
    dispose() {
      bloom.dispose();
      [bloom.materialHighPassFilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial, bloom.materialCopy, bloom.basic].forEach(material => material.dispose());
      display.material.dispose();
      (display.fsQuad as { dispose(): void }).dispose();
      composer.copyPass.material.dispose();
      (composer.copyPass.fsQuad as { dispose(): void }).dispose();
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();
    },
  };
}
