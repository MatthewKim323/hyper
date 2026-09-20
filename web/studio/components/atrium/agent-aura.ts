import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, Material, Mesh, MeshDepthMaterial, MeshDistanceMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NormalBlending, Points, Quaternion, RGBADepthPacking, ShaderMaterial, Vector2, Vector3, Vector4, type Shader } from "three";

export type AgentAuraState = "idle" | "listening" | "thinking" | "connecting" | "speaking" | "error";
export type AgentAuraSignal = { state: AgentAuraState; level: number };
export type AgentAura = {
  group: Group;
  setInteraction(state: { hovered: boolean; pressed?: boolean }): void;
  update(time: number, delta: number, signal: AgentAuraSignal, paused?: boolean): void;
  dispose(): void;
};

const field = `
  uniform float uAuraTime, uAuraFlow, uAuraRadius;
  uniform vec3 uAuraCenter;
  uniform vec4 uAuraMotion;
  uniform vec2 uAuraInteraction;

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
    float idle=(.033+.012*uAuraInteraction.x+.008*uAuraMotion.x+.006*uAuraMotion.y)*(1.-uAuraMotion.z*.18);
    float height=idle*(sin(pa)*.55+sin(pb)*.30+sin(pc)*.15)-.028*uAuraInteraction.y;
    vec3 gradient=idle*(cos(pa)*a*.55+cos(pb)*b*.30+cos(pc)*c*.15);

    // Only measured agent audio drives these finer travelling ripples.
    vec3 d=vec3(8.4,3.7,-4.1),e=vec3(-3.2,7.9,5.3);
    float pd=dot(n,d)-uAuraTime*1.45;
    float pe=dot(n,e)+uAuraTime*1.12;
    float voice=.058*uAuraMotion.w;
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
  float auraChannel=sin(auraN.y*7.+auraN.x*2.+auraCurl*1.1+auraT*.42)
    +.42*sin(auraN.z*5.-auraN.x*3.-auraT*.17);
  float auraVein=exp(-abs(auraChannel)*19.);
  float auraBreak=smoothstep(-.35,.7,sin(dot(auraN,vec3(3.1,-1.8,2.6))-auraT*.21));
  float auraRim=pow(1.-abs(dot(normalize(normal),normalize(vViewPosition))),2.6);
  vec3 auraOpal=mix(vec3(1.7,1.35,1.42),vec3(1.25,1.62,1.85),.5+.5*sin(auraN.y*2.+auraT*.11));
  outgoingLight+=auraOpal*auraVein*auraBreak*(.16+auraRim*.3+uAuraLightLevel*.45+uAuraGlow*.14+uAuraInteraction.x*.3);
  outgoingLight+=vec3(.12,.23,.28)*auraRim*(.65+uAuraGlow+uAuraLightLevel*.8);
  #include <output_fragment>
`;

