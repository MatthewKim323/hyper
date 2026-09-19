import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, Points, ShaderMaterial, Vector3 } from "three";

/** Depth-tested shafts follow light entering the actual rear windows. */
export function createAtriumSunlight() {
  const group = new Group();
  group.name = "Window light and suspended dust";
  const time = { value: 0 };
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
    uniforms: { uTime: time },
    vertexShader: "varying vec2 vUv; varying vec3 vWorld; void main(){vUv=uv; vWorld=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: `varying vec2 vUv; varying vec3 vWorld; uniform float uTime;
      void main(){
        float edge=pow(max(0.,sin(vUv.x*3.14159265)),1.7);
        float lengthFade=smoothstep(0.,.14,vUv.y)*(1.-smoothstep(.48,1.,vUv.y));
        float bands=.72+.28*sin(vUv.x*27.+sin(vUv.y*8.+uTime*.13)*.22);
        float viewFade=.65+.35*abs(normalize(cameraPosition-vWorld).z);
        gl_FragColor=vec4(vec3(1.,.75,.53),edge*lengthFade*bands*viewFade*.065);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
  const geometries: BufferGeometry[] = [];
  for (const [x, width, height] of [[-7.1, 2.9, 10.8], [0, 6, 12.5], [7.1, 2.9, 10.8], [13.1, 2, 7]]) {
    const origin = new Vector3(x, height, -7.45);
    const end = origin.clone().add(new Vector3(-height * .62, -height + .3, height * .8));
    const geometry = new BufferGeometry();
    const vertices = [origin.x-width*.45,origin.y,origin.z, origin.x+width*.45,origin.y,origin.z, end.x-width*.66,end.y,end.z, end.x+width*.66,end.y,end.z];
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute([0,0,1,0,0,1,1,1], 2));
    geometry.setIndex([0,2,1,1,2,3]);
    geometries.push(geometry);
    const shaft = new Mesh(geometry, material); shaft.renderOrder = 4; group.add(shaft);
  }
  const dustGeometry = new BufferGeometry();
  const dustPositions: number[] = [];
  let seed = 319;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 200; i++) dustPositions.push((random()-.5)*27,random()*10+.5,(random()-.5)*15);
  dustGeometry.setAttribute("position", new Float32BufferAttribute(dustPositions, 3));
  geometries.push(dustGeometry);
  const dustMaterial = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: time },
    vertexShader: `uniform float uTime; varying float vLight;
      void main(){vec3 p=position; p.x+=sin(uTime*.13+p.z)*.07; p.y+=sin(uTime*.19+p.x)*.1;
      vec4 view=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*view; gl_PointSize=clamp(34./-view.z,1.,2.5); vLight=.25+.2*sin(p.x*3.+uTime*.5);}`,
    fragmentShader: "varying float vLight; void main(){float point=1.-smoothstep(.08,.5,length(gl_PointCoord-.5)); gl_FragColor=vec4(1.,.89,.78,point*vLight);}",
  });
  group.add(new Points(dustGeometry, dustMaterial));
  return { group, update(seconds: number) { time.value = seconds; }, dispose() { geometries.forEach(geometry => geometry.dispose()); material.dispose(); dustMaterial.dispose(); } };
}
