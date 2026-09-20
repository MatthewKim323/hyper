import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, Material, Mesh, MeshDepthMaterial, MeshDistanceMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, RGBADepthPacking, ShaderMaterial, Vector3, Vector4, type Shader } from "three";

export type AgentAuraState = "idle" | "listening" | "thinking" | "connecting" | "speaking" | "error";
export type AgentAuraSignal = { state: AgentAuraState; level: number };
export type AgentAura = {
  group: Group;
  update(time: number, delta: number, signal: AgentAuraSignal, paused?: boolean): void;
  dispose(): void;
};

const field = `
  uniform float uAuraTime, uAuraFlow, uAuraRadius;
  uniform vec3 uAuraCenter;
  uniform vec4 uAuraMotion;

  // The vector stores the analytic derivative of the scalar radial displacement.
  // Projecting it onto the sphere tangent plane gives the liquid surface normal.
  vec4 auraField(vec3 n) {
    float t=uAuraFlow;
    vec3 a=vec3(cos(t*.13)*3.2,2.4,sin(t*.13)*3.2);
    vec3 b=vec3(-2.1,sin(t*.09)*2.8,cos(t*.09)*2.8);
    vec3 c=vec3(1.3,5.2,-2.8);
    float pa=dot(n,a)-t*.42;
    float pb=dot(n,b)+t*.31;
    float pc=dot(n,c)-t*.26;
    float idle=(.008+.0018*uAuraMotion.x+.0012*uAuraMotion.y)*(1.-uAuraMotion.z*.18);
    float height=idle*(sin(pa)*.55+sin(pb)*.30+sin(pc)*.15);
    vec3 gradient=idle*(cos(pa)*a*.55+cos(pb)*b*.30+cos(pc)*c*.15);

    // Only measured agent audio drives these finer travelling ripples.
    vec3 d=vec3(8.4,3.7,-4.1),e=vec3(-3.2,7.9,5.3);
    float pd=dot(n,d)-uAuraTime*1.45;
    float pe=dot(n,e)+uAuraTime*1.12;
    float voice=.045*uAuraMotion.w;
    height+=voice*(sin(pd)*.55+sin(pe)*.45);
    gradient+=voice*(cos(pd)*d*.55+cos(pe)*e*.45);
    return vec4(gradient,height);
  }
`;

const pearlNormal = `
  #include <beginnormal_vertex>
  vec3 auraOffset=position-uAuraCenter;
  float auraBaseRadius=max(.0001,length(auraOffset));
  vec3 auraDirection=auraOffset/auraBaseRadius;
  vec4 auraSurface=auraField(auraDirection);
  vec3 auraTangent=auraSurface.xyz-auraDirection*dot(auraDirection,auraSurface.xyz);
  objectNormal=normalize(auraDirection-auraTangent*uAuraRadius/max(.0001,auraBaseRadius+uAuraRadius*auraSurface.w));
`;

const pearlPosition = `
  #include <begin_vertex>
  transformed+=auraDirection*(uAuraRadius*auraSurface.w);
  vAuraDirection=auraDirection;
`;

const shadowPosition = `
  #include <begin_vertex>
  vec3 auraDirection=normalize(position-uAuraCenter);
  transformed+=auraDirection*(uAuraRadius*auraField(auraDirection).w);
`;

const capillaries = `
  vec3 auraN=normalize(vAuraDirection);
  float auraT=uAuraFlow;
  float auraCurl=sin(dot(auraN,vec3(2.2,3.8,-1.7))-auraT*.19);
  float auraChannel=sin(auraN.y*7.+auraN.x*2.+auraCurl*.8+auraT*.23)
    +.42*sin(auraN.z*5.-auraN.x*3.-auraT*.17);
  float auraVein=exp(-abs(auraChannel)*19.);
  float auraBreak=smoothstep(-.35,.7,sin(dot(auraN,vec3(3.1,-1.8,2.6))-auraT*.21));
  float auraRim=pow(1.-abs(dot(normalize(normal),normalize(vViewPosition))),2.6);
  vec3 auraOpal=mix(vec3(1.7,1.35,1.42),vec3(1.25,1.62,1.85),.5+.5*sin(auraN.y*2.+auraT*.11));
  outgoingLight+=auraOpal*auraVein*auraBreak*(.032+auraRim*.09+uAuraLightLevel*.22+uAuraGlow*.065);
  outgoingLight+=vec3(.10,.085,.12)*auraRim*(.45+uAuraGlow+uAuraLightLevel*.6);
  #include <output_fragment>
`;

