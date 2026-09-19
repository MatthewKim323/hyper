/* eslint-disable @typescript-eslint/no-explicit-any */
// Project detail controller: project render pass (idx 20) + fluid overlay (idx 21),
// header intro timeline (glyph rise, title slide), and the scroll-past-the-end next-project transition
// (wheel / drag overscroll -> transitionProgress, smoothed 0.2/frame, velocity-bent colour sweep) that
// redirects with the "projectToProject" transition.
import { Color, MathUtils } from "three";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import gsap from "gsap";
import E from "../../core/event-bus";
import { store } from "../../core/store";
import { ResourceTracker } from "../../core/dispose";
import { $ } from "../../core/component-manager";

const o: any = store;

export class Project {
  resourceTracker: ResourceTracker;
  backgroundColor: string;
  backgroundColorGl: Color;
  nextBackgroundColor: string;
  nextBackgroundColorGl: Color;
  transitioning: boolean;
  params: {
    scrollPos: number;
    dragPos: number;
    transitionProgress: number;
    footerContentTweenProgress: number;
    smoothTransitionProgress: number;
  };
  transitionDelta: number;
  smoothTransitionDelta: number;
  velocity: number;
  dom: Record<string, any>;
  scene: any;
  camera: any;
  prevRenderPass: any;
  renderPass: any;
  nextTitlePos = 0;
  transitionTimeline: any;
  footerContentTween: any;
  introTimeline: any;
  transitionTimeout: any;

  currentModel: any;
  nextModel: any;
  transitionPlane: any;
  keepScrolling: any;
  footerNext: any;
  scrollProgress: any;
  projectsText: any;
  description1: any;
  description2: any;
  currentTitle: any;
  nextTitle: any;

  onRaf = (_e: number) => {
    if (this.transitioning) return;
    this.params.smoothTransitionProgress +=
      0.2 * (this.params.transitionProgress - this.params.smoothTransitionProgress);
    if (this.transitionTimeline) this.transitionTimeline.progress(this.params.smoothTransitionProgress);
    this.transitionDelta = this.params.transitionProgress - this.params.smoothTransitionProgress;
    this.velocity += 0.1 * (this.transitionDelta - this.velocity);
    this.velocity = MathUtils.clamp(this.velocity, -0.1, 2);
    this.transitionPlane.item.material.uniforms.u_velo.value = this.velocity;
    this.keepScrolling.item.material.uniforms.u_velo.value = this.velocity;
    this.footerNext.item.material.uniforms.u_velo.value = this.velocity;
    this.nextTitle.item.material.uniforms.u_velo.value = this.velocity;
    this.scrollProgress.item.material.uniforms.u_velo.value = this.velocity;
  };

  onScroll = (e: WheelEvent) => {
    if (this.transitioning) return;
    if (o.ASScroll.currentPos < o.ASScroll.maxScroll - 10) {
      this.params.scrollPos = this.params.dragPos = this.params.transitionProgress = 0;
      return;
    }
    this.setTransitionTimeout();
    this.params.scrollPos += e.deltaY;
    const t = 2 * o.window.h;
    this.params.transitionProgress = (this.params.scrollPos - 0) / (t - 0);
  };

  onDrag = ({ oy: e, py: t, y: i }: any) => {
    if (this.transitioning) return;
    if (Math.abs(e - i) < 2) return;
    if (o.ASScroll.currentPos + o.window.h < o.ASScroll.maxScroll + o.window.h - 1) {
      this.params.dragPos = this.params.transitionProgress = 0;
      return;
    }
    this.setTransitionTimeout();
    this.params.dragPos += t - i;
    this.params.transitionProgress = (this.params.dragPos - 0) / 400;
  };

  onResize = () => {
    const { y: e, height: t } = this.dom.nextTitlePosition.getBoundingClientRect();
    this.nextTitlePos = -(e + o.ASScroll.currentPos - o.window.fullHeight / 2 + t / 2);
  };

  constructor() {
    this.resourceTracker = new ResourceTracker();
    this.backgroundColor = ($("[data-bgcolor]") as HTMLElement).dataset.bgcolor as string;
    this.backgroundColorGl = new Color(this.backgroundColor);
    this.nextBackgroundColor = ($("[data-next-bgcolor]") as HTMLElement).dataset.nextBgcolor as string;
    this.nextBackgroundColorGl = new Color(this.nextBackgroundColor);
    this.transitioning = false;
    this.params = {
      scrollPos: 0,
      dragPos: 0,
      transitionProgress: 0,
      footerContentTweenProgress: 0,
      smoothTransitionProgress: 0,
    };
    this.transitionDelta = 0;
    this.smoothTransitionDelta = 0;
    this.velocity = 0;
    this.dom = {
      currentModel: $(".js-current-model"),
      nextModel: $(".js-next-model"),
      projectsText: $(".js-projects-text"),
      description1: $(".js-description1"),
      description2: $(".js-description2"),
      currentTitle: $(".js-current-title"),
      nextTitle: $(".js-next-title"),
      nextTitlePosition: $(".js-next-title-position"),
      footerNext: $(".js-footer-next"),
      keepScrolling: $(".js-keep-scrolling"),
      scrollProgress: $(".js-scroll-progress"),
      transitionPlane: $(".js-transition-plane"),
    };
    this.setup();
  }

