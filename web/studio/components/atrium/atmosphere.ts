import { BackSide, CircleGeometry, Color, CubeCamera, HalfFloatType, LinearFilter, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PMREMGenerator, Points, Scene, ShaderChunk, ShaderMaterial, SphereGeometry, Vector3, WebGLCubeRenderTarget, WebGLRenderer, type Texture, type WebGLRenderTarget } from "three";

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
        float height = smoothstep(-.04,.42,direction.y);
        vec3 color = mix(vec3(1.02,.68,.64), vec3(.30,.46,.86),height);
        // Broad, irregular cloud banks preserve the reference's airy sky.
        // A nearly isotropic field avoids horizontal bands between the arches.
        vec3 cloudPoint=direction*vec3(9.,12.,9.)+vec3(uTime*.001,1.8,0.);
        float mass=atriumCloud(cloudPoint);
        float curls=atriumCloud(cloudPoint*3.4+vec3(7.1,2.4,8.));
        float cloudCover=smoothstep(.52,.71,mass+(curls-.5)*.14);
        cloudCover*=1.-smoothstep(.55,.9,direction.y);
        float litRim=smoothstep(.52,.64,mass)*(1.-smoothstep(.64,.78,mass));
        vec3 cloudColor=mix(vec3(.92,.81,.90),vec3(1.55,1.36,1.36),smoothstep(.48,.68,mass));
        cloudColor+=vec3(.18,.12,.08)*litRim;
        color=mix(color,cloudColor,cloudCover*.90);
        float sunlight=pow(max(0.,dot(direction,uSunDirection)),48.);
        color += vec3(1.0,.61,.32)*sunlight;
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
  panelGeometry.dispose(); panelMaterial.dispose();
  const roomCube = new WebGLCubeRenderTarget(256, { type: HalfFloatType, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
  const roomCamera = new CubeCamera(.1, 200, roomCube);
  let roomEnvironment: WebGLRenderTarget | null = null;
  let disposed = false;
  const usesRoomReflections = (material: MeshStandardMaterial) => /Portals \||graduated rose quartz|luminous ivory pearl/.test(material.name);
  const isSubmergedStone = (material: MeshStandardMaterial) => /submerged.*limestone/i.test(material.name);
  const isRoomStone = (material: MeshStandardMaterial) => /limestone|travertine|stone floor/i.test(material.name) && !/porous|submerged/i.test(material.name);
  const setEnvironment = (material: MeshStandardMaterial, environment: Texture | null) => {
    if (material.envMap !== environment) {
      material.envMap = environment;
      material.needsUpdate = true;
    }
  };

  function captureRoomReflections(scene: Scene, position: Vector3, excluded: readonly Object3D[] = []) {
    if (disposed) return;
    const hidden = new Map<Object3D, boolean>();
    const reflective = new Set<MeshStandardMaterial>();
    const stoneEnvironments = new Map<MeshStandardMaterial, Texture | null>();
    const hide = (object: Object3D) => {
      if (hidden.has(object)) return;
      hidden.set(object, object.visible);
      object.visible = false;
    };
    excluded.forEach(hide);
    scene.traverse(object => {
      if (object instanceof Points) { hide(object); return; }
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof MeshStandardMaterial && usesRoomReflections(material)) { reflective.add(material); hide(object); }
        else if (material instanceof MeshStandardMaterial && isRoomStone(material)) {
          reflective.add(material);
          stoneEnvironments.set(material, material.envMap);
        }
        // Exclude refraction and translucent effect passes, including light
        // shafts. Actual lamps remain in the capture to illuminate the room.
        if (material instanceof MeshPhysicalMaterial && material.transmission > 0 || material instanceof ShaderMaterial && material.transparent) hide(object);
      }
    });
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousLevel = renderer.getActiveMipmapLevel();
    const previousToneMapping = renderer.toneMapping;
    const previousXr = renderer.xr.enabled;
    const previousShadows = renderer.shadowMap.autoUpdate;
    let captured = false;
    try {
      // Keep architecture visible, illuminated by the original sky. Feeding
      // the previous room capture into a new one would accumulate reflections.
      for (const material of stoneEnvironments.keys()) setEnvironment(material, target.texture);
      scene.updateMatrixWorld(true);
      roomCamera.position.copy(position);
      // The preceding beauty frame provides the shadow maps. Six cube faces
      // must not trigger six new shadow-map renders or recursive water captures.
      renderer.shadowMap.autoUpdate = false;
      roomCamera.update(renderer, scene);
      roomEnvironment = generator.fromCubemap(roomCube.texture, roomEnvironment);
      for (const material of reflective) setEnvironment(material, roomEnvironment.texture);
      captured = true;
    } finally {
      if (!captured) for (const [material, environment] of stoneEnvironments) setEnvironment(material, environment);
      hidden.forEach((visible, object) => { object.visible = visible; });
      renderer.setRenderTarget(previousTarget, previousFace, previousLevel);
      renderer.toneMapping = previousToneMapping;
      renderer.xr.enabled = previousXr;
      renderer.shadowMap.autoUpdate = previousShadows;
    }
  }
  const decorated = new WeakSet<MeshStandardMaterial>();
  function decorate(root: Object3D) {
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.receiveShadow = true;
      const name = object.name.replaceAll("_", " ");
      object.castShadow = !/clear|glass|rim|light seam|seam light|floating pearl light|reveal|satellite/i.test(name);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof MeshStandardMaterial) || decorated.has(material)) continue;
        decorated.add(material);
        material.envMapIntensity = usesRoomReflections(material) ? .85 : .48;
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
        } else if (isSubmergedStone(material)) {
          // Preserve the source's cool lavender floor beneath the warm room.
          // One mineral field supplies color and roughness without wall veins.
          material.onBeforeCompile = shader => {
            shader.vertexShader = "varying vec3 vFloorPosition;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvFloorPosition=(modelMatrix*vec4(transformed,1.)).xyz;");
            shader.fragmentShader = `varying vec3 vFloorPosition; ${noise}\n` + shader.fragmentShader.replace("#include <color_fragment>", `
              #include <color_fragment>
              float floorMineral=atriumNoise(vFloorPosition*1.7);
              diffuseColor.rgb*=.94+floorMineral*.12;
            `).replace("#include <roughnessmap_fragment>", `
              #include <roughnessmap_fragment>
              roughnessFactor=clamp(roughnessFactor+(floorMineral-.5)*.06,.28,.52);
            `);
          };
          material.customProgramCacheKey = () => "hyper-submerged-lavender-stone-v1";
        } else if (isRoomStone(material)) {
          material.color.setRGB(.739, .562, .499);
          material.envMapIntensity = .28;
          material.roughness = .40;
          const previousDecoration = material.onBeforeCompile;
          const previousKey = material.customProgramCacheKey();
          material.onBeforeCompile = (shader, renderer) => {
            previousDecoration.call(material, shader, renderer);
            shader.uniforms.uStoneTime = time;
            shader.uniforms.uStoneSunDirection = { value: sunDirection };
            shader.vertexShader = "varying vec3 vStonePosition;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvStonePosition=(modelMatrix*vec4(transformed,1.)).xyz;");
            const stoneNoise = shader.fragmentShader.includes("float atriumHash(") ? "" : noise;
            shader.fragmentShader = `varying vec3 vStonePosition; uniform float uStoneTime; uniform vec3 uStoneSunDirection; ${stoneNoise}\n` + shader.fragmentShader.replace("#include <color_fragment>", `
              #include <color_fragment>
              // Match the source's meter-scale geological folds. Convert to
              // Blender coordinates so horizontal and vertical cuts agree.
              vec3 marblePosition=vec3(vStonePosition.x,-vStonePosition.z,vStonePosition.y);
              vec3 marblePoint=marblePosition*.58;
              vec3 marbleWarp=vec3(
                atriumNoise(marblePoint*.65+vec3(4.1,1.7,9.2)),
                atriumNoise(marblePoint*.65+vec3(11.3,5.2,2.8)),
                atriumNoise(marblePoint*.65+vec3(2.6,13.4,6.7))
              )-.5;
              vec3 marbleFlow=marblePoint+marbleWarp*1.1;
              float marbleBase=atriumNoise(marblePosition*.48);
              float marbleMineral=atriumNoise(marblePosition*1.15);
              float marbleSplinter=atriumNoise(marbleFlow*3.8);
              float marbleField=dot(marblePosition,vec3(.68,.31,.94))+marbleBase*3.2+marbleSplinter*.18;
              float marbleDistance=abs(sin(marbleField));
              float marbleAA=max(.001,fwidth(marbleField)*.65);
              float marbleMask=mix(.10,.34,smoothstep(.30,.65,marbleWarp.x+.5));
              float marbleMain=(1.-smoothstep(.009-marbleAA,.031+marbleAA,marbleDistance))*marbleMask;
              float marbleBranchField=marbleField*1.035+marbleSplinter*.64;
              float marbleBranchAA=max(.001,fwidth(marbleBranchField)*.65);
              float marbleBranch=(1.-smoothstep(.004-marbleBranchAA,.014+marbleBranchAA,abs(sin(marbleBranchField))))
                *.10*(1.-smoothstep(.1,.45,marbleDistance));
              float marbleVein=max(marbleMain,marbleBranch);
              float marbleShoulder=(1.-smoothstep(.020,.08+marbleAA,marbleDistance))*.07;

              // Fine mineral detail fades below a pixel instead of sparkling in motion.
              float marbleFootprint=max(length(dFdx(vStonePosition)),length(dFdy(vStonePosition)));
              float marbleGrainWeight=1.-smoothstep(.5,1.8,marbleFootprint*72.);
              float marbleGrain=mix(.5,atriumNoise(vStonePosition*72.),marbleGrainWeight);
              diffuseColor.rgb*=mix(.96,1.04,smoothstep(.12,.88,marbleMineral))+(marbleGrain-.5)*.022;
              diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.80,.77,.80),marbleShoulder);
              diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.48,.43,.50),marbleVein);
              float marbleHeight=(marbleGrain-.5)*.0007-marbleVein*.0004;
            `).replace("#include <roughnessmap_fragment>", `
              #include <roughnessmap_fragment>
              roughnessFactor=clamp(.36+marbleMineral*.06+(marbleGrain-.5)*.025+marbleVein*.06,.34,.48);
            `).replace("#include <normal_fragment_maps>", `
              #include <normal_fragment_maps>
              // Surface-gradient bump mapping, matching r143's bump-map normal
              // convention. Height is in scene units, so it survives scaling.
              vec3 marbleSigmaX=dFdx(-vViewPosition),marbleSigmaY=dFdy(-vViewPosition);
              vec3 marbleR1=cross(marbleSigmaY,normal),marbleR2=cross(normal,marbleSigmaX);
              float marbleDet=dot(marbleSigmaX,marbleR1)*faceDirection;
              vec3 marbleGradient=sign(marbleDet)*(dFdx(marbleHeight)*marbleR1+dFdy(marbleHeight)*marbleR2);
              if(abs(marbleDet)>.00000001) normal=normalize(abs(marbleDet)*normal-marbleGradient);
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
          material.customProgramCacheKey = () => previousKey + "|hyper-live-rose-marble-v5";
        } else if (/graduated rose quartz|luminous ivory pearl/.test(material.name)) {
          material.color.setRGB(.933, .787, .721);
          material.roughness = .23;
          material.metalness = 0;
          if (material instanceof MeshPhysicalMaterial) {
            material.clearcoat = .22;
            material.clearcoatRoughness = .17;
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
          material.roughness = /petals/.test(material.name) ? .77 : /canopies/.test(material.name) ? .85 : .94;
          material.envMapIntensity = .42;
          // Petals scatter light through a thin surface. Screen-space glass
          // refraction makes them sample the whole room at every overlap.
          // The diffuse backlighting below supplies their translucency.
          if (material instanceof MeshPhysicalMaterial) material.transmission = 0;
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
              float gardenSunVisibility=1.;
              #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
                if(receiveShadow) {
                  DirectionalLightShadow gardenShadow=directionalLightShadows[0];
                  gardenSunVisibility=getShadow(directionalShadowMap[0],gardenShadow.shadowMapSize,gardenShadow.shadowBias,gardenShadow.shadowRadius,vDirectionalShadowCoord[0]);
                }
              #endif
              outgoingLight+=diffuseColor.rgb*vec3(1.0,.80,.69)*backlight*.8*gardenSunVisibility;
              #include <output_fragment>
            `);
          };
          material.customProgramCacheKey = () => /petals|canopies/.test(material.name) ? "hyper-live-botanical-translucency-v3" : "hyper-live-garden-earth-v2";
        } else if (/Hills/.test(material.name)) {
          material.color.setRGB(.52,.36,.43);
          material.roughness = .95;
        }
      }
    });
  }
  return {
    sky, environment: target.texture, decorate, captureRoomReflections,
    update(seconds: number) { time.value = seconds; },
    dispose() {
      if (disposed) return;
      disposed = true;
      roomCube.dispose(); roomEnvironment?.dispose();
      target.dispose(); generator.dispose(); skyGeometry.dispose(); skyMaterial.dispose();
    },
  };
}
