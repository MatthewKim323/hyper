// Handoff from onboarding to the 3D world using the landing-to-gallery transition:
// the same noisy bottom-to-top wipe with a centre zoom (home-transition-wipe-zoom), the same
// 3 s power4.inOut timing and the same water cue.
//
// The landing transition blends two scenes inside the engine's composer. The world is a
// separate renderer on its own canvas, so here the outgoing gallery frame is frozen into a
// texture and drawn on an overlay with that shader's exact wipe and zoom maths, and the
// overlay's alpha (1 - wipe) uncovers the live world underneath. The incoming camera rise
// is approximated by easing the world canvas up into place.
import gsap from "gsap";
import { store as storeRaw } from "@/lib/engine/core/store";

import { CanvasTexture, LinearFilter, ShaderMaterial } from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { captureWarmFrame } from "@/components/atrium/warm-frame";
import { homeTransitionWipeVert } from "@/lib/engine/shaders/home-transition-wipe.vert.glsl";
import { homeTransitionWipeZoomFrag } from "@/lib/engine/shaders/home-transition-wipe-zoom.frag.glsl";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store: any = storeRaw;

const DURATION = 3;
const EASE = "power4.inOut";
const WORLD_READY_TIMEOUT = 12000;

const VERT = `attribute vec2 position; varying vec2 vUv;
void main() { vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;

// Body copied from home-transition-wipe-zoom.frag. Only the output differs: the incoming
// scene is the live page below, so it is revealed through alpha rather than sampled.
const FRAG = `precision highp float;
varying vec2 vUv;
uniform sampler2D u_fromScene;
uniform sampler2D u_noise;
uniform float u_progress;
uniform float u_time;
uniform float u_hasNoise;

vec2 mirrored(vec2 v) {
	vec2 m = mod(v, 2.);
	return mix(m, 2.0 - m, step(1.0, m));
}

