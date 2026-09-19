// Recovered responsive implementation. See PROVENANCE.md.
import * as THREE from "three";
export default function initialize() {
  "use strict";
  var n = THREE;
  class r extends n.Mesh {
    constructor(t, e = {}) {
      (super(t, e),
        (this.isReflector = !0),
        (this.type = "GroundMesh"),
        (this.camera = e.camera ? e.camera : new n.PerspectiveCamera()));
      const i = this,
        s = void 0 !== e.color ? new n.Color(e.color) : new n.Color(8355711),
        o = e.textureWidth || 512,
        a = e.textureHeight || 512,
        l = e.clipBias || 0,
        h = e.shader || r.ReflectorShader,
        c = void 0 !== e.multisample ? e.multisample : 4,
        u = new n.Plane(),
        d = new n.Vector3(),
        p = new n.Vector3(),
        m = new n.Vector3(),
        f = new n.Matrix4(),
        g = new n.Vector3(0, 0, -1),
        v = new n.Vector4(),
        _ = new n.Vector3(),
        y = new n.Vector3(),
        x = new n.Vector4();
      ((this.textureMatrix = new n.Matrix4()),
        (this.virtualCamera = this.camera),
        (this.renderTarget = new n.WebGLRenderTarget(o, a, {
          samples: c,
          type: n.HalfFloatType,
        })));
      const S = new n.ShaderMaterial({
        transparent: !0,
        name: void 0 !== h.name ? h.name : "unspecified",
        uniforms: n.UniformsUtils.clone(h.uniforms),
        fragmentShader: h.fragmentShader,
        vertexShader: h.vertexShader,
      });
      ((S.uniforms.tDiffuse.value = this.renderTarget.texture),
        (S.uniforms.color.value = s),
        (S.uniforms.textureMatrix.value = this.textureMatrix),
        (this.material = S),
        (this.onBeforeRender = (t, e, n) => {
          (p.setFromMatrixPosition(i.matrixWorld),
            m.setFromMatrixPosition(n.matrixWorld),
            f.extractRotation(i.matrixWorld),
            d.set(0, 0, 1),
            d.applyMatrix4(f),
            _.subVectors(p, m),
            this.onBeforeRenderForMirror(t, e, n),
            (i.visible = !1));
          const r = t.getRenderTarget();
          ((t.xr.enabled = !1),
            (t.shadowMap.autoUpdate = !1),
            t.setRenderTarget(this.renderTarget),
            t.state.buffers.depth.setMask(!0),
            !1 === t.autoClear && t.clear(),
            t.render(e, this.virtualCamera),
            t.setRenderTarget(r));
          const s = n.viewport;
          (void 0 !== s && t.state.viewport(s), (i.visible = !0));
        }),
        (this.onBeforeRenderForMirror = (t, e, n) => {
          if (_.dot(d) > 0) return;
          (_.reflect(d).negate(),
            _.add(p),
            f.extractRotation(n.matrixWorld),
            g.set(0, 0, -1),
            g.applyMatrix4(f),
            g.add(m),
            y.subVectors(p, g),
            y.reflect(d).negate(),
            y.add(p),
            this.virtualCamera.position.copy(_),
            this.virtualCamera.up.set(0, 1, 0),
            this.virtualCamera.up.applyMatrix4(f),
            this.virtualCamera.up.reflect(d),
            this.virtualCamera.lookAt(y),
            (this.virtualCamera.far = n.far),
            this.virtualCamera.updateMatrixWorld(),
            this.virtualCamera.projectionMatrix.copy(n.projectionMatrix),
            this.textureMatrix.set(
              0.5,
              0,
              0,
              0.5,
              0,
              0.5,
              0,
              0.5,
              0,
              0,
              0.5,
              0.5,
              0,
              0,
              0,
              1,
            ),
            this.textureMatrix.multiply(this.virtualCamera.projectionMatrix),
            this.textureMatrix.multiply(this.virtualCamera.matrixWorldInverse),
            this.textureMatrix.multiply(i.matrixWorld),
            u.setFromNormalAndCoplanarPoint(d, p),
            u.applyMatrix4(this.virtualCamera.matrixWorldInverse),
            v.set(u.normal.x, u.normal.y, u.normal.z, u.constant));
          const r = this.virtualCamera.projectionMatrix;
          ((x.x = (Math.sign(v.x) + r.elements[8]) / r.elements[0]),
            (x.y = (Math.sign(v.y) + r.elements[9]) / r.elements[5]),
            (x.z = -1),
            (x.w = (1 + r.elements[10]) / r.elements[14]),
            v.multiplyScalar(2 / v.dot(x)),
            (r.elements[2] = v.x),
            (r.elements[6] = v.y),
            (r.elements[10] = v.z + 1 - l),
            (r.elements[14] = v.w));
        }),
        (this.getRenderTarget = () => this.renderTarget),
        (this.dispose = () => {
          (this.renderTarget.dispose(), i.material.dispose());
        }));
    }
  }
  var s = THREE;
  const o = WEBGL.scenes.first;
  WEBGL.scenes.first.ground = {
    ready: !1,
    scale: 5,
    segmentW: 32,
    segmentH: 32,
    textures: {
      epoxyFloor: {
        src: {
          d2x: CDN_ASSETS_URL + "/tex/512/epoxyFloor.jpg",
          d1x: CDN_ASSETS_URL + "/tex/512/epoxyFloor.jpg",
          mob: CDN_ASSETS_URL + "/tex/512/epoxyFloor.jpg",
        },
        tex: null,
      },
    },
    params: {
      dispPower: 0.025,
      dispAlpha: 0.2,
      alpha: 0.8,
      curvePower: 10,
      curveHeight: -2,
      curveOffset: 1.5,
      noiseQuality: 4,
      noisePer: 0.5,
      noiseSpeed: { x: 2, y: 2 },
      noisePower: 2.5,
      noiseAlpha: 0.8,
      fogPower: 2.5,
      fogDensity: 0.21,
      repeatFloor: 3,
      y: 0.2,
    },
    setForDevice() {
      ((this.params.fogPower = (VW / WW) * 2.5),
        WW <= MOBILE_WIDTH
          ? (this.params.fogPower = 15)
          : WW <= TABLET_WIDTH && (this.params.fogPower = 10));
    },
    once() {
      this.setForDevice();
      let t = new s.PlaneGeometry(1, 1, this.segmentW, this.segmentH);
      ((this.mesh = new r(t, {
        clipBias: 1e-4,
        color: COLOR.table.scene.three,
        multisample: 1,
        shader: {
          uniforms: {
            color: { value: COLOR.table.scene.three },
            time: { value: 0 },
            alpha: { value: this.params.alpha },
            tDiffuse: { value: null },
            tFloor: { value: null },
            tFloorRepeat: { value: 5 },
            quality: { value: DESIGN.params.quality },
            dispPower: { value: this.params.dispPower },
            dispAlpha: { value: this.params.dispAlpha },
            curvePower: { value: this.params.curvePower },
            curveHeight: { value: this.params.curveHeight },
            curveOffset: { value: this.params.curveOffset },
            noiseQuality: { value: this.params.noiseQuality },
            noisePer: { value: this.params.noisePer },
            noiseSpeed: { value: this.params.noisePer },
            noisePower: { value: this.params.noisePower },
            noiseAlpha: { value: this.params.noiseAlpha },
            fogPower: { value: this.params.fogPower },
            fogDensity: { value: this.params.fogDensity },
            repeatFloor: { value: this.params.repeatFloor },
            resolution: { value: { x: 1, y: 1 } },
            textureMatrix: { value: null },
            zoomPower: { value: 0 },
          },
          vertexShader:
            "#define GLSLIFY 1\nuniform mat4 textureMatrix;\nvarying vec4 vUv4;\nvarying vec2 vUv2;\nvarying vec3 vNormal;\nvarying vec3 vViewPosition;\nuniform float quality;\nuniform vec2 resolution;\nuniform float time;\nuniform int noiseQuality;\nuniform float noisePer;\nuniform vec2 noiseSpeed;\nuniform float noisePower;\nuniform float noiseAlpha;\nconst float PI = 3.1415926;\n\nfloat interpolate(float a, float b, float x){\n\tfloat f = (1.0 - cos(x * PI)) * 0.5;\n\treturn a * (1.0 - f) + b * f;\n}\n\nfloat rnd(vec2 p){\n\treturn fract(sin(dot(p ,vec2(12.9898,78.233))) * 43758.5453);\n}\n\nfloat irnd(vec2 p){\n\tvec2 i = floor(p);\n\tvec2 f = fract(p);\n\tvec4 v = vec4(rnd(vec2(i.x, i.y )),\n\trnd(vec2(i.x + 1.0, i.y )),\n\trnd(vec2(i.x, i.y + 1.0)),\n\trnd(vec2(i.x + 1.0, i.y + 1.0)));\n\treturn interpolate(interpolate(v.x, v.y, f.x), interpolate(v.z, v.w, f.x), f.y);\n}\n\nfloat cloud(vec2 p){\n\tfloat t = 0.0;\n\tfor(int i = 0; i < noiseQuality; i++){\n\t\tfloat freq = pow(2.0, float(i));\n\t\tfloat amp  = pow(noisePer, float(noiseQuality - i));\n\t\tt += irnd(vec2(p.x / freq, p.y / freq)) * amp;\n\t}\n\treturn t;\n}\nvarying float vNoise;\nuniform float curvePower;\nuniform float curveHeight;\nuniform float curveOffset;\n#include <common>\n\nvoid main() {\n\n\tvUv2 = uv;\n\tvUv4 = textureMatrix * vec4( position, 1.0 );\n\n\tvec4 mvPosition = modelViewMatrix * vec4(position, 1.0);\n\n\tvNoise = cloud( vUv2 * resolution - time * noiseSpeed );\n\tvNoise = pow( vNoise, noisePower );\n\n\tvec2 uvRad = radians( vUv2 * 180. );\n\tvec2 uvSin = sin( uvRad );\n\tmvPosition.y = mvPosition.y + pow( uvSin.x * uvSin.y, curvePower ) * curveHeight - curveOffset;\n\tvViewPosition = -mvPosition.xyz;\n\tvNormal = normalize(mat3(modelViewMatrix) * normal);\n\tgl_Position = projectionMatrix * mvPosition;\n}",
          fragmentShader:
            "#define GLSLIFY 1\nvarying vec2 vUv2;\nvarying vec4 vUv4;\nvarying vec3 vNormal;\nvarying vec3 vViewPosition;\nuniform vec3 color;\nuniform float alpha;\nuniform sampler2D tDiffuse;\nuniform sampler2D tFloor;\nuniform float tFloorRepeat;\nuniform float quality;\nuniform float dispAlpha;\nuniform float dispPower;\nuniform vec2 resolution;\nuniform float noiseAlpha;\nuniform float zoomPower;\nvarying float vNoise;\nuniform float fogPower;\nuniform float fogDensity;\n\nvoid main() {\n\n\tfloat vFogDepth = 1.0 - vViewPosition.z;\n\tfloat fd = fogDensity * 0.1;\n\tfloat fogFactor = exp( - ( fd ) * ( fd ) * vFogDepth * vFogDepth );\n\n\tvec2 uvRepeat = vUv2 * vec2( tFloorRepeat );\n\tuvRepeat.y += zoomPower;\n\tvec4 iFloor = texture2D( tFloor, uvRepeat );\n\n\tvec4 uvDisp = vUv4;\n\tfloat dispValue = quality == 0.0 ? 0.0 : dispPower;\n\tuvDisp.x = uvDisp.x * ( 1.0 + ( iFloor.r * 2.0 - 0.75 ) * dispValue * (fogFactor) );\n\tuvDisp.y = uvDisp.y * ( 1.0 + ( iFloor.r * 2.0 - 1.0 ) * dispValue );\n\n\tvec4 iDisp = texture2DProj( tDiffuse, uvDisp );\n\tvec3 iColor = quality == 0.0 ? color.rgb : iFloor.rgb;\n\tvec4 iFin = vec4( vec3( mix( iDisp.rgb, iColor.rgb, 1.0 - dispAlpha ) ), 1.0 );\n\n\tgl_FragColor.rgb = iFin.rgb - ( vNoise * noiseAlpha );\n\tgl_FragColor.a = (1.0 - ( pow( fogFactor, fogPower ))) * pow( fogFactor, fogPower ) * alpha * 2.0;\n\n\t//\n\t// gl_FragColor = vec4(1.0,0.0,0.0,1.0);\n\n}",
        },
      })),
        this.mesh.rotateX(-Math.PI / 2),
        o.scene.add(this.mesh),
        (this.mesh.material.uniforms.tFloor.value =
          LOADER.textures.epoxyFloor.tex),
        this.onChangeGui(),
        (this.ready = !0));
    },
    onUpdate() {
      ((this.groundY = WEBGL.height * this.params.y * 0.1),
        (this.mesh.material.uniforms.color.value.r = COLOR.table.scene.three.r),
        (this.mesh.material.uniforms.color.value.g = COLOR.table.scene.three.g),
        (this.mesh.material.uniforms.color.value.b = COLOR.table.scene.three.b),
        (this.mesh.position.y = 0.5 * -o.screen.scale.y - this.groundY),
        (this.mesh.material.uniforms.zoomPower.value =
          0.3 * PAGE_TRANSITION.anim.ptHoverViewButton +
          PAGE_TRANSITION.mixAnim.ptZoom),
        (this.mesh.material.uniforms.time.value =
          GLOBAL_TIME * WEBGL.floor.params.speed * -0.001),
        (this.mesh.material.uniforms.quality.value = DESIGN.params.quality),
        (this.mesh.material.uniforms.noisePower.value =
          this.params.noisePower * SPLASH.params.ptNoisePower),
        (this.mesh.material.uniforms.curveOffset.value =
          this.params.curveOffset));
    },
    onResize() {
      (this.mesh
        .getRenderTarget()
        .setSize(WEBGL.gloablWidth, WEBGL.gloablHeight),
        (this.mesh.scale.x = WEBGL.width * this.scale),
        (this.mesh.scale.y = WEBGL.width * this.scale),
        WW <= MOBILE_WIDTH
          ? ((this.mesh.scale.x = WEBGL.width * (this.scale + 3)),
            (this.mesh.scale.y = WEBGL.width * (this.scale + 3)))
          : (WW, TABLET_WIDTH),
        (this.mesh.material.uniforms.resolution.value.x = this.mesh.scale.x),
        (this.mesh.material.uniforms.resolution.value.y = this.mesh.scale.y));
    },
    onChangeGui() {
      this.mesh &&
        ((this.mesh.material.uniforms.alpha.value = this.params.alpha),
        (this.mesh.material.uniforms.dispPower.value = this.params.dispPower),
        (this.mesh.material.uniforms.dispAlpha.value = this.params.dispAlpha),
        (this.mesh.material.uniforms.curvePower.value = this.params.curvePower),
        (this.mesh.material.uniforms.curveHeight.value =
          this.params.curveHeight),
        (this.mesh.material.uniforms.curveOffset.value =
          this.params.curveOffset),
        (this.mesh.material.uniforms.noiseQuality.value =
          this.params.noiseQuality),
        (this.mesh.material.uniforms.noisePer.value = this.params.noisePer),
        (this.mesh.material.uniforms.noiseSpeed.value = this.params.noiseSpeed),
        (this.mesh.material.uniforms.noisePower.value = this.params.noisePower),
        (this.mesh.material.uniforms.noiseAlpha.value = this.params.noiseAlpha),
        (this.mesh.material.uniforms.fogPower.value = this.params.fogPower),
        (this.mesh.material.uniforms.fogDensity.value = this.params.fogDensity),
        (this.mesh.material.uniforms.repeatFloor.value =
          this.params.repeatFloor));
    },
  };
}