function ribbonGeometry() {
  const segments=96;
  const positions: number[]=[],uvs: number[]=[],bands: number[]=[],indices: number[]=[];
  for (let band=0;band<2;band++) {
    const offset=positions.length/3;
    for (let i=0;i<=segments;i++) for (let edge=0;edge<2;edge++) {
      positions.push(0,0,0);
      uvs.push(i/segments,edge);
      bands.push(band);
    }
    for (let i=0;i<segments;i++) {
      const a=offset+i*2;
      // Both windings remain visible in reflections without a second transparent pass.
      indices.push(a,a+2,a+1,a+1,a+2,a+3,a,a+1,a+2,a+1,a+3,a+2);
    }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new Float32BufferAttribute(uvs,2));
  geometry.setAttribute("aBand",new Float32BufferAttribute(bands,1));
  geometry.setIndex(indices);
  return geometry;
}

/** Scene-owned liquid motion. Call after the pearl's normal material decoration. */
export function createAgentAura(pearl: Mesh): AgentAura {
  const group=new Group();
  group.name="Agent | living opal water aura";
  if (!pearl.geometry.boundingSphere) pearl.geometry.computeBoundingSphere();
  const sphere=pearl.geometry.boundingSphere;
  const center=sphere?.center.clone()??new Vector3();
  const radius=sphere&&Number.isFinite(sphere.radius)&&sphere.radius>0?sphere.radius:1;
  const uniforms={
    uAuraTime:{value:0},uAuraFlow:{value:0},uAuraRadius:{value:radius},uAuraCenter:{value:center},
    uAuraMotion:{value:new Vector4()},uAuraLightLevel:{value:0},uAuraGlow:{value:.12},
  };
  const originalMaterial=pearl.material;
  const originalDepth=pearl.customDepthMaterial;
  const originalDistance=pearl.customDistanceMaterial;
  const ownedMaterials: Material[]=[];
  const copies=new Map<Material,Material>();
  function liquidMaterial(original: Material) {
    if (!(original instanceof MeshStandardMaterial)) return original;
    const cached=copies.get(original);
    if (cached) return cached;
    const material=original.clone();
    const decorate=original.onBeforeCompile;
    const cacheKey=original.customProgramCacheKey();
    if (material instanceof MeshPhysicalMaterial) {
      material.clearcoat=Math.max(material.clearcoat,.32);
      material.clearcoatRoughness=Math.min(material.clearcoatRoughness,.11);
    }
    material.onBeforeCompile=(shader,renderer)=>{
      // Preserve the rose-quartz gradient, transmission, and room-reflection shading.
      decorate.call(material,shader,renderer);
      Object.assign(shader.uniforms,uniforms);
      shader.vertexShader=`${field}\nvarying vec3 vAuraDirection;\n`+shader.vertexShader
        .replace("#include <beginnormal_vertex>",pearlNormal)
        .replace("#include <begin_vertex>",pearlPosition);
      shader.fragmentShader="varying vec3 vAuraDirection; uniform float uAuraFlow,uAuraLightLevel,uAuraGlow;\n"+shader.fragmentShader
        .replace("#include <output_fragment>",capillaries);
    };
    material.customProgramCacheKey=()=>cacheKey+"|hyper-agent-liquid-v1";
    copies.set(original,material);
    ownedMaterials.push(material);
    return material;
  }
  const liquid=Array.isArray(originalMaterial)?originalMaterial.map(liquidMaterial):liquidMaterial(originalMaterial);
  pearl.material=liquid;

  const depth=originalDepth?.clone()??new MeshDepthMaterial({depthPacking:RGBADepthPacking});
  const distance=originalDistance?.clone()??new MeshDistanceMaterial();
  for (const [material,original] of [[depth,originalDepth],[distance,originalDistance]] as const) {
    const decorate=original?.onBeforeCompile;
    const cacheKey=original?.customProgramCacheKey()??material.type;
    material.onBeforeCompile=(shader: Shader,renderer)=>{
      decorate?.call(material,shader,renderer);
      Object.assign(shader.uniforms,uniforms);
      shader.vertexShader=field+shader.vertexShader.replace("#include <begin_vertex>",shadowPosition);
    };
    material.customProgramCacheKey=()=>cacheKey+"|hyper-agent-liquid-shadow-v1";
    ownedMaterials.push(material);
  }
  pearl.customDepthMaterial=depth;
  pearl.customDistanceMaterial=distance;

  const geometry=ribbonGeometry();
  const ribbonMaterial=new ShaderMaterial({
    uniforms,transparent:true,depthTest:true,depthWrite:false,blending:AdditiveBlending,
    vertexShader:`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float aBand;
      uniform float uAuraFlow,uAuraTime;
      uniform vec4 uAuraMotion;
      varying vec2 vUv; varying float vBand;
      void main() {
        vUv=uv; vBand=aBand;
        float angle=uv.x*5.6+aBand*2.35+uAuraFlow*.10;
        float radius=1.07+aBand*.075+.012*sin(angle*3.-uAuraFlow*.19)
          +uAuraMotion.w*.014*sin(angle*5.-uAuraTime*1.12);
        vec3 p=vec3(cos(angle)*radius,
          sin(angle)*(.23-aBand*.62)+.035*sin(angle*2.+uAuraFlow*.18),
          sin(angle)*radius);
        p.y+=(uv.y-.5)*(.038-aBand*.010);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader:`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uAuraFlow,uAuraLightLevel,uAuraGlow;
      varying vec2 vUv; varying float vBand;
      void main() {
        #include <logdepthbuf_fragment>
        float edge=1.-smoothstep(.1,1.,abs(vUv.y*2.-1.));
        float ends=smoothstep(0.,.16,vUv.x)*(1.-smoothstep(.77,1.,vUv.x));
        float crest=pow(.5+.5*sin(vUv.x*6.2831853-uAuraFlow*.24+vBand*1.3),8.);
        float opacity=(.12+.035*uAuraGlow+.22*uAuraLightLevel)*(1.-vBand*.28)*edge*ends*(.6+.4*crest);
        vec3 opal=mix(vec3(2.2,1.85,1.8),vec3(1.8,2.,2.4),.5+.5*sin(vUv.x*3.4+vBand));
        gl_FragColor=vec4(opal,opacity);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
  const ribbons=new Mesh(geometry,ribbonMaterial);
  ribbons.name="Agent | two fine liquid currents";
  ribbons.frustumCulled=false;
  group.add(ribbons);
  const worldPosition=new Vector3(),worldScale=new Vector3(),worldRotation=new Quaternion();
  const targetMotion=new Vector4();
  let level=0,flowRate=.55,disposed=false;

  function followPearl() {
    pearl.updateWorldMatrix(true,false);
    pearl.matrixWorld.decompose(worldPosition,worldRotation,worldScale);
    group.position.copy(center).applyMatrix4(pearl.matrixWorld);
    group.quaternion.copy(worldRotation);
    group.scale.copy(worldScale).multiplyScalar(radius);
  }
  followPearl();
  return {
    group,
    update(time,delta,signal,paused=false) {
      if (disposed) return;
      followPearl();
      const step=Number.isFinite(delta)?Math.min(.1,Math.max(0,delta)):0;
      const targetLevel=signal.state==="speaking"&&Number.isFinite(signal.level)?Math.min(1,Math.max(0,signal.level)):0;
      const listening=signal.state==="listening"?1:0;
      const thinking=signal.state==="thinking"?1:0;
      const connecting=signal.state==="connecting"?1:0;
      const error=signal.state==="error";
      const glow=error?.04:listening?.28:thinking?.24:connecting?.18:.12;
      if (paused) {
        // Freeze displacement, ripples, ribbon positions, and flow highlights.
        // State feedback remains a small static light change.
        uniforms.uAuraLightLevel.value=Math.min(.18,targetLevel);
        uniforms.uAuraGlow.value=Math.min(.18,glow);
        return;
      }
      if (Number.isFinite(time)) uniforms.uAuraTime.value=time;
      const envelope=1-Math.exp(-step/(targetLevel>level?.055:.24));
      level+=(targetLevel-level)*envelope;
      const settle=1-Math.exp(-step*7);
      uniforms.uAuraMotion.value.lerp(targetMotion.set(listening,thinking,connecting,level),settle);
      // Audio gets its own attack/release envelope instead of double smoothing.
      uniforms.uAuraMotion.value.w=level;
      const rate=error?.28:listening?.38:thinking?.78:connecting?.44:.55;
      flowRate+=(rate-flowRate)*settle;
      uniforms.uAuraFlow.value+=step*flowRate;
      uniforms.uAuraLightLevel.value=level;
      uniforms.uAuraGlow.value+=(glow-uniforms.uAuraGlow.value)*settle;
    },
    dispose() {
      if (disposed) return;
      disposed=true;
      if (pearl.material===liquid) pearl.material=originalMaterial;
      if (pearl.customDepthMaterial===depth) pearl.customDepthMaterial=originalDepth;
      if (pearl.customDistanceMaterial===distance) pearl.customDistanceMaterial=originalDistance;
      ownedMaterials.forEach(material=>material.dispose());
      geometry.dispose(); ribbonMaterial.dispose();
      group.clear(); group.removeFromParent();
    },
  };
}
