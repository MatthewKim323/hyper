import { HalfFloatType, LinearEncoding, PerspectiveCamera, Scene, Vector2, WebGLRenderer, WebGLRenderTarget } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ACESFilmicToneMappingShader } from "three/examples/jsm/shaders/ACESFilmicToneMappingShader.js";
import { GammaCorrectionShader } from "three/examples/jsm/shaders/GammaCorrectionShader.js";
import type { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import type { AtriumGpuPhase, AtriumGpuProfile } from "./gpu-profile";

/** Scene-linear HDR bloom, followed by one ACES and one sRGB conversion. */
export function createAtriumPipeline(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, profiler?: AtriumGpuProfile) {
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, encoding: LinearEncoding, samples: renderer.capabilities.isWebGL2 ? 2 : 0 });
  const composer = new EffectComposer(renderer, target);
  const beauty = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new Vector2(1, 1), .18, .45, 1.8);
  // r143 otherwise clips extracted highlights into unsigned-byte bloom targets.
  for (const buffer of [bloom.renderTargetBright, ...bloom.renderTargetsHorizontal, ...bloom.renderTargetsVertical]) {
    buffer.texture.type = HalfFloatType;
    buffer.texture.encoding = LinearEncoding;
  }
  const tone = new ShaderPass(ACESFilmicToneMappingShader);
  tone.uniforms.exposure.value = .83;
  const display = new ShaderPass(GammaCorrectionShader);
  const materials = [bloom.materialHighPassFilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial, bloom.materialCopy, bloom.basic, tone.material, display.material, composer.copyPass.material];
  materials.forEach(material => { material.toneMapped = false; });
  composer.addPass(beauty);
  composer.addPass(bloom);
  composer.addPass(tone);
  composer.addPass(display);
  if (profiler) {
    const passes: [Pass, AtriumGpuPhase][] = [[beauty, "beauty"], [bloom, "bloom"], [tone, "tone"], [display, "display"]];
    for (const [pass, phase] of passes) {
      const renderPass = pass.render;
      pass.render = (...args: Parameters<Pass["render"]>) => profiler.measure(phase, () => renderPass.apply(pass, args));
    }
  }
  let disposed = false;
  return {
    render() { if (!disposed) composer.render(); },
    resize(width: number, height: number) { if (!disposed) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(width, height); } },
    dispose() {
      if (disposed) return;
      disposed = true;
      bloom.dispose();
      materials.forEach(material => material.dispose());
      // Every r143 FullScreenQuad shares the same geometry, so dispose it once.
      (display.fsQuad as { dispose(): void }).dispose();
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();
      composer.passes.length = 0;
      composer.clock.stop();
    },
  };
}
