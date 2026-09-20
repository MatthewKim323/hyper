// Transition `toProjectMenu`.
import gsap from "gsap";
import { store } from "../../core/store";
import { Transition, removeView, type TransitionInArgs, type TransitionOutArgs } from "./base";
import { captureWorldStill, worldShown } from "@/lib/onboarding/world-still";

export class ToProjectMenuTransition extends Transition {
  fromProject?: boolean;
  usingLoader?: boolean;

  in({ done }: TransitionInArgs) {
    if (this.fromProject) store.isTouch || store.Gl!.fluidSim.enable();
    if (this.usingLoader)
      (store.AssetLoader!.loaded as Promise<void>).then(() => {
        store.PageLoader.hide(1).then(() => {
          done();
        });
      });
    else done();
  }

  out({ from, done }: TransitionOutArgs) {
    const view = from.dataset.routerView;
    store.Highway.cached = store.Highway.cache.has(store.Highway.location.href);
    this.fromProject = false;
    this.usingLoader = false;

    if (view === "homeContact") {
      // Onboarding done: the destination is the world, so blend straight into a still of it and hold
      // that image until the live world is up. The gallery room is only onboarding's backdrop.
      const world = captureWorldStill();
      const passes = store.HomeContact;
      passes.transitionPass.uniforms.u_fromScene.value = passes.savePass.renderTarget.texture;
      passes.transitionPass.uniforms.u_toScene.value = world ?? store.ProjectMenu.savePass.renderTarget.texture;
      store.ProjectMenu.hasAnimatedIn = true;
      store.ProjectMenu.allowControl = false;
      store.Gl!.globalUniforms.fogColor.value.copy(store.ProjectMenu.scene.fog.color);
      store.Gl!.globalUniforms.fogNear.value = store.ProjectMenu.scene.fog.near;
      store.Gl!.globalUniforms.fogFar.value = store.ProjectMenu.scene.fog.far;
      store.isTouch || store.Gl!.fluidSim.enable();
      store.ProjectMenu.addEvents();
      const release = () => {
        passes.savePass.enabled = false;
        passes.transitionPass.enabled = false;
        store.ProjectMenu.savePass.enabled = false;
        if (world) {
          passes.transitionPass.uniforms.u_toScene.value = store.ProjectMenu.savePass.renderTarget.texture;
          world.dispose();
        }
      };
      const timeline = gsap
        .timeline({
          defaults: { duration: 3, ease: "power4.inOut" },
          onStart: () => {
            passes.savePass.enabled = true;
            passes.transitionPass.enabled = true;
            store.ProjectMenu.renderPass.enabled = true;
            store.ProjectMenu.savePass.enabled = !world;
            store.ProjectMenu.addPreSceneEvents();
          },
          onComplete: () => {
            if (world) void worldShown().then(release);
            else release();
            store.ProjectMenu.allowControl = true;
            removeView(from);
            done();
          },
        })
        .fromTo(passes.transitionPass.uniforms.u_progress, { value: 0 }, { value: 1 }, 0)
        .fromTo(
          passes.tweenParams,
          { cameraYOffset: 0 },
          { cameraYOffset: (store.window.h / 2) * -5e-5 },
          "<",
        )
        .fromTo(store.ProjectMenu.tweenParams, { cameraYOffset: 2 * store.window.h }, { cameraYOffset: 0 }, "<");
      if (!world) timeline.fromTo(".js-project-filters", { y: "200vh", autoAlpha: 0 }, { y: 0, autoAlpha: 1 }, "<");
      timeline.call(
          () => {
            store.Audio!.play({ key: "audio.new_water_projects", isInteraction: true });
            store.Audio!.filterTo({
              key: "audio.backing",
              duration: 1800,
              type: "lowpass",
              from: { frequency: 14e3 },
              to: { frequency: 160 },
            });
          },
          [],
          0.6,
        );
    }

    if (view === "world") {
      store.ProjectMenu.renderPass.enabled = true;
      store.ProjectMenu.addPreSceneEvents();
      store.ProjectMenu.hasAnimatedIn = true;
      store.ProjectMenu.allowControl = false;
      store.Gl!.globalUniforms.fogColor.value.copy(store.ProjectMenu.scene.fog.color);
      store.Gl!.globalUniforms.fogNear.value = store.ProjectMenu.scene.fog.near;
      store.Gl!.globalUniforms.fogFar.value = store.ProjectMenu.scene.fog.far;
      store.isTouch || store.Gl!.fluidSim.enable();
      store.ProjectMenu.addEvents();
      store.ProjectMenu.savePass.enabled = true;
      store.World.transitionPass.uniforms.u_toScene.value = store.ProjectMenu.savePass.renderTarget.texture;
      gsap.fromTo(
        store.ProjectMenu.tweenParams,
        { cameraZOffset: -1e3 },
        { cameraZOffset: 0, duration: 2.5, ease: "power2.inOut" },
      );
      store.World.out().then(() => {
        removeView(from);
        if (!store.Audio!.isPlaying("audio.backing")) {
          store.Audio!.play({ key: "audio.backing", fade: { from: 0, to: 1, duration: 1 } });
          store.Audio!.filterTo({
            key: "audio.backing",
            duration: 1,
            type: "lowpass",
            from: { frequency: 14e3 },
            to: { frequency: 160 },
          });
        }
        done();
        store.ProjectMenu.savePass.enabled = false;
        store.ProjectMenu.allowControl = true;
      });
    }

    if (view === "project") {
      this.fromProject = true;
      store.ProjectMenu.hasAnimatedIn = true;
      store.ProjectMenu.renderPass.enabled = true;
      store.ProjectMenu.savePass.enabled = true;
      store.ProjectMenu.transitionPass.enabled = true;
      store.ProjectMenu.addPreSceneEvents();
      store.ProjectMenu.allowControl = false;
      store.ProjectMenu.transitionPass.uniforms.u_bgColor.value.copy(store.Project.backgroundColorGl);
      store.Project.transitioning = true;
      store.ProjectMenu.addEvents();
      const camX = store.Project.camera.position.x;
      gsap
        .timeline({
          defaults: { duration: 1.5, ease: "power4.inOut" },
          onComplete: () => {
            gsap.set(store.ASScroll.containerElement, { clearProps: "transform,opacity,visibility" });
            store.Project.camera.position.x = camX;
            store.ProjectMenu.allowControl = true;
            store.ProjectMenu.transitionPass.enabled = false;
            removeView(from);
            done();
          },
        })
        .to(store.Project.camera.position, { x: 0.25 * -store.window.w }, 0)
        .to([store.ASScroll.containerElement, store.Project.dom.headerClone], { x: 0.25 * store.window.w }, "<")
        .to(store.Gl!.fluidPass.uniforms.uOpacity, { value: 0, duration: 0.5, ease: "power2.out" }, "<")
        .to([store.ASScroll.containerElement, store.Project.dom.headerClone], { autoAlpha: 0, duration: 1 }, "<0.17")
        .to(store.Project.scene.fog, { near: "-=1000", far: "-=1000", duration: 1 }, "<")
        .to(store.Gl!.globalUniforms.fogNear, { value: "-=1000", duration: 1 }, "<")
        .to(store.Gl!.globalUniforms.fogFar, { value: "-=1000", duration: 1 }, "<")
        .call(
          () => {
            store.Project.renderPass.enabled = false;
            store.Gl!.globalUniforms.fogColor.value.copy(store.ProjectMenu.scene.fog.color);
            store.Gl!.globalUniforms.fogNear.value = store.ProjectMenu.scene.fog.near;
            store.Gl!.globalUniforms.fogFar.value = store.ProjectMenu.scene.fog.far;
          },
          undefined,
          ">",
        )
        .fromTo(store.ProjectMenu.tweenParams, { cameraXOffset: 1400 }, { cameraXOffset: 0, duration: 2 }, ">-0.05")
        .fromTo(".js-project-filters", { x: "-100vw", autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 2 }, "<")
        .fromTo(store.ProjectMenu.transitionPass.uniforms.u_progress, { value: 1 }, { value: 0, duration: 1.7 }, "<");
    }
  }
}

export default ToProjectMenuTransition;
