import { BackSide, Color, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, PMREMGenerator, Scene, ShaderChunk, ShaderMaterial, SphereGeometry, WebGLRenderer } from "three";

const noise = `
  float atriumHash(vec3 p) { p = fract(p * .3183099 + vec3(.1,.2,.3)); p *= 17.; return fract(p.x * p.y * p.z * (p.x+p.y+p.z)); }
  float atriumNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(mix(atriumHash(i),atriumHash(i+vec3(1,0,0)),f.x),mix(atriumHash(i+vec3(0,1,0)),atriumHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(atriumHash(i+vec3(0,0,1)),atriumHash(i+vec3(1,0,1)),f.x),mix(atriumHash(i+vec3(0,1,1)),atriumHash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  float atriumCloud(vec3 p) { return .57*atriumNoise(p)+.28*atriumNoise(p*2.03)+.15*atriumNoise(p*4.07); }
`;

/** Live sky and surface shading. No photographic or rendered backdrop is used. */
export function createAtriumAtmosphere(renderer: WebGLRenderer) {
  const time = { value: 0 };
  const skyGeometry = new SphereGeometry(160, 32, 24);
  const skyMaterial = new ShaderMaterial({
    side: BackSide, depthWrite: false,
    uniforms: { uTime: time },
    vertexShader: "varying vec3 vDirection; void main(){ vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: `varying vec3 vDirection; uniform float uTime; ${noise}
      void main() {
        vec3 direction = normalize(vDirection);
        float height = smoothstep(-.03,.38,direction.y);
        vec3 color = mix(vec3(.88,.61,.61), vec3(.30,.45,.80),height);
        float clouds = atriumCloud(direction*vec3(4.0,8.,4.)+vec3(uTime*.0015,0.,0.));
        clouds = smoothstep(.43,.69,clouds) * (1.-smoothstep(.35,.95,direction.y));
        color = mix(color,vec3(1.,.92,.85),clouds*.72);
        float sunlight=pow(max(0.,dot(direction,normalize(vec3(-.5,.35,-.8)))),32.);
        color += vec3(.5,.31,.18)*sunlight;
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
  const sky = new Mesh(skyGeometry, skyMaterial);
  sky.name = "Live pastel cloud sky";
  sky.frustumCulled = false;
  const lightingScene = new Scene();
  lightingScene.add(sky.clone());
  const panelGeometry = new PlaneGeometry(12, 8);
  const panelMaterial = new MeshBasicMaterial({ color: new Color(2.2, 1.95, 1.85) });
  for (const x of [-14, 14]) {
    const panel = new Mesh(panelGeometry, panelMaterial);
    panel.position.set(x, 7, 7); panel.lookAt(0, 2, 0); lightingScene.add(panel);
  }
  const generator = new PMREMGenerator(renderer);
  const target = generator.fromScene(lightingScene, .025, .1, 200);
  generator.dispose(); panelGeometry.dispose(); panelMaterial.dispose();
  const decorated = new WeakSet<MeshStandardMaterial>();
  function decorate(root: Object3D) {
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.receiveShadow = true;
      object.castShadow = !/clear|glass|rim|light|reveal|satellite/i.test(object.name);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof MeshStandardMaterial) || decorated.has(material)) continue;
        decorated.add(material);
        material.envMapIntensity = .48;
        if (/limestone|travertine|stone floor/i.test(material.name)) {
          material.color.setRGB(.53, .34, .29);
          material.roughness = .48;
          material.onBeforeCompile = shader => {
            shader.uniforms.uStoneTime = time;
            shader.vertexShader = "varying vec3 vStonePosition;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvStonePosition=(modelMatrix*vec4(transformed,1.)).xyz;");
            shader.fragmentShader = `varying vec3 vStonePosition; uniform float uStoneTime; ${noise}\n` + shader.fragmentShader.replace("#include <color_fragment>", `
              #include <color_fragment>
              float mineral = atriumCloud(vStonePosition*1.4);
              float grain = atriumNoise(vStonePosition*95.);
              diffuseColor.rgb *= .87 + mineral*.24 + (grain-.5)*.025;
            `).replace("#include <normal_fragment_maps>", `
              #include <normal_fragment_maps>
              vec3 pores = vec3(atriumNoise(vStonePosition*44.),atriumNoise(vStonePosition*44.+17.),atriumNoise(vStonePosition*44.+33.))-.5;
              normal=normalize(normal+mat3(viewMatrix)*pores*.06);
            `).replace("#include <output_fragment>", `
              float waterline = 1.-smoothstep(.3,2.4,vStonePosition.y);
              if(waterline>0.) {
                vec2 c=vStonePosition.xz*5.;
                float ripple=sin(c.x+sin(c.y*.73+uStoneTime*.45))+sin(c.y*.91+sin(c.x*.62-uStoneTime*.39));
                float caustic=pow(max(0.,1.-abs(ripple)*.65),16.);
                outgoingLight+=vec3(.10,.075,.052)*caustic*waterline;
              }
              #include <output_fragment>
            `);
          };
          material.customProgramCacheKey = () => "hyper-live-limestone-v1";
        } else if (/graduated rose quartz|luminous ivory pearl/.test(material.name)) {
          material.color.setRGB(.81, .64, .57);
          material.roughness = .23;
          material.metalness = .025;
          if (material instanceof MeshPhysicalMaterial) {
            material.clearcoat = .55;
            material.clearcoatRoughness = .12;
            material.transmission = /graduated/.test(material.name) ? .92 : .16;
            material.thickness = .9;
          }
          material.onBeforeCompile = shader => {
            if (/graduated/.test(material.name)) {
              shader.fragmentShader = shader.fragmentShader.replace("#include <transmission_fragment>", ShaderChunk.transmission_fragment.replace("float transmissionFactor = transmission;", "float transmissionFactor = transmission * (1.0-smoothstep(2.1,3.6,vWorldPosition.y));"));
            }
            shader.fragmentShader = shader.fragmentShader.replace("#include <output_fragment>", `
              float edge=pow(1.-max(0.,dot(normalize(normal),normalize(vViewPosition))),2.5);
              outgoingLight += edge*vec3(.18,.15,.23);
              #include <output_fragment>
            `);
          };
          material.customProgramCacheKey = () => /graduated/.test(material.name) ? "hyper-live-graduated-pearl-v1" : "hyper-live-ivory-pearl-v1";
        } else if (/warm ivory seam light/.test(material.name)) {
          material.emissiveIntensity = 1.25;
        } else if (/Garden/.test(material.name)) {
          material.roughness = .9;
          material.envMapIntensity = .28;
          material.onBeforeCompile = shader => {
            shader.vertexShader = "varying vec3 vGardenPosition;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGardenPosition=(modelMatrix*vec4(transformed,1.)).xyz;");
            shader.fragmentShader = `varying vec3 vGardenPosition; ${noise}\n` + shader.fragmentShader.replace("#include <color_fragment>", `
              #include <color_fragment>
              float detail=atriumCloud(vGardenPosition*12.);
              diffuseColor.rgb *= .75+detail*.5;
            `);
          };
          material.customProgramCacheKey = () => "hyper-live-garden-v1";
        } else if (/Hills/.test(material.name)) {
          material.color.setRGB(.52,.36,.43);
          material.roughness = .95;
        }
      }
    });
  }
  return { sky, environment: target.texture, decorate, update(seconds: number) { time.value = seconds; }, dispose() { target.dispose(); skyGeometry.dispose(); skyMaterial.dispose(); } };
}
