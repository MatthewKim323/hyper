/* eslint-disable @typescript-eslint/no-explicit-any */
// FluidSim: stable fluids on FBOs.
// advect -> divergence -> pressure (Jacobi x iterations) -> subtract gradient. RAF index 2 while enabled.
import gsap from "gsap";
import { Camera, LinearFilter, Object3D, Raycaster, RepeatWrapping, Vector2 } from "three";
import E from "./event-bus";
import { store } from "./store";
import { FBO } from "./fbo";
import { fluidVelocityAdvectFrag } from "../shaders/fluid-velocity-advect.frag.glsl";
import { fluidDivergenceFrag } from "../shaders/fluid-divergence.frag.glsl";
import { fluidPressureJacobiFrag } from "../shaders/fluid-pressure-jacobi.frag.glsl";
import { fluidSubtractPressureGradientFrag } from "../shaders/fluid-subtract-pressure-gradient.frag.glsl";

export interface FluidOptions {
  resolution: number;
  force: number;
  iterations: number;
  mouseRadius: number;
  pressure: number;
  viscosity: number;
  forceClamp: number | false;
}

export interface FluidSimOptions {
  raycastPointer: Vector2 | null;
  raycastCamera: Camera | null;
  raycastObject: Object3D | null;
  fluid: FluidOptions;
}

export class FluidSim {
  raycaster = new Raycaster();
  prevMouse = new Vector2();
  enabled = false;
  pointerMoved = false;
  forcePointer = false;
  mousePosTween: gsap.core.Tween | null = null;
  options: FluidSimOptions;
  velocitySim!: FBO;
  divergenceSim!: FBO;
  pressureSim!: FBO;
  subtractPressureSim!: FBO;

  constructor(options: Partial<FluidSimOptions> = {}) {
    this.options = {
      raycastPointer: null,
      raycastCamera: null,
      raycastObject: null,
      fluid: {
        resolution: 256,
        force: 50,
        iterations: 2,
        mouseRadius: 0.008,
        pressure: 0.999,
        viscosity: 0.999,
        forceClamp: false,
      },
    };
    Object.assign(this.options, options);
    this.build();
  }

  onRaf = () => {
    const vel = this.velocitySim.uniforms;
    const fluid = this.options.fluid;
    vel.uPrevMouse.value.copy(this.prevMouse);
    if (this.pointerMoved) {
      if (this.options.raycastObject !== null) {
        this.raycaster.setFromCamera(this.options.raycastPointer!, this.options.raycastCamera!);
        const hits = this.raycaster.intersectObject(this.options.raycastObject);
        if (hits.length) {
          if (this.mousePosTween && this.mousePosTween.isActive()) {
            this.forcePointer = false;
            this.mousePosTween.pause();
            this.mousePosTween.kill();
          }
          const { x, y } = hits[0].uv!;
          if (this.prevMouse.x === -1 && this.prevMouse.y === -1) this.prevMouse.set(x, y);
          vel.uMouse.value.set(x, y);
          vel.uForce.value.set((x - this.prevMouse.x) * fluid.force, (y - this.prevMouse.y) * fluid.force);
          if (fluid.forceClamp) vel.uForce.value.clampScalar(-fluid.forceClamp, fluid.forceClamp);
          this.prevMouse.set(x, y);
        } else {
          vel.uMouse.value.set(-1, -1);
          vel.uForce.value.set(0, 0);
          this.prevMouse.set(-1, -1);
        }
      } else {
        const { x, y } = store.mouse.glScreenSpace;
        if (this.prevMouse.x === -1 && this.prevMouse.y === -1) this.prevMouse.set(x, y);
        vel.uMouse.value.set(x, y);
        vel.uForce.value.set((x - this.prevMouse.x) * fluid.force, (y - this.prevMouse.y) * fluid.force);
        if (fluid.forceClamp) vel.uForce.value.clampScalar(-fluid.forceClamp, fluid.forceClamp);
        this.prevMouse.set(x, y);
      }
      this.pointerMoved = false;
    } else if (!this.forcePointer) {
      vel.uMouse.value.set(-1, -1);
      vel.uForce.value.set(0, 0);
      this.prevMouse.set(-1, -1);
    }
    vel.uMouseVelocity.value.set(
      (vel.uMouse.value.x - vel.uPrevMouse.value.x) / 16,
      (vel.uMouse.value.y - vel.uPrevMouse.value.y) / 16,
    );
    this.velocitySim.update();
    this.divergenceSim.uniforms.uVelocity.value = this.velocitySim.texture;
    this.divergenceSim.update();
    this.pressureSim.uniforms.uDivergence.value = this.divergenceSim.texture;
    for (let e = 0; e < fluid.iterations; e++) this.pressureSim.update();
    this.subtractPressureSim.uniforms.uPressure.value = this.pressureSim.texture;
    this.subtractPressureSim.uniforms.uVelocity.value = this.velocitySim.texture;
    this.subtractPressureSim.update();
    vel.uTexture.value = this.subtractPressureSim.texture;
    this.velocitySim.update(false);
  };

