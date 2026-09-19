// Recovered responsive implementation. See PROVENANCE.md.
import * as THREE from "three";
export default function initialize() {
  "use strict";
  var n = THREE,
    r = THREE;
  class s extends n.Mesh {
    constructor(t, e = {}) {
      (super(t, e),
        (this.isReflector = !0),
        (this.type = "ReflectorMesh"),
        (this.camera = e.camera ? e.camera : new n.PerspectiveCamera()));
      const i = this,
        o = void 0 !== e.color ? new n.Color(e.color) : new n.Color(8355711),
        a = e.textureWidth || 512,
        l = e.textureHeight || 512,
        h = e.clipBias || 0,
        c = e.shader || s.ReflectorShader,
        u = void 0 !== e.multisample ? e.multisample : 1,
        d = new n.Plane(),
        p = new n.Vector3(),
        m = new n.Vector3(),
        f = new n.Vector3(),
        g = new n.Matrix4(),
        v = new n.Vector3(0, 0, -1),
        _ = new n.Vector4(),
        y = new n.Vector3(),
        x = new n.Vector3(),
        S = new n.Vector4();
      ((this.textureMatrix = new n.Matrix4()),
        (this.virtualCamera = this.camera),
        (this.renderTarget = new n.WebGLRenderTarget(a, l, {
          samples: u,
          type: n.HalfFloatType,
        })));
      const w = new n.ShaderMaterial({
        transparent: !0,
        name: void 0 !== c.name ? c.name : "unspecified",
        uniforms: n.UniformsUtils.clone(c.uniforms),
        fragmentShader: c.fragmentShader,
        vertexShader: c.vertexShader,
        side: r.DoubleSide,
      });
      ((w.uniforms.tDiffuse.value = this.renderTarget.texture),
        (w.uniforms.color.value = o),
        (w.uniforms.textureMatrix.value = this.textureMatrix),
        (w.uniforms.dotProduct.value = 0),
        (w.uniforms.dotView.value = 0),
        (this.material = w),
        (w.depthTest = !1),
        (this.onBeforeRender = (t, e, r) => {
          (m.setFromMatrixPosition(i.matrixWorld),
            f.setFromMatrixPosition(r.matrixWorld),
            g.extractRotation(i.matrixWorld),
            p.set(0, 0, 1),
            p.applyMatrix4(g),
            y.subVectors(m, f));
          const s = new n.Vector3().setFromMatrixColumn(r.matrixWorld, 2);
          s.negate();
          const o = this.position.y,
            a = r.position.y > o,
            l = new n.Vector3(0, a ? 1 : -1, 0).applyMatrix4(g),
            h = s.dot(l);
          ((w.uniforms.dotView.value = h),
            h < 0
              ? ((w.uniforms.dotProduct.value = 1 + h),
                this.onBeforeRenderForUnderWater(t, e, r))
              : ((w.uniforms.dotProduct.value = 1 - h),
                this.onBeforeRenderForMirror(t, e, r)),
            (i.visible = !1));
          const c = t.getRenderTarget();
          ((t.xr.enabled = !1),
            (t.shadowMap.autoUpdate = !1),
            t.setRenderTarget(this.renderTarget),
            t.state.buffers.depth.setMask(!0),
            !1 === t.autoClear && t.clear(),
            t.render(e, this.virtualCamera),
            t.setRenderTarget(c));
          const u = r.viewport;
          (void 0 !== u && t.state.viewport(u), (i.visible = !0));
        }),
        (this.onBeforeRenderForUnderWater = (t, e, n) => {
          (y.add(m),
            g.extractRotation(n.matrixWorld),
            v.set(0, 0, -1),
            v.applyMatrix4(g),
            v.add(f),
            x.add(m),
            this.virtualCamera.position.copy(n.position),
            this.virtualCamera.lookAt(m),
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
            this.textureMatrix.multiply(i.matrixWorld));
        }),
        (this.onBeforeRenderForMirror = (t, e, n) => {
          if (y.dot(p) > 0) return;
          (y.reflect(p).negate(),
            y.add(m),
            g.extractRotation(n.matrixWorld),
            v.set(0, 0, -1),
            v.applyMatrix4(g),
            v.add(f),
            x.subVectors(m, v),
            x.reflect(p).negate(),
            x.add(m),
            this.virtualCamera.position.copy(y),
            this.virtualCamera.up.set(0, 1, 0),
            this.virtualCamera.up.applyMatrix4(g),
            this.virtualCamera.up.reflect(p),
            this.virtualCamera.lookAt(x),
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
            d.setFromNormalAndCoplanarPoint(p, m),
            d.applyMatrix4(this.virtualCamera.matrixWorldInverse),
            _.set(d.normal.x, d.normal.y, d.normal.z, d.constant));
          const r = this.virtualCamera.projectionMatrix;
          ((S.x = (Math.sign(_.x) + r.elements[8]) / r.elements[0]),
            (S.y = (Math.sign(_.y) + r.elements[9]) / r.elements[5]),
            (S.z = -1),
            (S.w = (1 + r.elements[10]) / r.elements[14]),
            _.multiplyScalar(2 / _.dot(S)),
            (r.elements[2] = _.x),
            (r.elements[6] = _.y),
            (r.elements[10] = _.z + 1 - h),
            (r.elements[14] = _.w));
        }),
        (this.getRenderTarget = () => this.renderTarget),
        (this.dispose = () => {
          (this.renderTarget.dispose(), i.material.dispose());
        }));
    }
  }
  var o = THREE;
  WEBGL.floor = {
    scale: 3,
    segmentW: 128,
    segmentH: 128,
    ready: !1,
    mesh: null,
    textures: {
      floorFront: {
        src: {
          d2x: CDN_ASSETS_URL + "/tex/512/floorFront.jpg",
          d1x: CDN_ASSETS_URL + "/tex/512/floorFront.jpg",
          mob: CDN_ASSETS_URL + "/tex/512/floorFront.jpg",
        },
        tex: null,
      },
      floorBack: {
        src: {
          d2x: CDN_ASSETS_URL + "/tex/512/floorBack.jpg",
          d1x: CDN_ASSETS_URL + "/tex/512/floorBack.jpg",
          mob: CDN_ASSETS_URL + "/tex/512/floorBack.jpg",
        },
        tex: null,
      },
    },
    params: {
      dispPower: 0.5,
      blurPower: 0.025,
      alpha: 1,
      fadePower: 0.2,
      fadePowerPower: 20,
      cnoiseDisp: 0.4,
      cnoiseHeight: 0.41,
      cnoiseAlpha: 0.4,
      speed: 8,
      fogDensity: 0.6,
      repeatFloor: 60,
      repeatWater: 3,
      wave: -1,
      translate: { y: 0 },
      position: { y: -1.1 },
    },
    setForDevice() {
      DETECT.device.any &&
        ((this.params.speed = 4), (this.params.fadePowerPower = 40));
    },
    once() {
      (this.setForDevice(),
        this.onInitMirror(),
        this.onResize(),
        this.onChangeGui(),
        (this.ready = !0));
    },
    onInitMirror() {
      let t = new o.PlaneGeometry(1, 1, this.segmentW, this.segmentH);
      ((this.ground = new s(t, {
        clipBias: 1e-4,
        color: COLOR.table.bg.three,
        multisample: 1,
        shader: {
          name: "ReflectorMeshShader",
          uniforms: {
            danmenColor: { value: COLOR.table.danmen.three },
            color: { value: COLOR.table.bg.three },
            time: { value: 0 },
            alpha: { value: 1 },
            tDiffuse: { value: null },
            tFloor: { value: null },
            tWater: { value: null },
            dispPower: { value: 0 },
            blurPower: { value: 0.1 },
            fadePower: { value: 0.1 },
            fadePowerPower: { value: 0.1 },
            cnoiseDisp: { value: 0.2 },
            cnoiseHeight: { value: 0.5 },
            cnoiseAlpha: { value: 0.5 },
            fogDensity: { value: 0.75 },
            curveEffect: { value: 0 },
            repeatFloor: { value: 60 },
            repeatWater: { value: 60 },
            uv_resolution: { value: { x: 1, y: 1 } },
            textureMatrix: { value: null },
            dotProduct: { value: 0 },
            dotView: { value: 0 },
            frontfaceAlphaPower: { value: 1 },
            backfaceAlphaPower: { value: 0 },
          },
          vertexShader:
            "#define GLSLIFY 1\nuniform float time;\nuniform mat4 textureMatrix;\nvarying vec4 vUv4;\nvarying vec2 vUv2;\nvarying vec3 vNormal;\nvarying vec3 vViewPosition;\nuniform vec2 uv_resolution;\nuniform float cnoiseDisp;\nuniform float cnoiseHeight;\nuniform float cnoiseAlpha;\nvarying float vNoise;\nuniform float curveEffect;\nvec3 hash(vec3 p) {\n    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),\n             dot(p, vec3(269.5, 183.3, 246.1)),\n             dot(p, vec3(113.5, 271.9, 124.6)));\n    return -1.0 + 2.0 * fract(sin(p) * 43758.5453);\n}\n\nfloat cnoise(vec3 p) {\n    vec3 i = floor(p);\n    vec3 f = fract(p);\n    vec3 u = f * f * (3.0 - 2.0 * f);\n    float a = dot(hash(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0));\n    float b = dot(hash(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));\n    float c = dot(hash(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));\n    float d = dot(hash(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));\n    float e = dot(hash(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));\n    float f_val = dot(hash(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));\n    float g = dot(hash(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));\n    float h = dot(hash(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));\n    float k0 = mix(a, b, u.x);\n    float k1 = mix(c, d, u.x);\n    float k2 = mix(e, f_val, u.x);\n    float k3 = mix(g, h, u.x);\n    float l0 = mix(k0, k1, u.y);\n    float l1 = mix(k2, k3, u.y);\n    return mix(l0, l1, u.z);\n}\n#include <common>\n\nvoid main() {\n\n\tvUv2 = uv;\n\tvUv4 = textureMatrix * vec4( position, 1.0 );\n\tvec4 mvPosition = modelViewMatrix * vec4(position, 1.0);\n\tfloat curve = radians( vUv2.y * 180.0 - 90.0 );\n\tfloat curveCos = cos( curve );\n\tfloat curveRadius = uv_resolution.x * 0.5;\n\tfloat curvePower = vUv2.y >= 0.5 ? ( curveCos * curveRadius - curveRadius ) : 0.0;\n\tvNoise = clamp( ( cnoise( vec3( vec2( vUv2 * uv_resolution * cnoiseDisp ), time ) )) * cnoiseHeight, -1.0, 1.0 );\n\tmvPosition.y = mvPosition.y - vNoise + curvePower * curveEffect;\n\n\tif( vUv2.y <= 0.0 ){\n\t\tmvPosition.y = mvPosition.z;\n\t}\n\n\tvViewPosition = -mvPosition.xyz;\n\tvNormal = normalize(mat3(modelViewMatrix) * normal);\n\tgl_Position = projectionMatrix * mvPosition;\n\n}",
          fragmentShader:
            "#define GLSLIFY 1\nvarying vec2 vUv2;\nvarying vec4 vUv4;\nvarying vec3 vNormal;\nvarying vec3 vViewPosition;\n\nuniform vec3 color;\nuniform sampler2D tDiffuse;\nuniform sampler2D tFloor;\nuniform sampler2D tWater;\nuniform float dispPower;\nuniform float blurPower;\nuniform float alpha;\nuniform float time;\nuniform float fadePower;\nuniform float fadePowerPower;\nuniform float repeatWater;\nuniform float repeatFloor;\nuniform vec2 uv_resolution;\n\nuniform vec3 danmenColor;\n\nuniform float cnoiseDisp;\nuniform float cnoiseHeight;\nuniform float cnoiseAlpha;\nvarying float vNoise;\n\nuniform float fogDensity;\n\nuniform float dotView;\nuniform float dotProduct;\n\nuniform float backfaceAlphaPower;\nuniform float frontfaceAlphaPower;\n\nvoid main() {\n\n\tvec2 uvOffset = vec2(0.0, sin(time) * 0.05 );\n\tvec2 uvRepeat = vUv2 + uvOffset;\n\tvec4 iFloor = texture2D( tFloor, uvRepeat );\n\tvec4 iWater = texture2D( tWater, uvRepeat );\n\tvec4 iDisp  = gl_FrontFacing ? iFloor : iWater;\n\tfloat pDisp = gl_FrontFacing ? dispPower : dispPower * dotProduct * 2.0;\n\n\tvec4 uvDisp = vUv4;\n\tuvDisp.x = uvDisp.x * clamp( 0.9 + iDisp.r * pDisp * 0.1, 0.0, 1.0 ) + uvDisp.x * 0.06;\n\tuvDisp.y = uvDisp.y * clamp( 0.9 + iDisp.r * pDisp * 0.1, 0.0, 1.0 );\n\n\tfloat rad = radians( vUv2.x * 180. ) * 0.5;\n\tfloat fade = 1.0 - pow( sin( rad ) * ( vUv2.y - fadePower ), 2.0 );\n\tfade = clamp( pow( fade, fadePowerPower ), 0.0, 1.0 );\n\n\tvec4 bBase;\n\tbBase += texture2DProj( tDiffuse, vec4( uvDisp.x, uvDisp.y - 4.0 * blurPower * fade, uvDisp.zw ) ) * 0.051;\n\tbBase += texture2DProj( tDiffuse, vec4( uvDisp.x, uvDisp.y - 3.0 * blurPower * fade, uvDisp.zw ) ) * 0.0918;\n\tbBase += texture2DProj( tDiffuse, vec4( uvDisp.x, uvDisp.y - 2.0 * blurPower * fade, uvDisp.zw ) ) * 0.12245;\n\tbBase += texture2DProj( tDiffuse, vec4( uvDisp.x, uvDisp.y - 1.0 * blurPower * fade, uvDisp.zw ) ) * 0.1531;\n\tbBase += texture2DProj( tDiffuse, uvDisp ) * 0.1633;\n\n\tvec4 iFin = vec4( vec3( mix( bBase.rgb, color, fade ) ), 1.0 );\n\n\tfloat vFogDepth = 1.0 - vViewPosition.z;\n\tfloat fogFactor = exp( - ( fogDensity * 0.1 ) * ( fogDensity * 0.1 ) * vFogDepth * vFogDepth );\n\n\tvec4 iFin2 = iFin - vNoise * cnoiseAlpha;\n\tfloat iFinA = gl_FrontFacing ? alpha * fogFactor * frontfaceAlphaPower : fogFactor * backfaceAlphaPower;\n\tfloat a = gl_FrontFacing ? vViewPosition.z : vViewPosition.z - vNoise;\n\n\tfloat a2 = clamp( a, 0.0, 1.0 );\n\tvec4 rgba = ( vUv2.y <= 0.01 ) ? vec4( danmenColor, sin( vViewPosition.y ) ) : vec4( mix( color, iFin2.rgb, iFinA ), a2 );\n\tgl_FragColor = rgba;\n\n}",
        },
      })),
        this.ground.rotateX(-Math.PI / 2));
      let e = getSrc(
        this.textures.floorFront.src.d1x,
        this.textures.floorFront.src.d2x,
        this.textures.floorFront.src.mob,
        this.textures.floorFront.src.d1x,
        !0,
      );
      ((this.textures.floorFront.tex = new o.TextureLoader().load(e)),
        (this.textures.floorFront.tex.wrapS = o.RepeatWrapping),
        (this.textures.floorFront.tex.wrapT = o.RepeatWrapping),
        (this.ground.material.uniforms.tFloor.value =
          this.textures.floorFront.tex));
      let i = getSrc(
        this.textures.floorBack.src.d1x,
        this.textures.floorBack.src.d2x,
        this.textures.floorBack.src.mob,
        this.textures.floorBack.src.d1x,
        !0,
      );
      ((this.textures.floorBack.tex = new o.TextureLoader().load(i)),
        (this.textures.floorBack.tex.wrapS = o.RepeatWrapping),
        (this.textures.floorBack.tex.wrapT = o.RepeatWrapping),
        (this.ground.material.uniforms.tWater.value =
          this.textures.floorBack.tex),
        WEBGL.scene.add(this.ground));
    },
    onChangeGui() {
      ((this.ground.material.uniforms.alpha.value = this.params.alpha),
        (this.ground.material.uniforms.dispPower.value = this.params.dispPower),
        (this.ground.material.uniforms.blurPower.value = this.params.blurPower),
        (this.ground.material.uniforms.repeatFloor.value =
          this.params.repeatFloor),
        (this.ground.material.uniforms.repeatWater.value =
          this.params.repeatWater),
        (this.ground.material.uniforms.cnoiseDisp.value =
          this.params.cnoiseDisp),
        (this.ground.material.uniforms.cnoiseHeight.value =
          this.params.cnoiseHeight),
        (this.ground.material.uniforms.cnoiseAlpha.value =
          this.params.cnoiseAlpha),
        (this.ground.material.uniforms.fogDensity.value =
          this.params.fogDensity),
        (this.ground.material.uniforms.danmenColor.value =
          COLOR.table.danmen.three));
    },
    onUpdate() {
      (this.onUpdateBefore(), this.onUpdateForTransition());
    },
    onResize() {
      (this.ground
        .getRenderTarget()
        .setSize(WEBGL.gloablWidth, WEBGL.gloablHeight),
        (this.ground.scale.x = WEBGL.width * this.scale),
        (this.ground.scale.y = WEBGL.width * this.scale),
        (this.ground.material.uniforms.uv_resolution.value.x =
          this.ground.scale.x),
        (this.ground.material.uniforms.uv_resolution.value.y =
          this.ground.scale.y));
    },
    onUpdateBefore() {
      ((this.ground.material.uniforms.time.value =
        GLOBAL_TIME * this.params.speed * -0.001),
        (this.isUnderWater = this.ground.material.uniforms.dotView.value < 0),
        (this.ground.material.depthTest = !this.isUnderWater),
        (this.ground.material.uniforms.color.value.r = COLOR.table.bg.three.r),
        (this.ground.material.uniforms.color.value.g = COLOR.table.bg.three.g),
        (this.ground.material.uniforms.color.value.b = COLOR.table.bg.three.b),
        (this.ground.material.uniforms.fadePower.value =
          this.params.fadePower * COLOR.power.dark + COLOR.power.light),
        (this.ground.material.uniforms.fadePowerPower.value =
          this.params.fadePowerPower * COLOR.power.dark +
          this.params.fadePowerPower * COLOR.power.light * 0.05),
        (this.ground.material.uniforms.frontfaceAlphaPower.value =
          0.5 + 0.5 * COLOR.power.dark),
        (this.ground.material.uniforms.backfaceAlphaPower.value =
          1 + 1 * COLOR.power.dark),
        WEBGL.logo.mesh
          ? (this.ground.position.y =
              GROUND.y * (1 - PAGE_TRANSITION.mixAnim.ptShowLogo) +
              WEBGL.logo.mesh.scale.y *
                this.params.position.y *
                PAGE_TRANSITION.mixAnim.ptShowLogo)
          : (this.ground.position.y =
              GROUND.y * (1 - PAGE_TRANSITION.mixAnim.ptShowLogo)));
    },
    onUpdateForTransition() {
      this.ground.material.uniforms.curveEffect.value =
        PAGE_TRANSITION.mixAnim.ptCurveFloor;
    },
  };
}
