// BrownianMotion camera shake.
import { Euler, Matrix4, Quaternion, Vector3 } from "three";

const _euler = new Euler();
const _vec = new Vector3();
const AMP_NORM = 1 / 0.75;

// 1D value noise, 256 random table, smoothstep interpolation.
const valueNoise = (() => {
  let amplitude = 1;
  let scale = 1;
  const table: number[] = [];
  for (let i = 0; i < 256; ++i) table.push(Math.random());
  const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
  return {
    getVal(x: number) {
      const sx = x * scale;
      const xFloor = Math.floor(sx);
      const t = sx - xFloor;
      const tRemap = t * t * (3 - 2 * t);
      const xMin = xFloor & 255;
      const xMax = (xMin + 1) & 255;
      return lerp(table[xMin], table[xMax], tRemap) * amplitude;
    },
    setAmplitude(a: number) {
      amplitude = a;
    },
    setScale(s: number) {
      scale = s;
    },
  };
})();

function fbm(t: number, levels: number) {
  let sum = 0;
  let amp = 0.5;
  for (let i = 0; i < levels; i++) {
    sum += amp * valueNoise.getVal(t);
    t *= 2;
    amp *= 0.5;
  }
  return sum;
}

export class BrownianMotion {
  position = new Vector3();
  rotation = new Quaternion();
  scale = new Vector3(1, 1, 1);
  matrix = new Matrix4();
  enablePositionNoise = true;
  enableRotationNoise = true;
  positionFrequency = 0.25;
  rotationFrequency = 0.25;
  positionAmplitude = 0.3;
  rotationAmplitude = 0.003;
  positionScale = new Vector3(1, 1, 1);
  rotationScale = new Vector3(1, 1, 0);
  positionFractalLevel = 3;
  rotationFractalLevel = 3;
  times = new Float32Array(6);

  constructor() {
    this.rehash();
  }

  rehash() {
    for (let e = 0; e < 6; e++) this.times[e] = -1e4 * Math.random();
  }

  update(dt?: number) {
    let t: number;
    dt = dt === undefined ? 1e3 / 60 : dt;
    if (this.enablePositionNoise) {
      for (t = 0; t < 3; t++) this.times[t] += this.positionFrequency * dt;
      _vec.set(
        fbm(this.times[0], this.positionFractalLevel),
        fbm(this.times[1], this.positionFractalLevel),
        fbm(this.times[2], this.positionFractalLevel),
      );
      _vec.multiply(this.positionScale);
      _vec.multiplyScalar(this.positionAmplitude * AMP_NORM);
      this.position.copy(_vec);
    }
    if (this.enableRotationNoise) {
      for (t = 0; t < 3; t++) this.times[t + 3] += this.rotationFrequency * dt;
      _vec.set(
        fbm(this.times[3], this.rotationFractalLevel),
        fbm(this.times[4], this.rotationFractalLevel),
        fbm(this.times[5], this.rotationFractalLevel),
      );
      _vec.multiply(this.rotationScale);
      _vec.multiplyScalar(this.rotationAmplitude * AMP_NORM);
      _euler.set(_vec.x, _vec.y, _vec.z);
      this.rotation.setFromEuler(_euler);
    }
    this.matrix.compose(this.position, this.rotation, this.scale);
  }
}

export default BrownianMotion;