  onPointerMove = () => {
    this.pointerMoved = true;
  };

  tweenMousePos = (from: { x: number; y: number }, to: { x: number; y: number }, duration: number, ease: string) => {
    const vel = this.velocitySim.uniforms;
    this.mousePosTween = gsap.fromTo(
      vel.uMouse.value,
      { x: from.x, y: from.y },
      {
        x: to.x,
        y: to.y,
        duration,
        ease,
        onStart: () => {
          this.forcePointer = true;
        },
        onUpdate: () => {
          vel.uForce.value.set(
            (vel.uMouse.value.x - this.prevMouse.x) * this.options.fluid.force,
            (vel.uMouse.value.y - this.prevMouse.y) * this.options.fluid.force,
          );
          this.prevMouse.set(vel.uMouse.value.x, vel.uMouse.value.y);
        },
        onComplete: () => {
          this.forcePointer = false;
        },
      },
    );
  };

  build() {
    const f = this.options.fluid;
    this.velocitySim = new FBO({
      fragmentShader: fluidVelocityAdvectFrag,
      uniforms: {
        uMouse: { value: new Vector2(-1, -1) },
        uPrevMouse: { value: new Vector2(-1, -1) },
        uMouseVelocity: { value: new Vector2() },
        uForce: { value: new Vector2() },
        uMouseRadius: { value: f.mouseRadius },
        uPressure: { value: f.pressure },
      },
      width: f.resolution,
      height: f.resolution,
      filter: LinearFilter,
      wrap: RepeatWrapping,
      createTexture: false,
    });
    this.divergenceSim = new FBO({
      fragmentShader: fluidDivergenceFrag,
      uniforms: {
        uVelocity: { value: this.velocitySim.texture },
        uViscosity: { value: f.viscosity },
      },
      width: f.resolution,
      height: f.resolution,
      filter: LinearFilter,
      wrap: RepeatWrapping,
      pingPong: false,
      createTexture: false,
    });
    this.pressureSim = new FBO({
      fragmentShader: fluidPressureJacobiFrag,
      uniforms: {
        uDivergence: { value: this.divergenceSim.texture },
        uAlpha: { value: -1 },
        uBeta: { value: 0.25 },
      },
      width: f.resolution,
      height: f.resolution,
      filter: LinearFilter,
      wrap: RepeatWrapping,
      createTexture: false,
    });
    this.subtractPressureSim = new FBO({
      fragmentShader: fluidSubtractPressureGradientFrag,
      uniforms: {
        uPressure: { value: this.pressureSim.texture },
        uVelocity: { value: this.velocitySim.texture },
      },
      width: f.resolution,
      height: f.resolution,
      filter: LinearFilter,
      wrap: RepeatWrapping,
      createTexture: false,
    });
  }

  updateFluidResolution(res: number) {
    this.velocitySim.setSize(res, res);
    this.divergenceSim.setSize(res, res);
    this.pressureSim.setSize(res, res);
    this.subtractPressureSim.setSize(res, res);
  }

  addEvents() {
    E.on(store.events.MOUSEMOVE, this.onPointerMove);
    store.RAFCollection!.add(this.onRaf, 2);
  }

  removeEvents() {
    E.off(store.events.MOUSEMOVE, this.onPointerMove);
    store.RAFCollection!.remove(this.onRaf);
  }

  destroy() {
    this.removeEvents();
    this.velocitySim.destroy();
    this.divergenceSim.destroy();
    this.pressureSim.destroy();
    this.subtractPressureSim.destroy();
  }

  enable() {
    if (!this.enabled) {
      this.enabled = true;
      this.addEvents();
    }
  }

  disable() {
    if (this.enabled) {
      this.enabled = false;
      this.removeEvents();
    }
  }
}

export default FluidSim;