function ribbonGeometry() {
  const segments=128;
  const positions: number[]=[],uvs: number[]=[],bands: number[]=[],indices: number[]=[];
  for (let band=0;band<3;band++) {
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
    uAuraMotion:{value:new Vector4()},uAuraInteraction:{value:new Vector2()},uAuraLightLevel:{value:0},uAuraGlow:{value:.12},
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
      material.clearcoat=Math.max(material.clearcoat,.8);
      material.clearcoatRoughness=Math.min(material.clearcoatRoughness,.07);
    }
    material.onBeforeCompile=(shader,renderer)=>{
      // Preserve the rose-quartz gradient, transmission, and room-reflection shading.
      decorate.call(material,shader,renderer);
      Object.assign(shader.uniforms,uniforms);
      shader.vertexShader=`${field}\nvarying vec3 vAuraDirection;\n`+shader.vertexShader
        .replace("#include <beginnormal_vertex>",pearlNormal)
        .replace("#include <begin_vertex>",pearlPosition);
      shader.fragmentShader="varying vec3 vAuraDirection; uniform float uAuraFlow,uAuraLightLevel,uAuraGlow; uniform vec2 uAuraInteraction;\n"+shader.fragmentShader
        .replace("#include <output_fragment>",capillaries);
    };
    material.customProgramCacheKey=()=>cacheKey+"|hyper-agent-liquid-v2";
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
    material.customProgramCacheKey=()=>cacheKey+"|hyper-agent-liquid-shadow-v2";
    ownedMaterials.push(material);
  }
  pearl.customDepthMaterial=depth;
  pearl.customDistanceMaterial=distance;

  const geometry=ribbonGeometry();
  const ribbonVertex=`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute float aBand;
    uniform float uAuraFlow,uAuraTime,uHaloSpread;
    uniform vec4 uAuraMotion;
    uniform vec2 uAuraInteraction;
    varying vec2 vUv; varying float vBand; varying float vCrest;
    void main() {
      vUv=uv; vBand=aBand;
      float t=uAuraFlow;
      float angle=uv.x*5.7+aBand*2.19+t*(.39-aBand*.10);
      float wave=sin(angle*3.-t*.8+aBand)*.5+sin(angle*5.+t*.37)*.25;
      float reach=1.12+aBand*.095+.044*wave+.045*uAuraInteraction.x;
      reach+=uAuraMotion.w*.055*sin(angle*4.-uAuraTime*1.7);
      reach-=uAuraInteraction.y*.055;
      float width=(.074-aBand*.012)*(1.+.42*sin(angle*2.-t*.65));
      float latitude=(.18-aBand*.27)*sin(angle)+.16*sin(angle*2.+t*.42+aBand);
      vec3 p=vec3(cos(angle)*reach,latitude,sin(angle)*reach);
      // Each current folds through its own inclined plane, never a flat orbit line.
      float tilt=-.32+aBand*.31;
      p.yz=mat2(cos(tilt),-sin(tilt),sin(tilt),cos(tilt))*p.yz;
      vec3 crossFlow=normalize(vec3(cos(angle)*.36,1.,sin(angle)*.36));
      p+=crossFlow*(uv.y-.5)*width*uHaloSpread;
      vCrest=wave;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
      #include <logdepthbuf_vertex>
    }`;
  const ribbonMaterial=new ShaderMaterial({
    uniforms:{...uniforms,uHaloSpread:{value:1}},transparent:true,depthTest:true,depthWrite:false,blending:NormalBlending,
    vertexShader:ribbonVertex,
    fragmentShader:`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uAuraFlow,uAuraLightLevel,uAuraGlow;
      uniform vec2 uAuraInteraction;
      varying vec2 vUv; varying float vBand; varying float vCrest;
      void main() {
        #include <logdepthbuf_fragment>
        float cross=abs(vUv.y*2.-1.);
        float edge=1.-smoothstep(.72,1.,cross);
        float ends=smoothstep(0.,.12,vUv.x)*(1.-smoothstep(.82,1.,vUv.x));
        float travel=vUv.x*25.-uAuraFlow*2.1+vBand*2.;
        float caustic=pow(.5+.5*sin(travel+vCrest*4.),12.);
        float rim=pow(cross,5.);
        float core=exp(-pow((vUv.y-.38)*15.,2.));
        vec3 water=mix(vec3(.27,.48,.54),vec3(.84,.83,.98),.5+.5*sin(vUv.x*4.8-uAuraFlow*.22+vBand));
        water+=vec3(1.25,1.7,1.85)*(rim*.54+caustic*.8+core*.28);
        float opacity=(.42+.12*uAuraInteraction.x+.14*uAuraLightLevel)*edge*ends;
        gl_FragColor=vec4(water,opacity);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
  const ribbons=new Mesh(geometry,ribbonMaterial);
  ribbons.name="Agent | three flowing water currents";
  ribbons.frustumCulled=false;
  group.add(ribbons);
  const glowMaterial=new ShaderMaterial({
    uniforms:{...uniforms,uHaloSpread:{value:4.2}},transparent:true,depthTest:true,depthWrite:false,blending:AdditiveBlending,
    vertexShader:ribbonVertex,
    fragmentShader:`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uAuraFlow,uAuraLightLevel;
      uniform vec2 uAuraInteraction;
      varying vec2 vUv; varying float vBand; varying float vCrest;
      void main() {
        #include <logdepthbuf_fragment>
        float core=exp(-pow((vUv.y-.5)*5.,2.));
        float ends=smoothstep(0.,.14,vUv.x)*(1.-smoothstep(.76,1.,vUv.x));
        float pulse=.65+.35*sin(vUv.x*12.-uAuraFlow*1.6+vBand);
        float alpha=core*ends*pulse*(.13+.1*uAuraInteraction.x+.13*uAuraLightLevel);
        gl_FragColor=vec4(vec3(.95,1.55,1.85),alpha);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
  const glow=new Mesh(geometry,glowMaterial);
  glow.name="Agent | water current bloom";
  glow.frustumCulled=false;
  group.add(glow);

  // A single point batch adds tiny refractive-looking droplets with an analytic round profile.
  const dropletGeometry=new BufferGeometry();
  const seeds:number[]=[];
  for (let i=0;i<32;i++) seeds.push(i/32,((i*13)%31)/31,((i*7)%29)/29);
  dropletGeometry.setAttribute("position",new Float32BufferAttribute(seeds,3));
  const dropletMaterial=new ShaderMaterial({
    uniforms,transparent:true,depthTest:true,depthWrite:false,blending:NormalBlending,
    vertexShader:`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uAuraFlow,uAuraLightLevel;
      uniform vec2 uAuraInteraction;
      varying float vDropAlpha;
      void main() {
        float seed=position.x*6.2831853;
        float a=seed+uAuraFlow*(.24+position.y*.17);
        float radius=1.16+position.y*.36+.06*sin(a*2.+uAuraFlow*.7);
        vec3 p=vec3(cos(a)*radius,sin(a*1.6+seed)*(.18+position.z*.45),sin(a)*radius);
        p.y+=.045*sin(uAuraFlow*.8+seed*2.);
        vec4 mv=modelViewMatrix*vec4(p,1.);
        gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp((7.+position.z*10.)*(1.+.16*uAuraInteraction.x)/max(1.,-mv.z*.22),2.,9.);
        vDropAlpha=.38+position.z*.3+.15*uAuraLightLevel;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader:`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying float vDropAlpha;
      void main() {
        #include <logdepthbuf_fragment>
        vec2 p=gl_PointCoord*2.-1.;
        float r=dot(p,p);
        if(r>1.) discard;
        float rim=smoothstep(.15,.88,r);
        float spec=exp(-dot(p-vec2(-.3,-.35),p-vec2(-.3,-.35))*30.);
        vec3 color=mix(vec3(.47,.65,.7),vec3(1.25,1.6,1.8),rim*.7+spec);
        gl_FragColor=vec4(color,(1.-smoothstep(.7,1.,r))*vDropAlpha);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
  const droplets=new Points(dropletGeometry,dropletMaterial);
  droplets.name="Agent | suspended water droplets";
  droplets.frustumCulled=false;
  group.add(droplets);
  const worldPosition=new Vector3(),worldScale=new Vector3(),worldRotation=new Quaternion();
  const targetMotion=new Vector4();
  const interaction=new Vector2();
  let level=0,flowRate=1.25,disposed=false;

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
    setInteraction(state) {
      if (disposed) return;
      interaction.set(state.hovered ? 1 : 0,state.pressed ? 1 : 0);
    },
    update(time,delta,signal,paused=false) {
      if (disposed) return;
      followPearl();
      const step=Number.isFinite(delta)?Math.min(.1,Math.max(0,delta)):0;
      const targetLevel=signal.state==="speaking"&&Number.isFinite(signal.level)?Math.min(1,Math.max(0,signal.level)):0;
      const listening=signal.state==="listening"?1:0;
      const thinking=signal.state==="thinking"?1:0;
      const connecting=signal.state==="connecting"?1:0;
      const error=signal.state==="error";
      const glow=error?.08:listening?.42:thinking?.36:connecting?.24:.22;
      if (paused) {
        // Freeze displacement, ripples, ribbon positions, and flow highlights.
        // State feedback remains a small static light change.
        uniforms.uAuraLightLevel.value=Math.min(.18,targetLevel);
        uniforms.uAuraGlow.value=Math.min(.32,glow+interaction.x*.08);
        return;
      }
      if (Number.isFinite(time)) uniforms.uAuraTime.value=time;
      const envelope=1-Math.exp(-step/(targetLevel>level?.055:.24));
      level+=(targetLevel-level)*envelope;
      const settle=1-Math.exp(-step*7);
      uniforms.uAuraInteraction.value.lerp(interaction,1-Math.exp(-step*16));
      uniforms.uAuraMotion.value.lerp(targetMotion.set(listening,thinking,connecting,level),settle);
      // Audio gets its own attack/release envelope instead of double smoothing.
      uniforms.uAuraMotion.value.w=level;
      const rate=(error?.45:listening?1.05:thinking?1.8:connecting?.85:1.25)+interaction.x*.4;
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
      geometry.dispose(); ribbonMaterial.dispose(); glowMaterial.dispose();
      dropletGeometry.dispose(); dropletMaterial.dispose();
      group.clear(); group.removeFromParent();
    },
  };
}
