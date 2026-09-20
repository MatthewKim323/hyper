import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, Mesh, Points, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";

type Aperture = { position: [number, number, number]; width: number };

const shadowVertex = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  #include <shadowmap_pars_vertex>
  uniform vec3 uSunDirection;
`;
const shadowFragment = `
  uniform bool receiveShadow;
  #include <common>
  #include <packing>
  #include <logdepthbuf_pars_fragment>
  #include <shadowmap_pars_fragment>
  float rearSunVisibility() {
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      DirectionalLightShadow light=directionalLightShadows[0];
      return receiveShadow ? getShadow(directionalShadowMap[0],light.shadowMapSize,light.shadowBias,light.shadowRadius,vDirectionalShadowCoord[0]) : 1.;
    #else
      return 1.;
    #endif
  }
`;

/** Layered scattering follows the exported sun through the carved apertures. */
export function createAtriumSunlight(sunDirection: Vector3, apertures?: Aperture[]) {
  const group = new Group();
  group.name = "Window light and suspended dust";
  const time = { value: 0 };
  const light = sunDirection.clone();
  if (![light.x, light.y, light.z].every(Number.isFinite) || light.y < .001) light.set(12, 11.5, -25);
  light.normalize();
  const travel = light.clone().negate();
  const windows = (apertures?.length ? apertures : [[-13.1, 2, 7.5], [-7.1, 2.9, 10.7], [0, 6, 13.3], [7.1, 2.9, 10.7], [13.1, 2, 7.5]].map(([x, width, apex]) => ({ position: [x, 7.45, apex - width * .3] as [number, number, number], width: width * .9 })))
    .filter(window => window.position.every(Number.isFinite) && Number.isFinite(window.width) && window.width > 0 && window.position[2] > .5);

  const material = new ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, blending: AdditiveBlending, lights: true,
    uniforms: { ...UniformsUtils.clone(UniformsLib.lights), uTime: time, uSunDirection: { value: light } },
    vertexShader: `${shadowVertex}
      attribute float layerWeight;
      varying vec2 vUv; varying vec3 vWorld; varying float vWeight;
      void main() {
        vUv=uv; vWeight=layerWeight;
        vec4 worldPosition=modelMatrix*vec4(position,1.);
        vWorld=worldPosition.xyz;
        gl_Position=projectionMatrix*viewMatrix*worldPosition;
        vec3 transformedNormal=mat3(viewMatrix)*uSunDirection;
        #include <shadowmap_vertex>
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `${shadowFragment}
      varying vec2 vUv; varying vec3 vWorld; varying float vWeight;
      uniform float uTime; uniform vec3 uSunDirection;
      float hash(vec3 p) {
        p=fract(p*.1031); p+=dot(p,p.yzx+33.33);
        return fract((p.x+p.y)*p.z);
      }
      float airNoise(vec3 p) {
        vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      void main() {
        #include <logdepthbuf_fragment>
        // Feather the ray bundle instead of repeating stripes across a window.
        float across=abs(vUv.x*2.-1.);
        float edge=(1.-smoothstep(.52,1.,across))*exp(-across*across*1.15);
        float lengthFade=smoothstep(0.,.065,vUv.y)*(1.-smoothstep(.65,1.,vUv.y));
        vec3 drift=vec3(uTime*.009,-uTime*.004,uTime*.003);
        float density=.84+.16*airNoise(vWorld*.38+drift);
        float cosine=dot(-uSunDirection,normalize(cameraPosition-vWorld));
        // Match the source's broader-angle haze (anisotropy .15), so side-lit
        // rays remain visible without looking straight into the light.
        float phase=.9775/pow(max(.08,1.0225-.30*cosine),1.5);
        phase=clamp(phase*.45,.28,.85);
        float scattering=edge*lengthFade*density*vWeight*phase*rearSunVisibility();
        gl_FragColor=vec4(vec3(1.,.77,.58),scattering*.11);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });

  const positions: number[] = [], uvs: number[] = [], weights: number[] = [], indices: number[] = [];
  // Three overlapping, weighted depth layers approximate an illuminated volume.
  // All five apertures share one geometry and one draw call.
  for (const window of windows) {
    const [x, y, height] = window.position;
    for (const [verticalOffset, widthScale, weight] of [[.06, .87, .30], [-.14, 1.02, .42], [-.35, 1.02, .28]]) {
      const origin = new Vector3(x, height + verticalOffset * window.width, -y);
      const length = Math.max(0, (origin.y - .08) / -travel.y);
      const end = origin.clone().addScaledVector(travel, length);
      const startWidth = window.width * widthScale * .5;
      // The source sun subtends .85 degrees, creating a restrained penumbra.
      const endWidth = startWidth + length * .0074;
      const offset = positions.length / 3;
      positions.push(origin.x - startWidth, origin.y, origin.z, origin.x + startWidth, origin.y, origin.z, end.x - endWidth, end.y, end.z, end.x + endWidth, end.y, end.z);
      uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
      weights.push(weight, weight, weight, weight);
      // Opposite winding supports reflected views without r143's transparent
      // DoubleSide material issuing a separate render pass for each face.
      indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3, offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("layerWeight", new Float32BufferAttribute(weights, 1));
  geometry.setIndex(indices);
  const shafts = new Mesh(geometry, material);
  shafts.name = "Sunlit aperture volumes";
  shafts.receiveShadow = true;
  shafts.renderOrder = 4;
  group.add(shafts);

  const dustPositions: number[] = [];
  let seed = 319;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 160 && windows.length; i++) {
    const window = windows[i % windows.length];
    const point = new Vector3(window.position[0] + (random() - .5) * window.width * .75, window.position[2] - random() * window.width * .45, -window.position[1]);
    point.addScaledVector(travel, (point.y - .2) / -travel.y * (.08 + random() * .78));
    dustPositions.push(point.x, point.y, point.z);
  }
  const dustGeometry = new BufferGeometry();
  dustGeometry.setAttribute("position", new Float32BufferAttribute(dustPositions, 3));
  const dustMaterial = new ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, blending: AdditiveBlending, lights: true,
    uniforms: { ...UniformsUtils.clone(UniformsLib.lights), uTime: time, uSunDirection: { value: light } },
    vertexShader: `${shadowVertex}
      uniform float uTime; varying float vLight;
      void main() {
        vec3 p=position;
        p.x+=sin(uTime*.13+p.z)*.07; p.y+=sin(uTime*.19+p.x)*.1;
        vec4 worldPosition=modelMatrix*vec4(p,1.);
        vec4 view=viewMatrix*worldPosition;
        gl_Position=projectionMatrix*view;
        gl_PointSize=clamp(34./max(1.,-view.z),1.,2.);
        vLight=.17+.11*sin(p.x*3.+uTime*.3);
        vec3 transformedNormal=mat3(viewMatrix)*uSunDirection;
        #include <shadowmap_vertex>
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `${shadowFragment}
      varying float vLight;
      void main() {
        #include <logdepthbuf_fragment>
        float point=1.-smoothstep(.06,.5,length(gl_PointCoord-.5));
        gl_FragColor=vec4(1.,.86,.72,point*vLight*rearSunVisibility());
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
  const dust = new Points(dustGeometry, dustMaterial);
  dust.name = "Dust within the sunlit air";
  dust.receiveShadow = true;
  group.add(dust);
  let disposed = false;
  return {
    group,
    // The caller supplies a frozen clock for reduced motion and hidden tabs.
    update(seconds: number) { if (!disposed && Number.isFinite(seconds)) time.value = seconds; },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.dispose(); dustGeometry.dispose(); material.dispose(); dustMaterial.dispose();
      group.clear();
    },
  };
}
