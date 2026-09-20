import { DataTexture, LinearEncoding, LinearFilter, LinearMipmapLinearFilter, MirroredRepeatWrapping, TextureLoader, type Texture } from "three";

export const MARBLE_TEXTURE_URL = "/assets/hyper-atrium/textures/ivory-rose-marble.png";

/** Albedo is decoded explicitly because it is sampled by our own shader. */
export function createMarbleSurface(anisotropy: number) {
  const fallback = new DataTexture(new Uint8Array([233, 222, 213, 255]), 1, 1);
  fallback.needsUpdate = true;
  const albedo = { value: fallback as Texture };
  let disposed = false;
  let loading: Promise<void> | undefined;
  return {
    albedo,
    load() {
      return loading ??= new TextureLoader().loadAsync(MARBLE_TEXTURE_URL).then(texture => {
        if (disposed) { texture.dispose(); return; }
        texture.encoding = LinearEncoding;
        texture.wrapS = texture.wrapT = MirroredRepeatWrapping;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.magFilter = LinearFilter;
        texture.anisotropy = Math.min(8, anisotropy);
        texture.needsUpdate = true;
        albedo.value.dispose();
        albedo.value = texture;
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      albedo.value.dispose();
    },
  };
}

export const marbleSampling = `
  uniform sampler2D uStoneAlbedo;
  vec3 marbleLinear(vec3 color) {
    return mix(color/12.92,pow((color+.055)/1.055,vec3(2.4)),step(vec3(.04045),color));
  }
  vec3 marbleAlbedo(vec3 point, vec3 surfaceNormal) {
    // World-space box projection keeps the same four-meter slab scale on the
    // walls, curved basin and plinths, without requiring their UVs to agree.
    vec3 weights=pow(abs(surfaceNormal),vec3(6.));
    weights/=max(.00001,weights.x+weights.y+weights.z);
    vec3 p=point*.25;
    return marbleLinear(texture2D(uStoneAlbedo,p.yz).rgb)*weights.x
      +marbleLinear(texture2D(uStoneAlbedo,p.xz).rgb)*weights.y
      +marbleLinear(texture2D(uStoneAlbedo,p.xy).rgb)*weights.z;
  }
`;
