/* eslint-disable @typescript-eslint/no-explicit-any */
// Image plane + WebGLImage: dom2webgl <img>/<video>.
// Effects drive u_progress (peel/bend), u_innerY/u_innerScale (parallax), u_edgeFade.
import { Color, LinearFilter, Mesh, PlaneGeometry, ShaderMaterial, Texture, VideoTexture } from "three";
import { store } from "../core/store";
import { domImagePeelBendVert } from "../shaders/dom-image-peel-bend.vert.glsl";
import { domImageEdgeRgbshiftFogFrag } from "../shaders/dom-image-edge-rgbshift-fog.frag.glsl";
import { WebGLItem } from "./webgl-item";

const o: any = store;

let imageGeometry: PlaneGeometry | null = null;
let imageMaterial: ShaderMaterial | null = null;

function shared() {
  if (!imageGeometry) imageGeometry = new PlaneGeometry(1, 1, 4, 20);
  if (!imageMaterial)
    imageMaterial = new ShaderMaterial({
      uniforms: {
        u_texture: { value: null },
        u_texture2: { value: null },
        u_opacity: { value: 1 },
        u_innerScale: { value: 1 },
        u_innerY: { value: 0 },
        u_innerX: { value: 0 },
        u_screenCenterTexture: { value: 0 },
        u_edgeFade: { value: 1 },
        u_progress: { value: 0 },
        u_enableBend: { value: false },
        u_time: { value: 0 },
        u_size: { value: [1, 1] },
        fogNear: { value: 0 },
        fogFar: { value: 0 },
        fogColor: { value: new Color() },
      },
      vertexShader: domImagePeelBendVert,
      fragmentShader: domImageEdgeRgbshiftFogFrag,
      transparent: true,
    });
  return { geometry: imageGeometry, material: imageMaterial };
}

export class WebGLImage extends WebGLItem {
  constructor(e: { domEl: any; name: string }) {
    super({ domEl: e.domEl, name: e.name, assetType: "image" });
    let t: Texture;
    if (e.domEl instanceof HTMLVideoElement) t = new VideoTexture(e.domEl);
    else {
      const img = new Image();
      img.crossOrigin = "";
      t = new Texture(img);
      img.addEventListener(
        "load",
        () => {
          t.needsUpdate = true;
          o.Gl.renderer.initTexture(t);
        },
        { once: true },
      );
      img.src = e.domEl.src;
    }
    if (o.isIOS) {
      t.minFilter = LinearFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
    }
    const { geometry, material } = shared();
    const i = material.clone();
    i.uniforms.u_texture.value = t;
    i.uniforms.u_resolution = o.Gl.globalUniforms.u_resolution;
    this.item = new Mesh(geometry, i);
    this.item.material.uniforms.fogNear = o.Gl.globalUniforms.fogNear;
    this.item.material.uniforms.fogFar = o.Gl.globalUniforms.fogFar;
    this.item.material.uniforms.fogColor = o.Gl.globalUniforms.fogColor;
    this.add(this.item);
  }
}

export default WebGLImage;
