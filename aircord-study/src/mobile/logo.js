// Recovered responsive implementation. See PROVENANCE.md.
import * as THREE from "three";
export default function initialize() {
  "use strict";
  var n = THREE;
  WEBGL.logo = {
    ready: !1,
    visible: !0,
    geometry: null,
    material: { front: null, side: null },
    mesh: null,
    boundingBox: null,
    params: {
      scale: 0.32,
      front: { mousePower: 0, cnoiseDisp: 0.1, cnoisePower: 2, opacity: 1 },
      side: { cnoiseDisp: 0.8, cnoisePower: 2, colorPower: 2.5, opacity: 1 },
      translate: { x: 0, y: 1 },
      scroll: { opacity: 0.75, scale: 0.2 },
    },
    setForDevice() {
      (WW <= MOBILE_WIDTH
        ? ((this.params.translate.y = 2.5), (this.params.scale = 0.225))
        : WW <= TABLET_WIDTH &&
          !IS_LANDSCAPE &&
          ((this.params.translate.y = 2.5), (this.params.scale = 0.3)),
        DETECT.device.any &&
          ((this.params.scroll.opacity = 1), (this.params.scroll.scale = 0.4)));
    },
    once() {
      (this.setForDevice(),
        (this.stage = new n.Group()),
        this.onInitLogo(),
        this.onResize(),
        (this.ready = !0));
    },
    onInitLogo() {
      ((this.geometry = new TextGeometry("ai1co2d", {
        font: LOADER.fonts.logo.json,
        size: 2,
        height: 1,
        curveSegments: 1,
        bevelEnabled: !1,
        bevelThickness: 0,
        bevelSize: 0,
        bevelOffset: 0,
        bevelSegments: 0,
      })),
        this.geometry.computeBoundingBox());
      const t = new n.Vector3();
      (t
        .subVectors(
          this.geometry.boundingBox.max,
          this.geometry.boundingBox.min,
        )
        .multiplyScalar(-0.5),
        this.geometry.translate(t.x, 0, t.z),
        (this.material.front = new n.ShaderMaterial({
          transparent: !0,
          uniforms: {
            opacity: { value: 1 },
            alpha: { value: 1 },
            time: { value: 1 },
            mouse: { value: { x: 0, y: 0 } },
            tColor: { value: COLOR.table.logo.three },
            cnoiseDisp: { value: this.params.front.cnoiseDisp },
            cnoisePower: { value: this.params.front.cnoisePower },
            mousePower: { value: this.params.front.mousePower },
          },
          vertexShader:
            "#define GLSLIFY 1\nvarying vec2 vUv;\nvarying vec3 vNormal;\nvarying vec3 vViewPosition;\nvoid main() {\n\tvUv = uv;\n\tvNormal = normalize(normalMatrix * normal);\n\tvec4 mvPosition = modelViewMatrix * vec4(position, 1.0);\n\tvViewPosition = -mvPosition.xyz;\n\tgl_Position = projectionMatrix * mvPosition;\n}",
          fragmentShader:
            "#define GLSLIFY 1\nvarying vec2 vUv;\nvarying vec3 vNormal;\nvarying vec3 vViewPosition;\nuniform vec3 tColor;\nuniform float alpha;\nuniform float opacity;\nuniform float time;\nuniform vec2 mouse;\nuniform float cnoiseDisp;\nuniform float cnoisePower;\nuniform float mousePower;\nvec3 hash(vec3 p) {\n    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),\n             dot(p, vec3(269.5, 183.3, 246.1)),\n             dot(p, vec3(113.5, 271.9, 124.6)));\n    return -1.0 + 2.0 * fract(sin(p) * 43758.5453);\n}\n\nfloat cnoise(vec3 p) {\n    vec3 i = floor(p);\n    vec3 f = fract(p);\n    vec3 u = f * f * (3.0 - 2.0 * f);\n    float a = dot(hash(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0));\n    float b = dot(hash(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));\n    float c = dot(hash(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));\n    float d = dot(hash(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));\n    float e = dot(hash(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));\n    float f_val = dot(hash(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));\n    float g = dot(hash(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));\n    float h = dot(hash(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));\n    float k0 = mix(a, b, u.x);\n    float k1 = mix(c, d, u.x);\n    float k2 = mix(e, f_val, u.x);\n    float k3 = mix(g, h, u.x);\n    float l0 = mix(k0, k1, u.y);\n    float l1 = mix(k2, k3, u.y);\n    return mix(l0, l1, u.z);\n}\nvoid main() {\n\tfloat dist = distance( normalize(vViewPosition).xy, mouse );\n\tfloat glow = smoothstep( 1.0, mousePower, dist ); \n\tfloat g = glow + clamp( cnoise( vec3( vec2( vUv * cnoiseDisp ), time ) ) * cnoisePower, 0.0, 1.0 );\n\tgl_FragColor = vec4( tColor.rgb, g * alpha * opacity );\n}",
        })),
        (this.material.side = new n.ShaderMaterial({
          side: n.DoubleSide,
          transparent: !0,
          depthTest: !1,
          uniforms: {
            opacity: { value: 1 },
            alpha: { value: 1 },
            time: { value: 1 },
            mouse: { value: { x: 0, y: 0 } },
            tColor: { value: COLOR.table.logo.three },
            cnoiseDisp: { value: this.params.side.cnoiseDisp },
            cnoisePower: { value: this.params.side.cnoisePower },
            colorPower: { value: this.params.side.colorPower },
          },
          vertexShader:
            "#define GLSLIFY 1\nvarying vec2 vUv;\nvarying vec3 vNormal;\nvarying vec3 vViewPosition;\nvoid main() {\n\tvUv = uv;\n\tvNormal = normalize(normalMatrix * normal);\n\tvec4 mvPosition = modelViewMatrix * vec4(position, 1.0);\n\tvViewPosition = -mvPosition.xyz;\n\tgl_Position = projectionMatrix * mvPosition;\n}",
          fragmentShader:
            "#define GLSLIFY 1\nvarying vec2 vUv;\nvarying vec3 vNormal;\nvarying vec3 vViewPosition;\nuniform vec3 tColor;\nuniform float alpha;\nuniform float opacity;\nuniform float time;\nuniform sampler2D tDiffuse;\nvec3 hash(vec3 p) {\n    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),\n             dot(p, vec3(269.5, 183.3, 246.1)),\n             dot(p, vec3(113.5, 271.9, 124.6)));\n    return -1.0 + 2.0 * fract(sin(p) * 43758.5453);\n}\n\nfloat cnoise(vec3 p) {\n    vec3 i = floor(p);\n    vec3 f = fract(p);\n    vec3 u = f * f * (3.0 - 2.0 * f);\n    float a = dot(hash(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0));\n    float b = dot(hash(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));\n    float c = dot(hash(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));\n    float d = dot(hash(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));\n    float e = dot(hash(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));\n    float f_val = dot(hash(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));\n    float g = dot(hash(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));\n    float h = dot(hash(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));\n    float k0 = mix(a, b, u.x);\n    float k1 = mix(c, d, u.x);\n    float k2 = mix(e, f_val, u.x);\n    float k3 = mix(g, h, u.x);\n    float l0 = mix(k0, k1, u.y);\n    float l1 = mix(k2, k3, u.y);\n    return mix(l0, l1, u.z);\n}\nuniform float cnoiseDisp;\nuniform float cnoisePower;\nuniform float colorPower;\n\nvoid main() {\n\n\tfloat noise = cnoise( vec3( vec2( vUv * cnoiseDisp ), time ));\n\tfloat emphasizedNoise = noise * (1.0 - noise) * cnoisePower; // 0近くと1近くで強調\n\n\tfloat col = sin(1.0 - vUv.y) * sin(vUv.x);\n\tfloat a = clamp( ( col + clamp( noise, 0.0, 0.5 ) ) * alpha, 0.2, 1.0 );\n\tcol = col + emphasizedNoise;\n\n\tfloat offsetStrength = length( sin(vUv) - 0.5) * colorPower;\n\tvec3 originalColor = tColor * clamp(col, 0.0, 1.0);\n\n\tvec3 offsetR = vec3(0.1, -0.05, -0.05) * offsetStrength;\n\tvec3 offsetG = vec3(-0.05, 0.1, -0.05) * offsetStrength;\n\tvec3 offsetB = vec3(-0.05, -0.05, 0.1) * offsetStrength;\n\n\tvec3 colorR = originalColor + offsetR;\n\tvec3 colorG = originalColor + offsetG;\n\tvec3 colorB = originalColor + offsetB;\n\n\tvec3 finalColor = mix( mix( colorR, colorB, vUv.y ), colorB, vUv.y );\n\tfinalColor = clamp( finalColor * finalColor + a, 0.2, 1.0 );\n\tgl_FragColor = vec4( finalColor, a * opacity );\n}",
        })),
        (this.mesh = new n.Mesh(this.geometry, [
          this.material.front,
          this.material.side,
        ])),
        (this.mesh.origin = {
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 0, y: 0, z: 0 },
        }),
        this.stage.add(this.mesh),
        WEBGL.scene.add(this.stage));
    },
    onResize() {
      (this.geometry.computeBoundingBox(),
        (this.mesh.origin.scale.x = 0.1 * WEBGL.width * this.params.scale),
        (this.mesh.origin.scale.y = 0.1 * WEBGL.width * this.params.scale),
        (this.mesh.origin.scale.z = 0.3 * WEBGL.width * this.params.scale),
        (this.mesh.scale.x = this.mesh.origin.scale.x),
        (this.mesh.scale.y = this.mesh.origin.scale.y),
        (this.mesh.scale.z = this.mesh.origin.scale.z));
    },
    onUpdate() {
      if ((this.onUpdateForTransition(), !this.stage.visible)) return !1;
      this.mesh &&
        (this.material.front.uniforms &&
          (DETECT.device.any ||
            ((this.material.front.uniforms.mouse.value.x =
              -MOUSE.body.array[1].shader.x),
            (this.material.front.uniforms.mouse.value.y =
              -MOUSE.body.array[1].shader.y)),
          (this.material.front.uniforms.time.value = 0.005 * GLOBAL_TIME)),
        this.material.side.uniforms &&
          ((this.material.side.uniforms.time.value = 0.005 * GLOBAL_TIME),
          (this.material.side.uniforms.colorPower.value =
            this.params.side.colorPower * COLOR.power.dark)));
    },
    scroll: { y: 0, p: 0 },
    onScroll(t, e) {
      ((this.scroll.y = t), (this.scroll.p = e));
    },
    onReset() {
      ((this.scroll.y = 0), (this.scroll.p = 0));
    },
    onUpdateForTransition() {
      const t = WEBGL.width * PAGE_TRANSITION.logo.radius,
        e = (PAGE_TRANSITION.mixAnim.ptShowLogo - 1) * PAGE_TRANSITION.logo.deg;
      if (e < -17.5) this.visible = !1;
      else {
        this.visible = !0;
        const i = e * (Math.PI / 180),
          n = t * Math.cos(i) - t,
          r = t * Math.sin(i);
        ((this.mesh.rotation.x = -i * PAGE_TRANSITION.anim.ptLogoOpacity),
          (this.mesh.rotation.y =
            -i * PAGE_TRANSITION.anim.ptLogoOpacity * 0.5));
        let s = clamp(
          1 - 1.75 * (1 - PAGE_TRANSITION.mixAnim.ptShowLogo),
          0,
          1,
        );
        (PAGE_TRANSITION.isZoomOutToHome || PAGE_TRANSITION.isZoomInToAbout) &&
          (s = clamp(1 - 1.2 * (1 - PAGE_TRANSITION.mixAnim.ptShowLogo), 0, 1));
        let o = 1;
        (DETECT.device.any
          ? ((this.mesh.rotation.z =
              PAGE_TRANSITION.mixAnim.ptShowLogo *
              (10 * this.scroll.p * (Math.PI / 180))),
            (o = 1.25))
          : (this.mesh.rotation.z =
              PAGE_TRANSITION.mixAnim.ptShowLogo *
                (10 * this.scroll.p * (Math.PI / 180)) +
              PAGE_TRANSITION.mixAnim.ptShowLogo *
                MOUSE.body.array[0].acceleration.delta.x *
                3 *
                (Math.PI / 180)),
          (this.mesh.scale.x =
            this.mesh.origin.scale.x *
            s *
            (1 +
              this.scroll.p * o * this.params.scroll.scale +
              0.666 * PAGE_TRANSITION.page.error.ptWebGl)),
          (this.mesh.scale.y =
            this.mesh.origin.scale.y *
            s *
            (1 +
              this.scroll.p * o * this.params.scroll.scale +
              0.666 * PAGE_TRANSITION.page.error.ptWebGl)),
          (this.mesh.scale.z =
            this.mesh.origin.scale.z *
            s *
            (1 +
              this.scroll.p * o * this.params.scroll.scale +
              0.666 * PAGE_TRANSITION.page.error.ptWebGl)));
        const a = -0.5 * (this.mesh.origin.scale.x - this.mesh.scale.x),
          l =
            -0.5 *
            this.mesh.scale.y *
            (this.geometry.boundingBox.max.y - this.geometry.boundingBox.min.y);
        ((this.mesh.position.x =
          this.mesh.scale.x * this.params.translate.x + a),
          (this.mesh.position.y =
            this.mesh.scale.y * this.params.translate.y +
            l +
            0.5 * n +
            PAGE_TRANSITION.mixAnim.ptShowLogo *
              clamp(this.scroll.p * WEBGL.height, 0, 0.2 * WEBGL.height)),
          (this.mesh.position.z =
            -r -
            PAGE_TRANSITION.mixAnim.ptShowLogo *
              clamp(this.scroll.p * WEBGL.height, 0, 0.1 * WEBGL.height)),
          (this.material.front.uniforms.opacity.value =
            PAGE_TRANSITION.anim.ptLogoOpacity -
            PAGE_TRANSITION.mixAnim.ptShowLogo *
              clamp(this.scroll.p * this.params.scroll.opacity, 0, 0.9) -
            0.9 * PAGE_TRANSITION.page.error.ptWebGl),
          (this.material.side.uniforms.opacity.value =
            PAGE_TRANSITION.anim.ptLogoOpacity -
            PAGE_TRANSITION.mixAnim.ptShowLogo *
              clamp(this.scroll.p * this.params.scroll.opacity, 0, 0.9) -
            0.9 * PAGE_TRANSITION.page.error.ptWebGl));
      }
      this.stage && (this.stage.visible = this.visible);
    },
  };
}
