/* eslint-disable @typescript-eslint/no-explicit-any */
// Awards: award trophy GLBs cycling every 2.5 s
// (3 s after hover ends), list items slide 1.25rem with the arrow on the active award.
import { Box3, DoubleSide, Group, MathUtils, ShaderMaterial, Vector2, Vector3 } from "three";
import gsap from "gsap";
import E from "../../core/event-bus";
import { store } from "../../core/store";
import { assetUrl } from "../../core/asset-url";
import { $$ } from "../../core/component-manager";
import { matcapModelVert } from "../../shaders/matcap-model.vert.glsl";
import { projectAwardsMatcapFrag } from "../../shaders/project-awards-matcap.frag.glsl";
import { cloneGltf } from "../skeleton-clone";
import { WebGLItem, type WebGLItemOptions } from "../webgl-item";

const o: any = store;

const AWARD_MODELS = ["awwwards", "css", "euro", "fwa", "lovie", "webby"];

export class Awards extends WebGLItem {
  dom: { list: HTMLElement[] };
  hovering: boolean;
  activeId: number;
  activeModel: any;
  activeDomEl: any;
  assets: any = {};
  models: Record<string, any> = {};
  mouseLeaveTimeout: any;
  cycleInterval: any;

  onRaf = (e: number) => {
    this.rotation.x = 0.1 * -o.mouse.smooth.glNormalized.y + 0.02 * Math.sin(e);
    this.rotation.y = 0.15 * o.mouse.smooth.glNormalized.x + 0.05 * Math.cos(e + 21.263);
    this.item.position.y = 5 * Math.cos(e);
  };

  updateState = (e: any) => {
    let t: any;
    clearTimeout(this.mouseLeaveTimeout);
    if (e instanceof HTMLElement) t = e;
    else {
      clearInterval(this.cycleInterval);
      this.hovering = true;
      t = e.target;
    }
    if (this.activeModel !== this.models[t.dataset.awardModel]) {
      if (this.activeModel) this.hideModel(this.activeModel);
      this.activeModel = this.models[t.dataset.awardModel];
      this.activeId = this.dom.list.indexOf(t);
      this.showModel(this.activeModel);
    }
    if (this.activeDomEl) this.unsetListHoverState();
    this.activeDomEl = t.querySelector(".js-award-inner");
    this.setListHoverState();
  };

  onMouseLeave = () => {
    this.mouseLeaveTimeout = setTimeout(() => {
      this.hovering = false;
      this.cycleInterval = setInterval(() => {
        this.cycle();
      }, 3e3);
    }, 1e3);
  };

  constructor(e: WebGLItemOptions) {
    super(e);
    this.dom = { list: $$(".js-awards .js-award") };
    this.hovering = false;
    this.activeId = -1;
    this.activeModel = false;
    this.activeDomEl = false;
    this.loadAssets();
  }

  loadAssets() {
    this.assets = { models: {} };
    const e: string[] = [];
    this.dom.list.forEach((t) => {
      if ("generic" === t.dataset.awardModel && e.indexOf("generic") < 0) e.push("generic");
      else if (!(AWARD_MODELS.indexOf(t.dataset.awardModel as string) < 0)) e.push(t.dataset.awardModel as string);
    });
    e.forEach((k) => {
      o.AssetLoader.loadGltf(assetUrl(`models/awards/${k}.glb`)).then((t: any) => {
        this.assets.models[k] = cloneGltf(t);
      });
    });
  }

