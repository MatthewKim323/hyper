// Transition `toContact`. Mirror of toHome (cameraPathProgress 0).
import gsap from "gsap";
import { store } from "../../core/store";
import { Transition, removeView, type TransitionInArgs, type TransitionOutArgs } from "./base";

export class ToContactTransition extends Transition {
  in({ done }: TransitionInArgs) {
    done();
  }

  out({ from, done }: TransitionOutArgs) {
    const view = from.dataset.routerView;
    store.Highway.cached = store.Highway.cache.has(store.Highway.location.href);

    if (view === "homeContact") {
      gsap.to(store.HomeContact.tweenParams, { cameraPathProgress: 0, duration: 3, ease: "power4.inOut" });
      store.Audio!.play({ key: "audio.contact_swoosh" });
      store.HomeContact.showContact().then(() => {
        removeView(from);
        done();
      });
    }

    if (view === "projects") {
      store.HomeContact.transitionPass.uniforms.u_fromScene.value = store.HomeContact.savePass.renderTarget.texture;
      store.HomeContact.transitionPass.uniforms.u_toScene.value = store.ProjectMenu.savePass.renderTarget.texture;
      store.HomeContact.enable();
      store.HomeContact.isHome = false;
      store.HomeContact.tweenParams.cameraPathProgress = 0;
      gsap
        .timeline({
          defaults: { duration: 3, ease: "expo.inOut" },
          onStart: () => {
            store.HomeContact.savePass.enabled = true;
            store.HomeContact.transitionPass.enabled = true;
            store.ProjectMenu.savePass.enabled = true;
          },
          onComplete: () => {
            store.HomeContact.savePass.enabled = false;
            store.HomeContact.transitionPass.enabled = false;
            store.ProjectMenu.savePass.enabled = false;
            store.ProjectMenu.renderPass.enabled = false;
            removeView(from);
            done();
          },
        })
        .fromTo(store.HomeContact.transitionPass.uniforms.u_progress, { value: 1 }, { value: 0 }, 0)
        .fromTo(
          store.HomeContact.tweenParams,
          { cameraYOffset: (store.window.h / 2) * -5e-5 },
          { cameraYOffset: 0 },
          "<",
        )
        .to(store.ProjectMenu.tweenParams, { cameraYOffset: 2 * store.window.h }, "<")
        .to(".js-project-filters", { y: "240vh", autoAlpha: 0, duration: 3 }, "<")
        .to(".js-project-grid-cta", { y: "240vh", autoAlpha: 0, duration: 3 }, "<")
        .call(
          () => {
            store.HomeContact.showContact(true);
          },
          undefined,
          1,
        )
        .call(
          () => {
            store.Audio!.play({ key: "audio.new_water_projects", isInteraction: true });
            store.Audio!.filterTo({
              key: "audio.backing",
              duration: 1800,
              type: "lowpass",
              to: { frequency: 2e4 },
              from: { frequency: 160 },
            });
          },
          [],
          0.6,
        );
    }

    if (view === "world") {
      store.HomeContact.enable();
      store.HomeContact.isHome = false;
      store.HomeContact.tweenParams.cameraPathProgress = 0;
      store.HomeContact.savePass.enabled = true;
      store.World.transitionPass.uniforms.u_toScene.value = store.HomeContact.savePass.renderTarget.texture;
      store.Audio!.play({ key: "audio.backing", speed: 0.7, fade: { from: 0, to: 1, duration: 4 } });
      store.Audio!.lerpSpeed("audio.backing", 1, 2e3);
      gsap.fromTo(
        store.HomeContact.options,
        { cameraTranslateZ: -0.09 },
        { cameraTranslateZ: 0, duration: 2.5, ease: "power2.inOut" },
      );
      gsap.delayedCall(0.8, () => {
        document.body.classList.remove("dark");
        store.HomeContact.showContact(true);
      });
      store.World.out().then(() => {
        removeView(from);
        done();
        store.HomeContact.savePass.enabled = false;
      });
    }

    if (view === "project") {
      store.Project.transitioning = true;
      const camY = store.Project.camera.position.y;
      const fogNear = store.Gl!.scene.fog!.near;
      const fogFar = store.Gl!.scene.fog!.far;
      store.HomeContact.transitionPass.uniforms.u_fromScene.value = store.HomeContact.savePass.renderTarget.texture;
      store.HomeContact.transitionPass.uniforms.u_toScene.value = null;
      store.HomeContact.enable();
      store.HomeContact.isHome = false;
      store.HomeContact.tweenParams.cameraPathProgress = 0;
      gsap
        .timeline({
          defaults: { duration: 1.5, ease: "power4.inOut" },
          onComplete: () => {
            store.HomeContact.savePass.enabled = false;
            store.HomeContact.transitionPass.enabled = false;
            store.Project.renderPass.enabled = false;
            gsap.set(store.ASScroll.containerElement, { clearProps: "transform,opacity,visibility" });
            store.Project.camera.position.y = camY;
            store.Gl!.scene.fog!.near = fogNear;
            store.Gl!.scene.fog!.far = fogFar;
            store.Gl!.globalUniforms.fogNear.value = fogNear;
            store.Gl!.globalUniforms.fogFar.value = fogFar;
            removeView(from);
            done();
          },
        })
        .to(store.Project.camera.position, { y: "+=" + store.window.h }, 0)
        .to([store.ASScroll.containerElement, store.Project.dom.headerClone], { y: "+=" + store.window.h }, 0)
        .to([store.ASScroll.containerElement, store.Project.dom.headerClone], { autoAlpha: 0, duration: 1 }, "<")
        .to(store.Gl!.scene.fog, { near: "-=1000", far: "-=1000" }, "<")
        .to([store.Gl!.globalUniforms.fogNear, store.Gl!.globalUniforms.fogFar], { value: "-=1000" }, "<")
        .call(
          () => {
            store.HomeContact.savePass.enabled = true;
            store.HomeContact.transitionPass.enabled = true;
          },
          undefined,
          ">-0.5",
        )
        .fromTo(store.HomeContact.transitionPass.uniforms.u_progress, { value: 1 }, { value: 0, ease: "power4.out" }, "<")
        .fromTo(
          store.HomeContact.tweenParams,
          { cameraYOffset: (store.window.h / 2) * -5e-5 },
          { cameraYOffset: 0, ease: "power4.out" },
          "<",
        )
        .call(
          () => {
            store.HomeContact.showContact(true);
          },
          undefined,
          1,
        )
        .call(
          () => {
            store.Audio!.play({ key: "audio.new_water_projects", isInteraction: true });
            store.Audio!.filterTo({
              key: "audio.backing",
              duration: 1800,
              type: "lowpass",
              to: { frequency: 2e4 },
              from: { frequency: 160 },
            });
          },
          [],
          0.6,
        );
    }
  }
}

export default ToContactTransition;
