// Projects renderer: route /projects/, data-router-view="projects".
import gsap from "gsap";
import { store as storeRaw } from "../../core/store";
import { BaseRenderer } from "./base";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store: any = storeRaw;

export class ProjectsRenderer extends BaseRenderer {
  // set by the toProject transition while the menu hands over to a project page
  isTransitioningToProject = false;

  onEnter() {
    delete document.body.dataset.workspaceReady;
    window.dispatchEvent(new Event("hyper:workspace-ready"));
    this.page = this.wrap.lastElementChild;
    super.loadScripts();
    store.ProjectMenu.firstLoad = store.Highway.firstLoad;
    super.onEnter({ loadScripts: false });
    store.AssetLoader.loaded.then(() => {
      store.ProjectMenu.build(store.Highway.firstLoad);
      if (store.Highway.firstLoad) {
        store.PageLoader.hiddenPromise.then(() => {
          store.ProjectMenu.in();
          store.ProjectMenu.allowControl = document.documentElement.dataset.onboarding === "complete";
          store.ProjectMenu.addInteractionEvents();
          if (!store.Audio.isPlaying("audio.backing")) {
            store.Audio.play({ key: "audio.backing", fade: { from: 0, to: 1, duration: 1 } });
            store.Audio.filterTo({
              key: "audio.backing",
              duration: 1,
              type: "lowpass",
              from: { frequency: 14e3 },
              to: { frequency: 160 },
            });
          }
        });
      } else if (!store.Audio.isPlaying("audio.backing")) {
        store.Audio.play({ key: "audio.backing", fade: { from: 0, to: 1, duration: 1 } });
        setTimeout(() => {
          store.Audio.filterTo({
            key: "audio.backing",
            duration: 1,
            type: "lowpass",
            from: { frequency: 14e3 },
            to: { frequency: 160 },
          });
        }, 0);
      }
      gsap.to(".js-project-filters", { autoAlpha: 1, delay: 0.1 });
      if ("notFound" === store.Highway.From?.properties?.slug) {
        store.ProjectMenu.enable();
        store.ProjectMenu.addEvents();
      }
      if (store.urlParams.has("experiments")) {
        (document.querySelector('.js-project-filters\\:filterBtn[data-filter="experiment"]') as HTMLElement | null)?.click();
      }
    });
  }

  onEnterCompleted() {
    super.onEnterCompleted();
    document.body.dataset.workspaceReady = "true";
    window.dispatchEvent(new Event("hyper:workspace-ready"));
  }

  onLeave() {
    delete document.body.dataset.workspaceReady;
    window.dispatchEvent(new Event("hyper:workspace-ready"));
    super.onLeave();
  }

  onLeaveCompleted() {
    super.onLeaveCompleted();
    this.isTransitioningToProject || store.ProjectMenu.destroy();
  }
}

export default ProjectsRenderer;
