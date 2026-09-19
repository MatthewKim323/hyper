/* eslint-disable @typescript-eslint/no-explicit-any */
// ProjectModel:
// header / next-project GLB with the light/dark matcap + transition blend, mouse + idle sway.
import { Color, DoubleSide, ShaderMaterial } from "three";
import { store } from "../../core/store";
import { matcapModelVert } from "../../shaders/matcap-model.vert.glsl";
import { projectModelMatcapTransitionFrag } from "../../shaders/project-model-matcap-transition.frag.glsl";
import { cloneGltf } from "../skeleton-clone";
import { WebGLItem, type WebGLItemOptions } from "../webgl-item";

const o: any = store;

export class ProjectModel extends WebGLItem {
  assets: any = {};

  onRaf = (e: number) => {
    for (let t = 0; t < this.item.children.length; t++) {
      const i = this.item.children[t];
      i.rotation.x = i.originalRotation.x + (0.1 * -o.mouse.smooth.glNormalized.y + 0.02 * Math.sin(e + i.index));
      i.rotation.y =
        i.originalRotation.y + (0.15 * o.mouse.smooth.glNormalized.x + 0.05 * Math.cos(e + i.index + 21.263));
      i.position.y = i.originalPosition.y + (5 * Math.cos(e + i.index)) / this.item.scale.x;
    }
    this.rotation.x = 0.1 * -o.mouse.smooth.glNormalized.y;
    this.rotation.y = 0.15 * o.mouse.smooth.glNormalized.x;
  };

  constructor(e: WebGLItemOptions) {
    super(e);
    this.loadAssets();
    this.domEl._glProps = { "position.y": 0 };
  }

  loadAssets() {
    this.assets = {};
    o.AssetLoader.loadGltf(this.domEl.dataset.src).then((e: any) => {
      this.assets.gltf = cloneGltf(e);
    });
  }

  build() {
    this.item = this.assets.gltf.scene;
    const e = new ShaderMaterial({
      vertexShader: matcapModelVert,
      fragmentShader: projectModelMatcapTransitionFrag,
      uniforms: {
        uMatcapLight: { value: o.Gl.assets.textures.projectModelMatcap },
        uMatcapDark: { value: o.Gl.assets.textures.projectModelMatcapDark },
        uBaseColor: { value: o.Project.backgroundColorGl },
        uNextBaseColor: { value: new Color(this.domEl.dataset.nextBgcolor ? this.domEl.dataset.nextBgcolor : 0) },
        uTransitionProgress: { value: 0 },
        fogNear: o.Gl.globalUniforms.fogNear,
        fogFar: o.Gl.globalUniforms.fogFar,
        fogColor: o.Gl.globalUniforms.fogColor,
      },
      transparent: true,
      side: DoubleSide,
      depthTest: false,
      defines: {
        LIGHTMODE: o.projectLightMode,
        TRANSITION: void 0 !== this.domEl.dataset.transition,
        TO_LIGHTMODE: "true" === this.domEl.dataset.lightMode,
      },
    });
    this.item.children.forEach((t: any, i: number) => {
      t.index = i;
      t.originalPosition = t.position.clone();
      t.originalRotation = t.rotation.clone();
      t.material = e;
    });
    this.item.renderOrder = -1;
    this.add(this.item);
    this.originalRotation.copy(this.item.rotation);
    if (this.domEl.dataset.scale) this.scale.setScalar(parseFloat(this.domEl.dataset.scale));
    o.RAFCollection.add(this.onRaf, 4);
  }

  syncDomSize() {
    super.syncDomSize();
    this.item.scale.setScalar(Math.min(this.widthPx / this.pixelScale.x, this.heightPx / this.pixelScale.y));
  }

  dispose() {
    super.dispose();
    o.RAFCollection.remove(this.onRaf);
  }
}

export default ProjectModel;