void main() {
	vec2 noiseUv = vUv + u_time * 0.04;
	noiseUv.x *= 0.1;
	vec4 noise = texture2D(u_noise, mirrored(noiseUv));
	float prog = u_progress - 0.05 + noise.g * 0.06 * u_hasNoise;
	float intpl = pow(abs(smoothstep(0., 1., (prog * 2. - vUv.y + 0.5))), 20.);
	vec4 fromColor = texture2D(u_fromScene, (vUv - 0.5) * (1.0 - intpl) + 0.5);
	gl_FragColor = vec4(fromColor.rgb, 1.0 - intpl);
}`;

let running = false;

/** One engine frame, captured after the composer has drawn (index 99) and before the buffer is presented. */
function captureGallery(): Promise<HTMLCanvasElement | null> {
  const source = document.querySelector<HTMLCanvasElement>("#gl");
  const raf = store.RAFCollection;
  if (!source || !raf || !source.width || !source.height) return Promise.resolve(null);
  return new Promise(resolve => {
    const timer = setTimeout(() => { raf.remove(grab); resolve(null); }, 2000);
    const grab = () => {
      raf.remove(grab);
      clearTimeout(timer);
      const copy = document.createElement("canvas");
      copy.width = source.width;
      copy.height = source.height;
      const context = copy.getContext("2d");
      if (!context) { resolve(null); return; }
      context.drawImage(source, 0, 0);
      resolve(copy);
    };
    raf.add(grab, 100);
  });
}

function texture(gl: WebGLRenderingContext, image: TexImageSource) {
  const result = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, result);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  // The shader mirrors its own noise lookup into 0..1, so clamping is enough for both textures.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return result;
}

function buildOverlay(frame: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", zIndex: "2147483647", pointerEvents: "none" });
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: false });
  if (!gl) return null;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERT);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  texture(gl, frame);
  gl.uniform1i(gl.getUniformLocation(program, "u_fromScene"), 0);
  const noise = store.Gl?.assets?.textures?.gradientNoise?.image as TexImageSource | undefined;
  gl.activeTexture(gl.TEXTURE1);
  if (noise) texture(gl, noise);
  else { gl.bindTexture(gl.TEXTURE_2D, gl.createTexture()); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255])); }
  gl.uniform1i(gl.getUniformLocation(program, "u_noise"), 1);
  gl.uniform1f(gl.getUniformLocation(program, "u_hasNoise"), noise ? 1 : 0);
  const progress = gl.getUniformLocation(program, "u_progress");
  const time = gl.getUniformLocation(program, "u_time");
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);

  return {
    canvas,
    draw(value: number) {
      gl.uniform1f(progress, value);
      gl.uniform1f(time, performance.now() / 1000);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

function worldReady(): Promise<HTMLCanvasElement | null> {
  return new Promise(resolve => {
    const started = performance.now();
    const check = () => {
      const world = document.querySelector<HTMLCanvasElement>('canvas[data-ready="true"]');
      if (world || performance.now() - started > WORLD_READY_TIMEOUT) {
        // Two more frames so the first real image is on screen before it is uncovered.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(world)));
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

/** Same contract as the slab handoff: `onCovered` fires while the page is hidden, the promise resolves when the world is revealed. */
async function runOverlayFallback(onCovered: () => void): Promise<void> {
  if (running) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onCovered(); return; }
  running = true;
  let overlay: ReturnType<typeof buildOverlay> = null;
  try {
    // The voice surface is DOM, not part of the frozen frame, so ease it away first instead of cutting.
    const surface = document.querySelector<HTMLElement>(".hyper-onboarding");
    if (surface) await gsap.to(surface, { autoAlpha: 0, y: 12, duration: 0.5, ease: "power2.in" });
    const frame = await captureGallery();
    overlay = frame ? buildOverlay(frame) : null;
    // Observable stage for tests and debugging: capture-failed | covering | revealing.
    document.documentElement.dataset.handoff = overlay ? "covering" : "capture-failed";
    if (!overlay) { onCovered(); return; }
    overlay.draw(0);
    document.documentElement.appendChild(overlay.canvas);

    // The frozen gallery now sits over everything, so the voice surface is already covered
    // and the world can mount and load behind it without a flash.
    onCovered();
    const world = await worldReady();
    document.documentElement.dataset.handoff = "revealing";
    const state = { progress: 0 };
    const paint = overlay;
    const timeline = gsap.timeline({ defaults: { duration: DURATION, ease: EASE } })
      .to(state, { progress: 1, onUpdate: () => paint.draw(state.progress) }, 0)
      .call(() => {
        store.Audio?.play?.({ key: "audio.new_water_projects", isInteraction: true });
      }, [], 0.6);
    if (world) {
      // Stand-in for the incoming camera rising into place on the landing transition.
      timeline.fromTo(world, { yPercent: 14, scale: 1.12, transformOrigin: "50% 50%" }, { yPercent: 0, scale: 1, clearProps: "transform,transformOrigin" }, 0);
    }
    await timeline;
  } finally {
    overlay?.dispose();
    if (document.documentElement.dataset.handoff !== "capture-failed") delete document.documentElement.dataset.handoff;
    running = false;
  }
}


/**
 * The landing-to-gallery transition, reused as is: the engine's own wipe-zoom shader in the engine's
 * own composer, the same 3 s power4.inOut timeline, the same outgoing camera drop and the same
 * water cue. The outgoing scene is the live gallery. The incoming scene is one frame of the
 * preloaded world, drawn just before the blend starts, so the blend runs at the gallery's frame
 * rate instead of the world's. When it lands, the live world is revealed over an identical image.
 */
async function runEngineTransition(onCovered: () => void): Promise<boolean> {
  const menu = store.ProjectMenu, gl = store.Gl;
  const noise = gl?.assets?.textures?.gradientNoise;
  if (!menu?.savePass || !menu.renderPass || !gl?.composerPasses || !noise) return false;
  const frame = captureWarmFrame();
  if (!frame) return false;

  const incoming = new CanvasTexture(frame);
  incoming.minFilter = incoming.magFilter = LinearFilter;
  incoming.generateMipmaps = false;
  const pass = new ShaderPass(new ShaderMaterial({
    vertexShader: homeTransitionWipeVert,
    fragmentShader: homeTransitionWipeZoomFrag,
    uniforms: {
      u_fromScene: { value: menu.savePass.renderTarget.texture },
      u_toScene: { value: incoming },
      u_noise: { value: noise },
      u_progress: { value: 0 },
      u_time: gl.globalUniforms.u_time,
    },
  }));
  const surface = document.querySelector<HTMLElement>(".hyper-onboarding");
  const control = menu.allowControl;
  try {
    if (surface) await gsap.to(surface, { autoAlpha: 0, y: 12, duration: 0.5, ease: "power2.in" });
    document.documentElement.dataset.handoff = "revealing";
    menu.allowControl = false;
    menu.savePass.enabled = true;
    gl.composerPasses.add(pass, 30); // the slot the landing transition uses
    // The still only carries the ripple edge. Just behind that edge the real, running world is
    // uncovered through a mask, so what the wipe reveals is already alive, and the handoff ends
    // the moment the world covers the screen instead of holding on a photograph of it.
    const room = document.querySelector<HTMLElement>("[data-warm]");
    const world = room?.querySelector<HTMLCanvasElement>("canvas") ?? null;
    const rect = world?.getBoundingClientRect();
    let live = false;
    const uncover = () => {
      if (!world || !rect || !rect.height) return;
      // Where the shader's edge sits (fraction of the viewport, from the bottom), minus its noise band.
      const edge = (2 * (pass.uniforms.u_progress.value - 0.05) - 0.5 - 0.08) * window.innerHeight;
      if (!live && edge > -0.2 * window.innerHeight) {
        live = true;
        window.dispatchEvent(new CustomEvent("hyper:world-live", { detail: { live: true } }));
        world.style.visibility = "visible";
      }
      const local = Math.max(0, rect.bottom - window.innerHeight + edge);
      const mask = `linear-gradient(to top, #000 ${local - 0.08 * window.innerHeight}px, transparent ${local}px)`;
      world.style.maskImage = mask;
      world.style.setProperty("-webkit-mask-image", mask);
    };
    uncover();
    const timeline = gsap.timeline({ defaults: { duration: DURATION, ease: EASE } })
      .fromTo(pass.uniforms.u_progress, { value: 0 }, { value: 1, onUpdate: uncover }, 0)
      .fromTo(menu.tweenParams, { cameraYOffset: 0 }, { cameraYOffset: -store.window.h / 2 }, "<")
      .call(() => {
        store.Audio?.play?.({ key: "audio.new_water_projects", isInteraction: true });
      }, [], 0.6);
    await new Promise<void>((resolve) => {
      const covered = () => { if (!world || !rect || pass.uniforms.u_progress.value >= 0.9) { gsap.ticker.remove(covered); resolve(); } };
      gsap.ticker.add(covered);
      timeline.then(() => { gsap.ticker.remove(covered); resolve(); });
    });
    timeline.kill();
    onCovered();
    if (world) { world.style.maskImage = ""; world.style.removeProperty("-webkit-mask-image"); }
    return true;
  } finally {
    gl.composerPasses.remove(pass);
    menu.savePass.enabled = false;
    menu.tweenParams.cameraYOffset = 0;
    menu.allowControl = control;
    pass.material.dispose();
    incoming.dispose();
    // Let the revealed world take over first, so nothing pauses or hides for a frame in between.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("hyper:world-live", { detail: { live: false } }));
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-ready="true"]');
      if (canvas) canvas.style.visibility = "";
    }, 1000);
    delete document.documentElement.dataset.handoff;
  }
}

/** Same contract as before: `onCovered` reveals the world, the promise resolves when the handoff is over. */
export async function runOnboardingWipeHandoff(onCovered: () => void): Promise<void> {
  if (running) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onCovered(); return; }
  running = true;
  let done = false;
  try { done = await runEngineTransition(onCovered); }
  catch { done = false; }
  finally { running = false; }
  // Engine passes missing (for example the scene never booted): fall back to the standalone overlay.
  if (!done) await runOverlayFallback(onCovered);
}
