import { ClampToEdgeWrapping, DataTexture, LinearEncoding, LinearFilter, RGBAFormat, UnsignedByteType } from "three";

const WIDTH = 128;
const HEIGHT = 72;
const FIXED_STEP = 1 / 60;
const MAX_STEPS = 8;
const DAMPING = 0.985;
const SPLASH_RADIUS = 5;
const SPLASH_VARIANCE = 1.65 * 1.65;
const REST_THRESHOLD = 1 / 65535;

export type WaterRipples = {
  texture: DataTexture;
  step(deltaSeconds: number): void;
  splash(u: number, v: number, strength?: number): void;
  reset(): void;
  dispose(): void;
};

/**
 * Small fixed-step wave simulation with bottom-origin texture coordinates.
 * Decode normalized RG samples in GLSL using:
 * ((sample.r * 255.0 * 256.0 + sample.g * 255.0) / 65535.0 - 0.5) * 2.0
 * Linear filtering is valid because this packing is a linear weighted sum.
 */
export function createWaterRipples(): WaterRipples {
  let current = new Float32Array(WIDTH * HEIGHT);
  let previous = new Float32Array(WIDTH * HEIGHT);
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  const texture = new DataTexture(pixels, WIDTH, HEIGHT, RGBAFormat, UnsignedByteType);
  texture.name = "Hyper atrium interaction ripples";
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.encoding = LinearEncoding;
  texture.generateMipmaps = false;
  texture.flipY = false;

  let accumulated = 0;
  let active = false;
  let disposed = false;

  function upload() {
    for (let index = 0; index < current.length; index++) {
      const packed = Math.round((current[index] * 0.5 + 0.5) * 65535);
      const offset = index * 4;
      pixels[offset] = packed >>> 8;
      pixels[offset + 1] = packed & 255;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 255;
    }
    texture.needsUpdate = true;
  }

  function reset() {
    if (disposed) return;
    current.fill(0);
    previous.fill(0);
    accumulated = 0;
    active = false;
    upload();
  }

  function step(deltaSeconds: number) {
    if (disposed || !active || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    // Drop elapsed time from suspended tabs instead of simulating a long catch-up.
    accumulated += Math.min(deltaSeconds, FIXED_STEP * MAX_STEPS);
    let steps = 0;
    while (accumulated + 1e-10 >= FIXED_STEP && steps < MAX_STEPS) {
      let largest = 0;
      for (let row = 1; row < HEIGHT - 1; row++) {
        const end = row * WIDTH + WIDTH - 1;
        for (let index = row * WIDTH + 1; index < end; index++) {
          const height = current[index];
          // CFL = sqrt(0.5), with fixed zero boundaries. Reuse the old buffer.
          const next = ((current[index - 1] + current[index + 1] + current[index - WIDTH] + current[index + WIDTH]) * 0.5 - previous[index]) * DAMPING;
          previous[index] = Math.max(-1, Math.min(1, next));
          largest = Math.max(largest, Math.abs(previous[index]), Math.abs(height));
        }
      }
      const swap = previous;
      previous = current;
      current = swap;
      accumulated = Math.max(0, accumulated - FIXED_STEP);
      steps++;
      if (largest < REST_THRESHOLD) {
        current.fill(0);
        previous.fill(0);
        accumulated = 0;
        active = false;
        break;
      }
    }
    if (steps > 0) upload();
  }

  function splash(u: number, v: number, strength = 0.18) {
    if (disposed || !Number.isFinite(u) || !Number.isFinite(v) || !Number.isFinite(strength) || strength === 0) return;
    const x = Math.min(WIDTH - 2, Math.max(1, Math.min(1, Math.max(0, u)) * (WIDTH - 1)));
    const y = Math.min(HEIGHT - 2, Math.max(1, Math.min(1, Math.max(0, v)) * (HEIGHT - 1)));
    const amplitude = Math.min(1, Math.max(-1, strength));
    const minX = Math.max(1, Math.floor(x - SPLASH_RADIUS));
    const maxX = Math.min(WIDTH - 2, Math.ceil(x + SPLASH_RADIUS));
    const minY = Math.max(1, Math.floor(y - SPLASH_RADIUS));
    const maxY = Math.min(HEIGHT - 2, Math.ceil(y + SPLASH_RADIUS));
    for (let row = minY; row <= maxY; row++) {
      const dy = row - y;
      for (let column = minX; column <= maxX; column++) {
        const dx = column - x;
        const amount = amplitude * Math.exp(-(dx * dx + dy * dy) / (2 * SPLASH_VARIANCE));
        const index = row * WIDTH + column;
        current[index] = Math.max(-1, Math.min(1, current[index] + amount));
      }
    }
    active = true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    active = false;
    texture.dispose();
  }

  reset();
  return { texture, step, splash, reset, dispose };
}