  setup() {
    this.scene = o.Gl.scene;
    this.camera = o.Gl.camera;
    this.camera.position.y = 0;
    document.body.style.backgroundColor = this.backgroundColor;
    this.scene.fog.color.set(this.backgroundColorGl);
    if (o.projectToProjectTransition) this.prevRenderPass = o.Project.renderPass;
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.renderPass.name = "Project";
    this.renderPass.clearColor = o.World.backgroundColorGl;
    if (!o.Highway.From.isTransitioningToProject) {
      this.resume();
      gsap.killTweensOf(o.Gl.screenFxPass.uniforms.u_noiseOnly);
      o.Gl.screenFxPass.uniforms.u_noiseOnly.value = 1;
    }
  }

  resume() {
    o.Gl.composerPasses.add(this.renderPass, 20);
    if (!o.isTouch) {
      if (!o.projectToProjectTransition) o.Gl.composerPasses.add(o.Gl.fluidPass, 21);
      o.Gl.fluidSim.enable();
    }
    if (o.Gl.fxaaPass) o.Gl.fxaaPass.enabled = false; // core Gl omits the dead FXAA pass
    // prevRenderPass is only captured when setup() ran mid project-to-project; a stale flag must not throw here.
    if (o.projectToProjectTransition && this.prevRenderPass) {
      this.prevRenderPass.enabled = false;
      o.Gl.composerPasses.remove(this.prevRenderPass);
    }
  }

  build() {
    this.currentModel = this.dom.currentModel._webGLItem;
    this.nextModel = this.dom.nextModel._webGLItem;
    this.transitionPlane = this.dom.transitionPlane._webGLItem;
    this.keepScrolling = this.dom.keepScrolling._webGLItem;
    this.footerNext = this.dom.footerNext._webGLItem;
    this.scrollProgress = this.dom.scrollProgress._webGLItem;
    this.projectsText = this.dom.projectsText._webGLItem;
    this.description1 = this.dom.description1._webGLItem;
    this.description2 = this.dom.description2._webGLItem;
    this.currentTitle = this.dom.currentTitle._webGLItem;
    this.nextTitle = this.dom.nextTitle._webGLItem;
    this.dom.nextTitlePosition.innerHTML = this.dom.nextTitle.innerHTML;
    this.onResize();
    o.Gl.globalUniforms.fogNear.value = this.scene.fog.near;
    o.Gl.globalUniforms.fogFar.value = this.scene.fog.far;
    o.Gl.globalUniforms.fogColor.value.copy(this.scene.fog.color);
    o.Gl.fluidPass.uniforms.uOpacity.value = 0;
    this.buildIntro();
    this.addEvents();
    o.Gl.renderer.compile(this.scene, this.camera);
    if (!o.Highway.From.isTransitioningToProject) this.introTimeline.play();
  }

  buildIntro() {
    this.projectsText.addToGlyphPositions({ minY: -this.projectsText.fontSize, maxY: -this.projectsText.fontSize });
    this.projectsText.copyGlyphPositions();
    this.description1.addToGlyphPositions({ minY: -this.description1.fontSize, maxY: -this.description1.fontSize });
    this.description1.copyGlyphPositions();
    this.description2.addToGlyphPositions({ minY: -this.description2.fontSize, maxY: -this.description2.fontSize });
    this.description2.copyGlyphPositions();
    this.introTimeline = gsap
      .timeline({
        paused: true,
        delay: 0.1,
        defaults: { ease: "expo.inOut" },
        onStart: () => {
          this.buildTransition();
        },
      })
      .to("main", { autoAlpha: 1, duration: 0.5 }, 0)
      .to(o.Gl.fluidPass.uniforms.uOpacity, { value: 0.03, duration: 1 }, 0)
      .to(
        this.projectsText.glyphPositions,
        {
          minY: `+=${this.projectsText.fontSize}`,
          maxY: `+=${this.projectsText.fontSize}`,
          duration: 0.9,
          stagger: 0.03,
          onUpdate: () => {
            this.projectsText.updateGlyphPositions();
          },
        },
        "<0.25",
      )
      .to(
        this.description1.glyphPositions,
        {
          minY: `+=${this.description1.fontSize}`,
          maxY: `+=${this.description1.fontSize}`,
          duration: 0.9,
          stagger: 0.03,
          onUpdate: () => {
            this.description1.updateGlyphPositions();
          },
        },
        "<",
      )
      .to(
        this.description2.glyphPositions,
        {
          minY: `+=${this.description2.fontSize}`,
          maxY: `+=${this.description2.fontSize}`,
          duration: 0.9,
          stagger: 0.03,
          onUpdate: () => {
            this.description2.updateGlyphPositions();
          },
        },
        "<",
      );
    if (o.mq.sm.matches) {
      const e =
        this.dom.currentTitle.getBoundingClientRect().left -
        this.dom.currentTitle.parentElement.getBoundingClientRect().left;
      this.introTimeline.to(this.dom.currentTitle, { x: -e, glProps: { "position.x": -e }, duration: 1.3 } as any, 0);
    }
  }

