import { BackSide, CircleGeometry, Color, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PMREMGenerator, Scene, ShaderChunk, ShaderMaterial, SphereGeometry, Vector3, WebGLRenderer } from "three";

const noise = `
  float atriumHash(vec3 p) { p = fract(p * .3183099 + vec3(.1,.2,.3)); p *= 17.; return fract(p.x * p.y * p.z * (p.x+p.y+p.z)); }
  float atriumNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(mix(atriumHash(i),atriumHash(i+vec3(1,0,0)),f.x),mix(atriumHash(i+vec3(0,1,0)),atriumHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(atriumHash(i+vec3(0,0,1)),atriumHash(i+vec3(1,0,1)),f.x),mix(atriumHash(i+vec3(0,1,1)),atriumHash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  float atriumCloud(vec3 p) { return .57*atriumNoise(p)+.28*atriumNoise(p*2.03)+.15*atriumNoise(p*4.07); }
`;

/** Live sky and surface shading. No photographic or rendered backdrop is used. */
export function createAtriumAtmosphere(renderer: WebGLRenderer, sunDirection: Vector3) {
  const time = { value: 0 };
  const skyGeometry = new SphereGeometry(160, 32, 24);
  const skyMaterial = new ShaderMaterial({
    side: BackSide, depthWrite: false,
    uniforms: { uTime: time, uSunDirection: { value: sunDirection.clone().normalize() } },
    vertexShader: "varying vec3 vDirection; void main(){ vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: `varying vec3 vDirection; uniform float uTime; uniform vec3 uSunDirection; ${noise}
      void main() {
        vec3 direction = normalize(vDirection);
        float height = smoothstep(-.03,.38,direction.y);
        vec3 color = mix(vec3(.88,.61,.61), vec3(.30,.45,.80),height);
        float clouds = atriumCloud(direction*vec3(4.0,8.,4.)+vec3(uTime*.0015,0.,0.));
        clouds = smoothstep(.43,.69,clouds) * (1.-smoothstep(.35,.95,direction.y));
        color = mix(color,vec3(1.,.92,.85),clouds*.72);
        float sunlight=pow(max(0.,dot(direction,uSunDirection)),32.);
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
  const panelGeometry = new CircleGeometry(5, 64);
  const panelMaterial = new MeshBasicMaterial({ color: new Color(1.6, 1.35, 1.25) });
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
        if (/porous warm limestone/.test(material.name)) {
          material.color.setRGB(1, 1, 1);
          material.roughness = .78;
          material.onBeforeCompile = shader => {
            shader.vertexShader = "varying vec3 vRockPosition;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvRockPosition=(modelMatrix*vec4(transformed,1.)).xyz;");
            shader.fragmentShader = `varying vec3 vRockPosition; ${noise}\n` + shader.fragmentShader.replace("#include <normal_fragment_maps>", `
              #include <normal_fragment_maps>
              vec3 chips=vec3(atriumNoise(vRockPosition*62.),atriumNoise(vRockPosition*62.+13.),atriumNoise(vRockPosition*62.+29.))-.5;
              normal=normalize(normal+mat3(viewMatrix)*chips*.26);
            `).replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor=.68+atriumNoise(vRockPosition*88.)*.22;");
          };
          material.customProgramCacheKey = () => "hyper-weathered-limestone-v1";
        } else if (/limestone|travertine|stone floor/i.test(material.name)) {
          material.color.setRGB(.739, .562, .499);
          material.roughness = .46;
          material.onBeforeCompile = shader => {
            shader.uniforms.uStoneTime = time;
            shader.uniforms.uStoneSunDirection = { value: sunDirection };
            shader.vertexShader = "varying vec3 vStonePosition;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvStonePosition=(modelMatrix*vec4(transformed,1.)).xyz;");
            shader.fragmentShader = `varying vec3 vStonePosition; uniform float uStoneTime; uniform vec3 uStoneSunDirection; ${noise}\n` + shader.fragmentShader.replace("#include <color_fragment>", `
              #include <color_fragment>
              float mineral = atriumCloud(vStonePosition*1.4);
              float grain = atriumNoise(vStonePosition*95.);
              diffuseColor.rgb *= .87 + mineral*.24 + (grain-.5)*.025;
            `).replace("#include <normal_fragment_maps>", `
              #include <normal_fragment_maps>
              vec3 pores = vec3(atriumNoise(vStonePosition*44.),atriumNoise(vStonePosition*44.+17.),atriumNoise(vStonePosition*44.+33.))-.5;
              normal=normalize(normal+mat3(viewMatrix)*pores*.06);
            `).replace("#include <output_fragment>", `
              float waterline = 1.-smoothstep(.18,1.25,vStonePosition.y);
              if(waterline>0.) {
                vec2 c=(vStonePosition.xz-vStonePosition.y*uStoneSunDirection.xz/max(.15,uStoneSunDirection.y))*5.;
                float ripple=sin(c.x+sin(c.y*.73+uStoneTime*.45))+sin(c.y*.91+sin(c.x*.62-uStoneTime*.39));
                float caustic=pow(max(0.,1.-abs(ripple)*.65),16.);
                outgoingLight+=vec3(.075,.055,.038)*caustic*waterline;
              }
              #include <output_fragment>
            `);
          };
          material.customProgramCacheKey = () => "hyper-live-limestone-v2";
        } else if (/graduated rose quartz|luminous ivory pearl/.test(material.name)) {
          material.color.setRGB(.933, .787, .721);
          material.roughness = .23;
          material.metalness = .025;
          if (material instanceof MeshPhysicalMaterial) {
            material.clearcoat = .55;
            material.clearcoatRoughness = .12;
            material.transmission = /graduated/.test(material.name) ? .70 : .16;
            material.thickness = 2;
            material.attenuationColor = new Color(.98, .83, .75);
            material.attenuationDistance = .9;
          }
          material.onBeforeCompile = shader => {
            shader.vertexShader = "varying vec3 vPearlPosition;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvPearlPosition=(modelMatrix*vec4(transformed,1.)).xyz;");
            shader.fragmentShader = `varying vec3 vPearlPosition; ${noise}\n` + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `
              #include <color_fragment>
              float quartz=atriumCloud(vPearlPosition*2.8);
              diffuseColor.rgb *= .87+quartz*.22;
            `);
            if (/graduated/.test(material.name)) {
              shader.fragmentShader = shader.fragmentShader.replace("#include <transmission_fragment>", ShaderChunk.transmission_fragment.replace("float transmissionFactor = transmission;", "float transmissionFactor = transmission * mix(1.,.14,smoothstep(1.75,4.5,vWorldPosition.y));"));
              shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor=mix(.17,.285,smoothstep(1.75,4.5,vPearlPosition.y));");
            }
            shader.fragmentShader = shader.fragmentShader.replace("#include <output_fragment>", `
              float edge=pow(1.-max(0.,dot(normalize(normal),normalize(vViewPosition))),2.5);
              outgoingLight += edge*vec3(.18,.15,.23);
              outgoingLight += vec3(.22,.15,.10)*exp(-pow((vPearlPosition.y-1.8)*2.,2.));
              #include <output_fragment>
            `);
          };
          material.customProgramCacheKey = () => /graduated/.test(material.name) ? "hyper-live-graduated-pearl-v2" : "hyper-live-ivory-pearl-v2";
        } else if (/warm ivory seam light/.test(material.name)) {
          material.emissiveIntensity = 1.25;
        } else if (/Garden/.test(material.name)) {
          material.roughness = .9;
          material.envMapIntensity = .42;
          material.onBeforeCompile = shader => {
            shader.uniforms.uGardenSunDirection = { value: sunDirection };
            shader.vertexShader = "varying vec3 vGardenPosition;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGardenPosition=(modelMatrix*vec4(transformed,1.)).xyz;");
            shader.fragmentShader = `varying vec3 vGardenPosition; uniform vec3 uGardenSunDirection; ${noise}\n` + shader.fragmentShader.replace("#include <color_fragment>", `
              #include <color_fragment>
              float detail=atriumCloud(vGardenPosition*12.);
              diffuseColor.rgb *= .85+detail*.3;
            `);
            if (/petals|canopies/.test(material.name)) shader.fragmentShader = shader.fragmentShader.replace("#include <output_fragment>", `
              vec3 gardenSun=normalize(mat3(viewMatrix)*uGardenSunDirection);
              float backlight=pow(max(0.,dot(-normal,gardenSun)),1.5);
              outgoingLight+=diffuseColor.rgb*vec3(1.0,.80,.69)*backlight*.8;
              #include <output_fragment>
            `);
          };
          material.customProgramCacheKey = () => /petals|canopies/.test(material.name) ? "hyper-live-botanical-translucency-v2" : "hyper-live-garden-earth-v2";
        } else if (/Hills/.test(material.name)) {
          material.color.setRGB(.52,.36,.43);
          material.roughness = .95;
        }
      }
    });
  }
  return { sky, environment: target.texture, decorate, update(seconds: number) { time.value = seconds; }, dispose() { target.dispose(); skyGeometry.dispose(); skyMaterial.dispose(); } };
}
