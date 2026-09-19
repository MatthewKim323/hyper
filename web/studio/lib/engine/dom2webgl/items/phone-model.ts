/* eslint-disable @typescript-eslint/no-explicit-any */
// PhoneModel:
// phone GLB (shared load) with the child <img>/<video> as screen texture, idle + mouse sway.
import { Group, LinearFilter, MeshBasicMaterial, MeshMatcapMaterial, Texture } from "three";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { store } from "../../core/store";
import { assetUrl } from "../../core/asset-url";
import { $$ } from "../../core/component-manager";
import { WebGLItem, type WebGLItemOptions } from "../webgl-item";

const o: any = store;

// Module-level cache: the phone model is loaded once and cloned per instance.
const phoneCache: { model?: any } = {};

export class PhoneModel extends WebGLItem {
  domMedia: (HTMLImageElement | HTMLVideoElement)[];
  textures: { texture: Texture; type: string }[] = [];
  screen: any;
  ambientMovementModifier = 0;
  videoController: any;

  constructor(e: WebGLItemOptions) {
    super(e);
    this.options = e;
    this.domEl = this.options.domEl;
    this.domMedia = $$<HTMLImageElement | HTMLVideoElement>("img, video", this.domEl);
    this.loadAssets();
  }

  loadAssets() {
    if (!phoneCache.model) {
      phoneCache.model = true;
      o.AssetLoader.loadGltf(assetUrl("models/phone.glb")).then((e: any) => {
        phoneCache.model = e;
      });
    }
  }

  build() {
    this.textures = [];
    this.domMedia.forEach((e) => {
      const t: any = {};
      if (e instanceof HTMLImageElement) {
        const i = new Image();
        i.crossOrigin = "";
        t.texture = new Texture(i);
        i.addEventListener(
          "load",
          () => {
            t.texture.flipY = false;
            t.texture.needsUpdate = true;
            o.Gl.renderer.initTexture(t.texture);
          },
          { once: true },
        );
        i.src = e.src;
        t.type = "image";
      } else {
        t.texture = o.Gl.generateTexture(e, { flipY: false, minFilter: LinearFilter });
        t.type = "video";
      }
      this.textures.push(t);
    });
    this.item = new Group();
    const e = phoneCache.model.scene.clone(true);
    const t = e.getObjectByName("Body");
    this.screen = e.getObjectByName("Screen");
    t.material = new MeshMatcapMaterial({
      matcap: o.projectLightMode
        ? o.Gl.assets.textures.projectModelMatcapDark
        : o.Gl.assets.textures.projectModelMatcap,
      color: o.Project ? o.Project.backgroundColorGl : 16777215,
      opacity: 0.3,
      transparent: true,
    });
    this.screen.material = new MeshBasicMaterial({ map: this.textures[0].texture, transparent: true });
    t.renderOrder = 100;
    this.screen.renderOrder = 100;
    this.item.add(e);
    this.add(this.item);
    this.originalRotation.copy(this.item.rotation);
    this.ambientMovementModifier = 100 * Math.random();
    if ("video" === this.textures[0].type || (this.textures[1] && "video" === this.textures[1].type))
      this.videoController = ScrollTrigger.create({
        trigger: this.domEl.closest(".container"),
        onToggle: (s: any) => {
          if (this.screen.material.map.image instanceof HTMLVideoElement)
            s.isActive ? this.screen.material.map.image.play() : this.screen.material.map.image.pause();
        },
      });
  }

  syncDomSize() {
    super.syncDomSize();
    this.item.scale.setScalar(Math.min(this.widthPx / this.pixelScale.x, this.heightPx / this.pixelScale.y));
  }

  animate(e: number, t: number) {
    super.animate(e, t);
    if (this.item) {
      this.item.rotation.x += 75e-5 * Math.sin(t + this.ambientMovementModifier);
      this.item.rotation.y += 0.01 * Math.cos(t + this.ambientMovementModifier);
      this.item.children[0].rotation.x += 0.075 * (-0.05 * o.mouse.glNormalized.y - this.item.children[0].rotation.x);
      this.item.children[0].rotation.y += 0.075 * (0.1 * o.mouse.glNormalized.x - this.item.children[0].rotation.y);
      this.item.position.y += 0.1 * Math.cos(t + this.ambientMovementModifier);
    }
  }

  dispose() {
    super.dispose();
    if (this.videoController) this.videoController.kill();
  }
}

export default PhoneModel;