  build() {
    this.item = new Group();
    this.models = {};
    for (const e in this.assets.models) {
      this.item.add(this.assets.models[e].scene);
      this.models[e] = this.assets.models[e].scene;
    }
    const e = new ShaderMaterial({
      vertexShader: matcapModelVert,
      fragmentShader: projectAwardsMatcapFrag,
      uniforms: {
        uMatcap: {
          value: o.projectLightMode
            ? o.Gl.assets.textures.projectModelMatcapDark
            : o.Gl.assets.textures.projectModelMatcap,
        },
        uBaseColor: { value: o.Project.backgroundColorGl },
        uOpacity: { value: 0.3 },
        fogNear: o.Gl.globalUniforms.fogNear,
        fogFar: o.Gl.globalUniforms.fogFar,
        fogColor: o.Gl.globalUniforms.fogColor,
      },
      transparent: true,
      side: DoubleSide,
      depthTest: false,
      defines: { LIGHTMODE: o.projectLightMode },
    });
    this.item.children.forEach((t: any) => {
      t.bbox = new Box3();
      t.pixelScale = new Vector2();
      t.originalScale = new Vector3();
      t.children[0].material = e.clone();
      t.children[0].material.uniforms.fogNear = o.Gl.globalUniforms.fogNear;
      t.children[0].material.uniforms.fogFar = o.Gl.globalUniforms.fogFar;
      t.children[0].material.uniforms.fogColor = o.Gl.globalUniforms.fogColor;
      t.children[0].material.uniforms.uMatcap.value.needsUpdate = true;
      t.visible = false;
    });
    this.item.rotation.set(-0.1, 0, 0.3);
    this.add(this.item);
    this.cycleInterval = setInterval(() => {
      this.cycle();
    }, 2500);
    o.RAFCollection.add(this.onRaf, 4);
    E.on("mouseenter", this.dom.list, this.updateState);
    E.on("mouseleave", this.dom.list, this.onMouseLeave);
  }

  cycle() {
    if (this.hovering) return;
    this.activeId++;
    if (this.activeId > this.dom.list.length - 1) this.activeId = 0;
    this.updateState(this.dom.list[this.activeId]);
  }

  showModel(e: any) {
    if (!e) return;
    if (e.visibilityTween) e.visibilityTween.kill();
    e.visible = true;
    e.visibilityTween = gsap
      .timeline({ defaults: { duration: 1, ease: "expo.out" } })
      .fromTo(
        e.scale,
        { x: 0.5 * e.originalScale.x, y: 0.5 * e.originalScale.y, z: 0.5 * e.originalScale.z },
        { x: e.originalScale.x, y: e.originalScale.y, z: e.originalScale.z },
        0,
      )
      .fromTo(e.children[0].material.uniforms.uOpacity, { value: 0 }, { value: 0.3 }, 0)
      .fromTo(
        e.rotation,
        { y: MathUtils.degToRad(180), x: MathUtils.degToRad(-45) },
        { y: MathUtils.degToRad(360), x: MathUtils.degToRad(0) },
        0,
      );
  }

  hideModel(e: any) {
    if (e.visibilityTween) e.visibilityTween.kill();
    e.visibilityTween = gsap
      .timeline({
        defaults: { duration: 0.5, ease: "expo.out" },
        onComplete: () => {
          e.visible = false;
        },
      })
      .to(e.scale, { x: 0.5 * e.originalScale.x, y: 0.5 * e.originalScale.y, z: 0.5 * e.originalScale.z }, 0)
      .to(e.children[0].material.uniforms.uOpacity, { value: 0 }, 0);
  }

  setListHoverState() {
    gsap
      .timeline({ defaults: { duration: 1, ease: "expo.out" } })
      .to(this.activeDomEl, { x: "1.25rem" }, 0)
      .to(this.activeDomEl.querySelector(".js-award-arrow span"), { x: "0%" }, 0);
  }

  unsetListHoverState() {
    gsap
      .timeline({ defaults: { duration: 1, ease: "expo.out" } })
      .to(this.activeDomEl, { x: "0rem" }, 0)
      .to(this.activeDomEl.querySelector(".js-award-arrow span"), { x: "100%" }, 0);
  }

  calcPixelScale() {
    this.item.children.forEach((e: any) => {
      e.bbox.setFromObject(e);
      e.pixelScale.set(-e.bbox.min.x + e.bbox.max.x, -e.bbox.min.y + e.bbox.max.y);
    });
  }

  syncDomSize() {
    this.widthPx = this.domEl.clientWidth;
    this.heightPx = this.domEl.clientHeight;
    this.item.children.forEach((e: any) => {
      e.scale.setScalar(Math.min(this.widthPx / e.pixelScale.x, this.heightPx / e.pixelScale.y));
      e.originalScale.copy(e.scale);
    });
  }

  dispose() {
    super.dispose();
    this.models = {};
    this.assets = {};
    clearInterval(this.cycleInterval);
    o.RAFCollection.remove(this.onRaf);
    E.off("mouseenter", this.dom.list, this.updateState);
    E.off("mouseleave", this.dom.list, this.onMouseLeave);
  }
}

export default Awards;
