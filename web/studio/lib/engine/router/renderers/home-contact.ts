/* eslint-disable @typescript-eslint/no-explicit-any */
// Renderer `homeContact`. Serves "/" and "/contact/".
import gsap from "gsap";
import { store } from "../../core/store";
import { BaseRenderer } from "./base";

export class HomeContactRenderer extends BaseRenderer {
  renderCss = false;

  onFirstLoad() {
    super.onFirstLoad();
    (store.AssetLoader!.loaded as Promise<void>).then(() => {
      store.PageLoader.hiddenPromise.then(() => {
        // Let the reveal actually play on first load. progress(1) jumped the timeline to
        // its end, so the enter button popped in fully formed while the loader was still
        // clearing; showHome's own GSAP tween now eases it in after the wipe.
        store.HomeContact.isHome
          ? store.HomeContact.showHome()
          : store.HomeContact.showContact().pause().progress(1);
        gsap.fromTo(
          store.HomeContact.options,
          { cameraTranslateZ: 0.05 },
          { cameraTranslateZ: 0, duration: 2, ease: "power4.out" },
        );
        if (!store.urlParams.has("homedemo"))
          gsap.to(store.HomeContact.homeTextMesh.material.uniforms.uProgress, {
            value: 1,
            duration: 4,
            ease: "power4.out",
            onStart: () => {
              store.HomeContact.textFluidSim.tweenMousePos({ x: 0, y: 1 }, { x: 1, y: 0 }, 4, "power4.out");
            },
          });
        if (store.urlParams.has("homedemo")) {
          gsap.to(store.HomeContact.tweenParams, {
            cameraPathProgress: 1,
            duration: 3,
            ease: "power4.inOut",
            delay: 5,
          });
          // The third argument carries the timeline position value.
          (gsap.to as any)(
            store.HomeContact.homeTextMesh.material.uniforms.uOpacity,
            { value: 1, duration: 1, ease: "power2.out" },
            6.6,
          );
          gsap.to(store.HomeContact.homeTextMesh.material.uniforms.uProgress, {
            value: 1,
            duration: 4,
            ease: "power4.out",
            onStart: () => {
              store.HomeContact.textFluidSim.tweenMousePos({ x: 0, y: 1 }, { x: 1, y: 0 }, 4, "power4.out");
            },
            delay: 6.6,
          });
          gsap.fromTo(
            store.HomeContact.dom.viewProjectsBtn,
            { autoAlpha: 0 },
            {
              autoAlpha: 1,
              ease: "power2.out",
              onComplete: () => {
                this.renderCss = true;
              },
              delay: 7.3,
            },
          );
        }
      });
    });
  }

  onEnter() {
    store.HomeContact.firstLoad = store.Highway.firstLoad;
    store.PageLoader.hiddenPromise.then(() => {
      if (!store.Audio!.isPlaying("audio.backing"))
        store.Audio!.play({ key: "audio.backing", fade: { from: 0, to: 1, duration: 1 } });
    });
    super.onEnter();
    (store.AssetLoader!.loaded as Promise<void>).then(() => {
      if (
        store.Highway.From.properties.slug === "homeContact" &&
        store.Highway.To &&
        store.Highway.To.properties.slug === "homeContact"
      )
        return;
      gsap.to(store.Gl!.cssRenderer.domElement, { autoAlpha: 1, duration: 0.5, ease: "power2.out" });
      if (store.Highway.From.properties.slug === "notFound") {
        store.HomeContact.enable();
        if (store.Highway.location.pathname === "/") {
          store.HomeContact.isHome = true;
          store.HomeContact.tweenParams.cameraPathProgress = 1;
          store.HomeContact.showHome(true);
        } else {
          store.HomeContact.isHome = false;
          store.HomeContact.tweenParams.cameraPathProgress = 0;
          store.HomeContact.showContact(true);
        }
      }
    });
  }

  onLeave() {
    super.onLeave();
    if (!(store.Highway.location.pathname.includes("contact") || store.Highway.location.pathname.match(/^\/$/) !== null))
      gsap.to(store.Gl!.cssRenderer.domElement, { autoAlpha: 0, duration: 1, ease: "power2.out" });
  }

  onLeaveCompleted() {
    super.onLeaveCompleted();
    if (!(store.Highway.location.pathname.includes("contact") || store.Highway.location.pathname.match(/^\/$/) !== null)) {
      store.HomeContact.hideUI();
      store.HomeContact.destroy();
    }
  }
}

export default HomeContactRenderer;