  buildFooterContentTween() {
    const e = this.nextTitlePos - (this.nextTitle.originalPosition.y + o.ASScroll.maxScroll);
    const t = this.currentModel.originalPosition.y;
    this.footerContentTween = gsap
      .timeline({ paused: true, defaults: { ease: "power4.out", duration: 1 } })
      .to(
        this.footerNext.glyphPositions,
        {
          minY: "+=" + 1.1 * this.footerNext.fontSize,
          maxY: "+=" + 1.1 * this.footerNext.fontSize,
          duration: 0.25,
          onUpdate: () => {
            this.footerNext.updateGlyphPositions();
          },
        },
        0,
      )
      .to(this.dom.nextTitle, { y: e, glProps: { "position.y": -e } } as any, 0)
      .to(this.dom.nextModel, { y: t, glProps: { "position.y": -t } } as any, 0);
  }

  buildTransition() {
    this.transitionTimeline = gsap
      .timeline({
        paused: true,
        defaults: { duration: 1, ease: "sine.out" },
        onStart: () => {
          this.buildFooterContentTween();
        },
        onUpdate: () => {
          this.footerContentTween.progress(this.params.footerContentTweenProgress);
        },
        onComplete: () => {
          this.transitioning = true;
          clearTimeout(this.transitionTimeout);
          o.projectToProjectTransition = true;
          o.ASScroll.currentPos = o.ASScroll.maxScroll;
          o.Highway.redirect(($("[data-next-link]") as HTMLElement).dataset.nextLink, "projectToProject");
        },
      })
      .to(
        [
          this.transitionPlane.item.material.uniforms.u_progress,
          this.keepScrolling.item.material.uniforms.u_progress,
          this.footerNext.item.material.uniforms.u_progress,
          this.nextTitle.item.material.uniforms.u_progress,
          this.nextModel.item.children[0].material.uniforms.uTransitionProgress,
          this.scrollProgress.item.material.uniforms.u_progress,
        ],
        { value: 0.5 },
        0,
      )
      .to(
        [
          this.transitionPlane.item.material.uniforms.u_adjust,
          this.keepScrolling.item.material.uniforms.u_adjust,
          this.footerNext.item.material.uniforms.u_adjust,
          this.nextTitle.item.material.uniforms.u_adjust,
          this.scrollProgress.item.material.uniforms.u_adjust,
        ],
        { value: 0.9, ease: "power4.out" },
        0,
      )
      .to(this.scrollProgress.scale, { x: 1 }, 0)
      .to(this.params, { footerContentTweenProgress: 0.2 }, 0);
  }

  setTransitionTimeout() {
    gsap.killTweensOf(this.params, "scrollPos,dragPos,transitionProgress");
    clearTimeout(this.transitionTimeout);
    this.transitionTimeout = setTimeout(() => {
      gsap.to(this.params, { scrollPos: 0, dragPos: 0, transitionProgress: 0, duration: 1, ease: "power2.in" });
    }, 75);
  }

  addEvents() {
    E.on("wheel", window, this.onScroll);
    E.on(o.events.MOUSEDRAG, this.onDrag);
    o.RAFCollection.add(this.onRaf, 3);
  }

  destroy() {
    E.off("wheel", window, this.onScroll);
    E.off(o.events.MOUSEDRAG, this.onDrag);
    o.RAFCollection.remove(this.onRaf);
    this.resourceTracker.dispose();
    if (!o.projectToProjectTransition) {
      this.renderPass.enabled = false;
      o.Gl.composerPasses.remove(this.renderPass);
      if (!o.isTouch) {
        o.Gl.composerPasses.remove(o.Gl.fluidPass);
        o.Gl.fluidSim.disable();
      }
    }
    if (o.Gl.fxaaPass) o.Gl.fxaaPass.enabled = true;
  }
}

export default Project;
