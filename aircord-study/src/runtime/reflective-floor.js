// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";
import shader1 from "../shaders/reflective-floor-1.glsl?raw";
import shader2 from "../shaders/reflective-floor-2.glsl?raw";

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
        a = void 0 !== e.color ? new n.Color(e.color) : new n.Color(8355711),
        o = e.textureWidth || 512,
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
        (this.renderTarget = new n.WebGLRenderTarget(o, l, {
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
        (w.uniforms.color.value = a),
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
          const a = this.position.y,
            o = r.position.y > a,
            l = new n.Vector3(0, o ? 1 : -1, 0).applyMatrix4(g),
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
  var a = THREE;
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
      let t = new a.PlaneGeometry(1, 1, this.segmentW, this.segmentH);
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
          vertexShader: shader1,
          fragmentShader: shader2,
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
      ((this.textures.floorFront.tex = new a.TextureLoader().load(e)),
        (this.textures.floorFront.tex.wrapS = a.RepeatWrapping),
        (this.textures.floorFront.tex.wrapT = a.RepeatWrapping),
        (this.ground.material.uniforms.tFloor.value =
          this.textures.floorFront.tex));
      let i = getSrc(
        this.textures.floorBack.src.d1x,
        this.textures.floorBack.src.d2x,
        this.textures.floorBack.src.mob,
        this.textures.floorBack.src.d1x,
        !0,
      );
      ((this.textures.floorBack.tex = new a.TextureLoader().load(i)),
        (this.textures.floorBack.tex.wrapS = a.RepeatWrapping),
        (this.textures.floorBack.tex.wrapT = a.RepeatWrapping),
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
