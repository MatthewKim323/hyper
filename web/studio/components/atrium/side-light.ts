import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, ShaderMaterial, SpotLight, Vector2, Vector3, type Texture } from "three";

type Triple = [number, number, number];
export type AtriumSideLightMetadata = {
  position: Triple;
  target: Triple;
  direction?: Triple;
  color: Triple;
  power: number;
  coneAngle: number;
  coneBlend: number;
  sourceRadius: number;
  apertureNormal?: Triple;
  apertures: { name: string; position: Triple; width: number; height: number; target: Triple }[];
  occluder?: { name: string; x: number; depth: number; y: [number, number]; z: [number, number] };
};

const fromBlender = ([x, y, z]: Triple) => new Vector3(x, z, -y);
const validPoint = (point: Triple) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

/** Reconstruct the side key; its stone aperture baffle is in environment.glb. */
export function createAtriumSideLight(metadata?: AtriumSideLightMetadata) {
  const group = new Group();
  group.name = "Warm light through the right clerestory";
  if (!metadata || !validPoint(metadata.position) || !validPoint(metadata.target)) {
    return { group, update(_seconds: number) { void _seconds; }, dispose() { group.clear(); } };
  }
  const source = fromBlender(metadata.position);
  const target = fromBlender(metadata.target);
  const color = new Color().setRGB(...metadata.color);
  // r143's legacy lighting has no inverse-square attenuation with distance=0.
  // Calibrate the live key to the source's corrected 720 kW clerestory.
  const power = Number.isFinite(metadata.power) ? Math.max(0, metadata.power) / 720000 : 1;
  const angle = Number.isFinite(metadata.coneAngle) ? Math.min(Math.PI * .95, Math.max(.05, metadata.coneAngle)) / 2 : 28 * Math.PI / 180;
  const penumbra = Number.isFinite(metadata.coneBlend) ? Math.max(0, Math.min(1, metadata.coneBlend)) : .18;
  const light = new SpotLight(color, 4.2 * power, 0, angle, penumbra, 1);
  light.name = "Clerestory focused warm key";
  light.position.copy(source);
  light.target.position.copy(target);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 140;
  light.shadow.bias = -.000025;
  light.shadow.normalBias = .025;
  group.add(light, light.target);

  const apertures = metadata.apertures.filter(aperture => validPoint(aperture.position) && validPoint(aperture.target) && Number.isFinite(aperture.width) && aperture.width > 0 && Number.isFinite(aperture.height) && aperture.height > 0);
  const rearY = Math.max(...apertures.map(aperture => aperture.target[1]), 20) + .3;
  const rearZ = -rearY;
  const inset = (metadata.occluder?.depth ?? .48) * .5 + .035;
  const positions: number[] = [], uvs: number[] = [], weights: number[] = [], indices: number[] = [];
  function extendToRoom(edge: Vector3) {
    const ray = edge.clone().sub(source);
    const floor = ray.y < -.001 ? (.035 - source.y) / ray.y : Infinity;
    const rear = ray.z < -.001 ? (rearZ - source.z) / ray.z : Infinity;
    const distance = Math.min(floor, rear, 110 / Math.max(.001, ray.length()));
    return source.clone().addScaledVector(ray, Math.max(1.02, distance));
  }
  for (const aperture of apertures) {
    const center = fromBlender(aperture.position);
    for (const [heightOffset, weight] of [[-.3, .28], [0, .44], [.3, .28]]) {
      // A point source diverges through each slot edge, unlike parallel sun rays.
      const a = center.clone().add(new Vector3(0, aperture.height * heightOffset, aperture.width * .47));
      const b = center.clone().add(new Vector3(0, aperture.height * heightOffset, -aperture.width * .47));
      const endA = extendToRoom(a), endB = extendToRoom(b);
      const exit = (source.x - center.x + inset) / Math.max(.01, source.x - center.x);
      a.sub(source).multiplyScalar(exit).add(source);
      b.sub(source).multiplyScalar(exit).add(source);
      const offset = positions.length / 3;
      positions.push(...a.toArray(), ...b.toArray(), ...endA.toArray(), ...endB.toArray());
      uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
      weights.push(weight, weight, weight, weight);
      // Both windings avoid r143's extra transparent DoubleSide pass.
      indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3, offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("layerWeight", new Float32BufferAttribute(weights, 1));
  geometry.setIndex(indices);
  const sourceWorld = source.clone(), targetWorld = target.clone();
  const time = { value: 0 };
  const material = new ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: {
      uTime: time, uColor: { value: light.color }, uSource: { value: sourceWorld },
      uAxis: { value: target.clone().sub(source).normalize() },
      uCone: { value: new Vector2(Math.cos(angle), Math.cos(angle * (1 - penumbra))) },
      uStrength: { value: power }, uKeyShadowMap: { value: null as Texture | null },
      uKeyShadowMatrix: { value: light.shadow.matrix }, uShadowReady: { value: false },
      uShadowMapSize: { value: light.shadow.mapSize.clone() }, uShadowBias: { value: light.shadow.bias },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform mat4 uKeyShadowMatrix;
      attribute float layerWeight;
      varying vec2 vUv; varying vec3 vWorld; varying vec4 vKeyShadow; varying float vWeight;
      void main() {
        vUv=uv; vWeight=layerWeight;
        vec4 worldPosition=modelMatrix*vec4(position,1.);
        vWorld=worldPosition.xyz;
        vKeyShadow=uKeyShadowMatrix*worldPosition;
        gl_Position=projectionMatrix*viewMatrix*worldPosition;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <packing>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime, uStrength, uShadowBias;
      uniform vec3 uColor, uSource, uAxis;
      uniform vec2 uCone, uShadowMapSize;
      uniform sampler2D uKeyShadowMap;
      uniform bool uShadowReady;
      varying vec2 vUv; varying vec3 vWorld; varying vec4 vKeyShadow; varying float vWeight;
      float keyDepthCompare(vec2 uv,float depth) {
        return step(depth,unpackRGBAToDepth(texture2D(uKeyShadowMap,uv)));
      }
      // Sample only this key's packed RGBA map. The rear sun may be occluded
      // independently and must never extinguish a side-lit volume.
      float keyVisibility() {
        if(!uShadowReady || vKeyShadow.w<=0.) return 0.;
        vec3 p=vKeyShadow.xyz/vKeyShadow.w;
        if(any(lessThan(p,vec3(0.))) || any(greaterThan(p,vec3(1.)))) return 0.;
        // Match r143's PCFSoftShadowMap kernel: contiguous texels and bilinear
        // comparison weights avoid separated copies of each aperture edge.
        vec2 texel=1./uShadowMapSize;
        float dx=texel.x,dy=texel.y;
        vec2 uv=p.xy;
        vec2 f=fract(uv*uShadowMapSize+.5);
        uv-=f*texel;
        float depth=p.z+uShadowBias;
        return (
          keyDepthCompare(uv,depth)+
          keyDepthCompare(uv+vec2(dx,0.),depth)+
          keyDepthCompare(uv+vec2(0.,dy),depth)+
          keyDepthCompare(uv+texel,depth)+
          mix(keyDepthCompare(uv+vec2(-dx,0.),depth),keyDepthCompare(uv+vec2(2.*dx,0.),depth),f.x)+
          mix(keyDepthCompare(uv+vec2(-dx,dy),depth),keyDepthCompare(uv+vec2(2.*dx,dy),depth),f.x)+
          mix(keyDepthCompare(uv+vec2(0.,-dy),depth),keyDepthCompare(uv+vec2(0.,2.*dy),depth),f.y)+
          mix(keyDepthCompare(uv+vec2(dx,-dy),depth),keyDepthCompare(uv+vec2(dx,2.*dy),depth),f.y)+
          mix(
            mix(keyDepthCompare(uv+vec2(-dx,-dy),depth),keyDepthCompare(uv+vec2(2.*dx,-dy),depth),f.x),
            mix(keyDepthCompare(uv+vec2(-dx,2.*dy),depth),keyDepthCompare(uv+vec2(2.*dx,2.*dy),depth),f.x),
            f.y)
        )/9.;
      }
      float airHash(vec3 p) { p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
      float airNoise(vec3 p) {
        vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(mix(airHash(i),airHash(i+vec3(1,0,0)),f.x),mix(airHash(i+vec3(0,1,0)),airHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(airHash(i+vec3(0,0,1)),airHash(i+vec3(1,0,1)),f.x),mix(airHash(i+vec3(0,1,1)),airHash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      void main() {
        #include <logdepthbuf_fragment>
        float across=abs(vUv.x*2.-1.);
        float edge=(1.-smoothstep(.46,1.,across))*exp(-across*across*.8);
        float lengthFade=smoothstep(0.,.06,vUv.y)*(1.-smoothstep(.78,1.,vUv.y));
        vec3 incoming=normalize(vWorld-uSource);
        float cone=smoothstep(uCone.x,max(uCone.x+.00001,uCone.y),dot(incoming,uAxis));
        float cosine=dot(incoming,normalize(cameraPosition-vWorld));
        float phase=min(1.15,.6354/pow(max(.08,1.0225-.30*cosine),1.5));
        float density=.87+.13*airNoise(vWorld*.43+vec3(uTime*.008,-uTime*.004,0.));
        float alpha=edge*lengthFade*vWeight*phase*density*cone*keyVisibility();
        gl_FragColor=vec4(uColor,alpha*.26*uStrength);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
  const shafts = new Mesh(geometry, material);
  shafts.name = "Side aperture scattering volumes";
  shafts.receiveShadow = true;
  shafts.renderOrder = 4;
  // Shadow targets are allocated during the renderer's shadow pass, before this
  // hook. Bind by light identity, independent of global light/shadow array order.
  shafts.onBeforeRender = () => {
    material.uniforms.uKeyShadowMap.value = light.shadow.map?.texture ?? null;
    material.uniforms.uShadowReady.value = Boolean(light.shadow.map);
    material.uniforms.uShadowBias.value = light.shadow.bias;
    material.uniforms.uShadowMapSize.value.copy(light.shadow.mapSize);
    material.uniforms.uStrength.value = light.intensity / 4.2;
    material.uniforms.uCone.value.set(Math.cos(light.angle), Math.cos(light.angle * (1 - light.penumbra)));
    light.getWorldPosition(sourceWorld);
    light.target.getWorldPosition(targetWorld);
    material.uniforms.uAxis.value.copy(targetWorld).sub(sourceWorld).normalize();
  };
  group.add(shafts);
  let disposed = false;
  return {
    group,
    // The owning scene freezes this clock for reduced motion and hidden tabs.
    update(seconds: number) { if (!disposed && Number.isFinite(seconds)) time.value = seconds; },
    dispose() {
      if (disposed) return;
      disposed = true;
      shafts.onBeforeRender = () => {};
      geometry.dispose(); material.dispose(); light.dispose(); group.clear();
    },
  };
}
