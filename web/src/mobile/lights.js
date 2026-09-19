// Recovered responsive implementation. See PROVENANCE.md.
import * as THREE from "three";
export default function initialize() {
  "use strict";
  var n = THREE;
  class r {
    constructor(t = {}) {
      ((this.props = t),
        (this.shaderDepth = "R8G8B8A8"),
        (this.edgeConstrast = "SMOOTH"),
        (this.vertexShader =
          "#define GLSLIFY 1\nvarying vec3 vNormal;\nvarying vec3 vWorldPosition;\nvoid main() {\n\tvNormal = normalize(normalMatrix * normal);\n\tvec4 worldPosition = modelMatrix * vec4(position, 1.0);\n\tvWorldPosition = worldPosition.xyz;\n\tgl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}"),
        (this.isR8 = "R8" === this.shaderDepth ? "#define DEPTH_R8" : ""),
        (this.isR8G8B8A8 =
          "R8G8B8A8" === this.shaderDepth ? "#define DEPTH_R8G8B8A8" : ""),
        (this.isLINEAR =
          "LINEAR" === this.edgeConstrast
            ? "#define EDGE_CONSTRAST_LINEAR"
            : ""),
        (this.isSMOOTH =
          "SMOOTH" === this.edgeConstrast
            ? "#define EDGE_CONSTRAST_SMOOTH"
            : ""),
        (this.fragmentShader = `\n\t\t${this.isR8}\n\t\t${this.isR8G8B8A8}\n\t\t${this.isLINEAR}\n\t\t${this.isSMOOTH}\n\t\t#define GLSLIFY 1\nvarying vec3 vNormal;\nvarying vec3 vWorldPosition;\nuniform vec3 lightColor;\nuniform vec3 spotPosition;\nuniform sampler2D tDepth;\nuniform float attenuation;\nuniform float anglePower;\nuniform float edgeScale;\nuniform float edgeConstractPower;\nuniform float screenWidth;\nuniform float screenHeight;\nuniform float cameraNear;\nuniform float cameraFar;\nuniform float alpha;\nuniform float time;\nuniform float wave;\nuniform float groundY;\n\n#ifdef DEPTH_R8G8B8A8\nfloat unpackDepth(const in vec4 rgba_depth) {\nconst vec4 bit_shift = vec4( 1.0 / ( 256.0 * 256.0 * 256.0 ), 1.0 / ( 256.0 * 256.0 ), 1.0 / 256.0, 1.0 );\nfloat depth = dot( rgba_depth, bit_shift );\nreturn depth;\n}\nvec4 pack_depth(const in float depth) {\nconst vec4 bit_shift = vec4( 256.0 * 256.0 * 256.0, 256.0 * 256.0, 256.0, 1.0 );\nconst vec4 bit_mask = vec4( 0.0, 1.0 / 256.0, 1.0 / 256.0, 1.0 / 256.0 );\nvec4 res = fract( depth * bit_shift );\nres -= res.xxyz * bit_mask;\nreturn res;\n}\n#endif\n\nvec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }\nvec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }\nvec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }\nvec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }\nvec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }\nfloat cnoise(vec3 P){vec3 Pi0 = floor(P); vec3 Pi1 = Pi0 + vec3(1.0); Pi0 = mod289(Pi0); Pi1 = mod289(Pi1); vec3 Pf0 = fract(P); vec3 Pf1 = Pf0 - vec3(1.0); vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x); vec4 iy = vec4(Pi0.yy, Pi1.yy); vec4 iz0 = Pi0.zzzz; vec4 iz1 = Pi1.zzzz; vec4 ixy = permute(permute(ix) + iy); vec4 ixy0 = permute(ixy + iz0); vec4 ixy1 = permute(ixy + iz1); vec4 gx0 = ixy0 * (1.0 / 7.0); vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5; gx0 = fract(gx0); vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0); vec4 sz0 = step(gz0, vec4(0.0)); gx0 -= sz0 * (step(0.0, gx0) - 0.5); gy0 -= sz0 * (step(0.0, gy0) - 0.5); vec4 gx1 = ixy1 * (1.0 / 7.0); vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5; gx1 = fract(gx1); vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1); vec4 sz1 = step(gz1, vec4(0.0)); gx1 -= sz1 * (step(0.0, gx1) - 0.5); gy1 -= sz1 * (step(0.0, gy1) - 0.5); vec3 g000 = vec3(gx0.x,gy0.x,gz0.x); vec3 g100 = vec3(gx0.y,gy0.y,gz0.y); vec3 g010 = vec3(gx0.z,gy0.z,gz0.z); vec3 g110 = vec3(gx0.w,gy0.w,gz0.w); vec3 g001 = vec3(gx1.x,gy1.x,gz1.x); vec3 g101 = vec3(gx1.y,gy1.y,gz1.y); vec3 g011 = vec3(gx1.z,gy1.z,gz1.z); vec3 g111 = vec3(gx1.w,gy1.w,gz1.w); vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110))); g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w; vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111))); g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w; float n000 = dot(g000, Pf0); float n100 = dot(g100, vec3(Pf1.x, Pf0.yz)); float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z)); float n110 = dot(g110, vec3(Pf1.xy, Pf0.z)); float n001 = dot(g001, vec3(Pf0.xy, Pf1.z)); float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z)); float n011 = dot(g011, vec3(Pf0.x, Pf1.yz)); float n111 = dot(g111, Pf1); vec3 fade_xyz = fade(Pf0); vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z); vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y); float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x); return 2.2 * n_xyz; }\n\nvoid main() {\n\n\tfloat spot = distance(vWorldPosition, spotPosition) / attenuation;\n\tfloat intensity = 1.0 - clamp(spot, 0.0, 1.0);\n\tvec3 normal = vec3(vNormal.x, vNormal.y, abs(vNormal.z));\n\n\tfloat angleIntensity = pow( dot(normal, vec3(0.0, 0.0, 1.0)), anglePower );\n\n\tintensity = intensity * angleIntensity;\n\n\tvec2 depthUV = vec2( gl_FragCoord.x / screenWidth, gl_FragCoord.y / screenHeight );\n\n\t#ifdef DEPTH_R8\n\tfloat sceneDepth = texture2D( tDepth, depthUV ).x;\n\tfloat fragDepth = gl_FragCoord.z / gl_FragCoord.w;\n\tfragDepth = 1.0 - smoothstep(cameraNear, cameraFar, fragDepth);\n\tfloat deltaDepth = abs(sceneDepth - fragDepth) * edgeScale;\n\tgl_FragColor = vec4(vec3(sceneDepth), 1.0);\n\t#endif\n\n\t#ifdef DEPTH_R8G8B8A8\n\tfloat sceneDepth = unpackDepth( texture2D( tDepth, depthUV ) );\n\tfloat fragDepth = gl_FragCoord.z / gl_FragCoord.w;\n\tfragDepth = 1.0 - smoothstep(cameraNear, cameraFar, fragDepth);\n\tfloat deltaDepth = abs(sceneDepth - fragDepth) * edgeScale;\n\tgl_FragColor = vec4(vec3(texture2D(tDepth, depthUV).r), 1.0);\n\t#endif\n\n\t#ifdef EDGE_CONSTRAST_LINEAR\n\tfloat edgeIntensity = clamp( deltaDepth, 0.0, 1.0);\n\t#endif\n\n\t#ifdef EDGE_CONSTRAST_SMOOTH\n\tfloat edgeIntensity = 0.5*pow(clamp(2.0*((deltaDepth > 0.5) ? 1.0-deltaDepth : deltaDepth), 0.0, 1.0), edgeConstractPower);\n\tedgeIntensity = ( deltaDepth > 0.5) ? 1.0-edgeIntensity : edgeIntensity;\n\t#endif\n\n\tfloat spotAlphaEnd = clamp( (1.0 - spot) * 3.0, 0.0, 1.0 );\n\tfloat spotAlphaStart = clamp( spot * 3.0 - 0.5, 0.0, 1.0 );\n\n\tfloat c1 = cnoise( vec3(normal.x * wave * 0.5, normal.y * wave, time ) ) + spotAlphaEnd;\n\tfloat sunAlpha = clamp( abs( pow( vWorldPosition.y - groundY, 1.0 ) ), 0.0, 1.0 );\n\tintensity = c1 * intensity * edgeIntensity * alpha * sunAlpha * spotAlphaStart;\n\tgl_FragColor = vec4( lightColor, intensity );\n}`),
        (this.material = new n.ShaderMaterial({
          uniforms: {
            time: { value: 0 },
            wave: { value: this.props.wave },
            alpha: { value: this.props.alpha },
            attenuation: { value: this.props.attenuation },
            anglePower: { value: this.props.anglePower },
            edgeScale: {
              value:
                "R8" === this.shaderDepth
                  ? 20
                  : "R8G8B8A8" === this.shaderDepth
                    ? 200
                    : void 0,
            },
            edgeConstractPower:
              "SMOOTH" === this.edgeConstrast
                ? { value: this.props.edgeConstractPower }
                : void 0,
            cameraNear: { value: 0 },
            cameraFar: { value: 0 },
            screenWidth: { value: window.innerWidth },
            screenHeight: { value: window.innerHeight },
            spotPosition: { value: { x: 0, y: 0, z: 0 } },
            tDepth: { value: null },
            lightColor: { value: COLOR.table.volume.three },
            groundY: { value: 0 },
          },
          vertexShader: this.vertexShader,
          fragmentShader: this.fragmentShader,
          transparent: !0,
          depthWrite: !1,
          depthTest: !0,
        })));
    }
    onUpdate() {
      ((this.material.uniforms.attenuation.value = this.props.attenuation),
        (this.material.uniforms.anglePower.value = this.props.anglePower),
        (this.material.uniforms.edgeConstractPower =
          "SMOOTH" === this.edgeConstrast
            ? { value: this.props.edgeConstractPower }
            : void 0),
        (this.material.uniforms.lightColor.value = COLOR.table.volume.three));
    }
  }
  var s = THREE;
  class o {
    constructor(t = {}) {
      ((this.props = t),
        (this.position = t.position ? t.position : { x: 0, y: 0, z: 0 }),
        (this.lookAt = t.lookAt ? t.lookAt : { x: 0, y: 0, z: 0 }),
        (this.distance = t.distance ? t.distance : WEBGL.width),
        (this.target = new s.Vector3(0, 0, 0)),
        (this.useLight =
          !t || void 0 === this.props.useLight || this.props.useLight),
        (this.temp = void 0 !== t.temp && t.temp),
        (this.scene = this.props.scene || WEBGL.scene),
        this.onInitSpotLight(),
        this.onInitVolumeLight(),
        this.onResize());
    }
    onInitPivot() {
      ((this.pivotGeometry = new s.SphereGeometry(1)),
        (this.pivotMaterial = new s.MeshBasicMaterial({ color: this.color })),
        (this.pivot = new s.Mesh(this.pivotGeometry, this.pivotMaterial)),
        (this.pivot.scale.x = 0.1),
        (this.pivot.scale.y = 0.1),
        (this.pivot.scale.z = 0.1),
        WEBGL.scene.add(this.pivot));
    }
    onInitSpotLight() {
      if (this.temp) {
        const t = new s.CylinderGeometry(1, 1, 1, 1),
          e = new s.ShaderMaterial({
            vertexShader:
              " void main() {gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); } ",
            fragmentShader:
              " void main() {gl_FragColor = vec4( 0.0, 0.0, 0.0, 0.0); } ",
          });
        ((this.light = new s.Mesh(t, e)), (this.light.visible = !1));
      } else
        this.light = new s.SpotLight(
          COLOR.table.light.three,
          2,
          WEBGL.width / 2,
        );
      ((this.light.angle = isNumber(this.props.angle)
        ? this.props.angle * (Math.PI / 180)
        : (Math.PI / 180) * 20),
        (this.light.penumbra = isNumber(this.props.penumbra)
          ? this.props.penumbra
          : 1),
        (this.light.decay = isNumber(this.props.decay) ? this.props.decay : 2),
        (this.light.intensity = isNumber(this.props.intensity)
          ? this.props.intensity
          : 5),
        this.light.lookAt(this.target.x, this.target.y, this.target.z),
        this.scene.add(this.light));
    }
    onInitVolumeLight() {
      ((this.volumeHeight = this.distance * WEBGL.screen.params.radius),
        (this.volumeRadiusBottom =
          this.volumeHeight * Math.tan(this.light.angle)),
        (this.volumeRadiusTop = 0),
        (this.volumeGeometry = new s.CylinderGeometry(
          this.volumeRadiusTop,
          this.volumeRadiusBottom,
          this.volumeHeight,
          128,
          20,
          !0,
        )),
        this.volumeGeometry.translate(
          0,
          -this.volumeGeometry.parameters.height / 2,
          0,
        ),
        this.volumeGeometry.rotateX(-Math.PI / 2),
        (this.volumeMaterial = new r({
          alpha: isNumber(this.props.uniforms.alpha)
            ? this.props.uniforms.alpha
            : 0.5,
          wave: isNumber(this.props.uniforms.wave)
            ? this.props.uniforms.wave
            : 5,
          speed: isNumber(this.props.uniforms.speed)
            ? this.props.uniforms.speed
            : 0.1,
          attenuation: isNumber(this.props.uniforms.attenuation)
            ? this.props.uniforms.attenuation
            : 6,
          anglePower: isNumber(this.props.uniforms.anglePower)
            ? this.props.uniforms.anglePower
            : 5,
          edgeConstractPower: isNumber(this.props.uniforms.edgeConstractPower)
            ? this.props.uniforms.edgeConstractPower
            : 1.5,
        })),
        (this.volume = new s.Mesh(
          this.volumeGeometry,
          this.volumeMaterial.material,
        )),
        (this.volume.renderOrder = 3),
        this.volume.lookAt(this.target),
        this.scene.add(this.volume),
        (this.cylinderCenter = this.volume.position),
        (this.cylinderDirection = new s.Vector3()
          .subVectors(this.target, this.volume.position)
          .normalize()));
    }
    onUpdate() {
      (this.light &&
        ((this.light.angle = isNumber(this.props.angle)
          ? this.props.angle * (Math.PI / 180)
          : (Math.PI / 180) * 20),
        (this.light.penumbra = isNumber(this.props.penumbra)
          ? this.props.penumbra
          : 1),
        (this.light.decay = isNumber(this.props.decay) ? this.props.decay : 2),
        (this.light.intensity = isNumber(this.props.intensity)
          ? this.props.intensity
          : 10),
        (this.light.color = COLOR.table.light.three)),
        this.onDestroyVolumeLight(),
        this.onInitVolumeLight());
    }
    onDestroyVolumeLight() {
      this.volume &&
        (this.scene.remove(this.volume),
        this.volumeGeometry &&
          (this.volumeGeometry.dispose(), (this.volumeGeometry = null)),
        this.volumeMaterial &&
          (this.volumeMaterial.material.dispose(),
          (this.volumeMaterial.material = null),
          (this.volumeMaterial.color = null),
          (this.volumeMaterial = null)),
        this.volume.geometry &&
          (this.volume.geometry.dispose(), (this.volume.geometry = null)),
        this.volume.material &&
          (this.volume.material.dispose(),
          (this.volume.material.color = null),
          (this.volume.material = null)),
        (this.volume = null));
    }
    onResize() {
      ((this.target.x = this.lookAt.x * WEBGL.screen.params.radius),
        (this.target.y = this.lookAt.y * WEBGL.screen.params.radius),
        (this.target.z = this.lookAt.z * WEBGL.screen.params.radius),
        this.light &&
          ((this.light.position.x =
            this.position.x * WEBGL.screen.params.radius),
          (this.light.position.y =
            this.position.y * WEBGL.screen.params.radius),
          (this.light.position.z =
            this.position.z * WEBGL.screen.params.radius),
          (this.light.distance = this.distance * WEBGL.screen.params.radius),
          this.light.lookAt(this.target.x, this.target.y, this.target.z)),
        this.volume &&
          ((this.volume.position.x = this.light.position.x),
          (this.volume.position.y = this.light.position.y),
          (this.volume.position.z = this.light.position.z),
          (this.volume.material.uniforms.spotPosition.value.x =
            this.light.position.x),
          (this.volume.material.uniforms.spotPosition.value.y =
            this.light.position.y),
          (this.volume.material.uniforms.spotPosition.value.z =
            this.light.position.z),
          this.volume.lookAt(this.target.x, this.target.y, this.target.z)),
        this.pivot &&
          ((this.pivot.position.x = this.light.position.x),
          (this.pivot.position.y = this.light.position.y),
          (this.pivot.position.z = this.light.position.z)),
        (this.cylinderCenter = this.volume.position),
        (this.cylinderDirection = new s.Vector3()
          .subVectors(this.target, this.volume.position)
          .normalize()));
    }
  }
  var a = THREE;
  WEBGL.lights = {
    ready: !1,
    spotLights: [],
    once() {
      (this.onInitSpotLights(), (this.ready = !0), this.onResize());
    },
    sun: {
      mesh: null,
      angle: 60,
      penumbra: 1,
      decay: 2,
      intensity: { origin: 4, max: 5 },
    },
    onInitSpotLights() {
      let t;
      ((this.sun.mesh = new a.SpotLight(
        COLOR.table.light.hex,
        2,
        2 * WEBGL.width,
      )),
        (this.sun.mesh.angle = this.sun.angle * (Math.PI / 180)),
        (this.sun.mesh.penumbra = this.sun.penumbra),
        (this.sun.mesh.decay = this.sun.decay),
        (this.sun.mesh.intensity = this.sun.intensity.origin),
        WEBGL.scene.add(this.sun.mesh),
        DETECT.device.any ||
          ((t = new o({
            angle: 33,
            penumbra: 1,
            decay: 2,
            intensity: 1,
            position: { x: 1.1, y: 0.6, z: 0.4 },
            lookAt: { x: 0.2, y: -0.1, z: 0 },
            distance: 3,
            uniforms: {
              speed: 0.05,
              alpha: 0.4,
              wave: 4.5,
              attenuation: 11,
              anglePower: 5,
            },
          })),
          this.spotLights.push({ name: "SPOT_LIGHT_2_1", light: t }),
          (t = new o({
            temp: !0,
            angle: 30,
            penumbra: 1,
            decay: 2,
            intensity: 1,
            position: { x: -1.4, y: 0.7, z: -0.4 },
            lookAt: { x: -0.4, y: 0, z: -0.4 },
            distance: 5,
            uniforms: {
              speed: 0.05,
              alpha: 0.4,
              wave: 4.5,
              attenuation: 15,
              anglePower: 5,
            },
          })),
          this.spotLights.push({ name: "SPOT_LIGHT_2_2", light: t })));
    },
    onResize() {
      for (let t = 0; t < this.spotLights.length; t++) {
        const e = this.spotLights[t];
        e.light && e.light.onResize();
      }
    },
    onUpdate() {
      this.sun.mesh &&
        ((this.sun.mesh.position.x = 0),
        (this.sun.mesh.position.y =
          1 * WEBGL.screen.params.radius +
          0.5 *
            WEBGL.screen.params.radius *
            PAGE_TRANSITION.page.single.ptWebGl),
        (this.sun.mesh.position.z = 0.5 * WEBGL.screen.params.radius),
        (this.sun.mesh.distance = 12 * WEBGL.screen.params.radius),
        (this.sun.mesh.intensity =
          this.sun.intensity.origin +
          (this.sun.intensity.max - this.sun.intensity.origin) *
            (1 - PAGE_TRANSITION.mixAnim.ptZoom)),
        this.sun.intensity.max,
        this.sun.intensity.origin,
        PAGE_TRANSITION.page.single.ptWebGl);
      for (let t = 0; t < this.spotLights.length; t++) {
        const e = this.spotLights[t];
        if (COLOR.power.dark >= 0.1) {
          e.light.volume.visible = !0;
          const t = e.light.volumeMaterial,
            i = t.material;
          ((i.uniforms.cameraNear.value =
            WEBGL.scenes.cameras.models.camera.near),
            (i.uniforms.cameraFar.value =
              2 * WEBGL.scenes.cameras.models.camera.far),
            (i.uniforms.alpha.value =
              t.props.alpha *
              PAGE_TRANSITION.mixAnim.ptZoom *
              (1 - PAGE_TRANSITION.page.single.ptWebGl)),
            (i.uniforms.time.value = 0.1 * GLOBAL_TIME * t.props.speed),
            WEBGL.floor.ready &&
              (i.uniforms.groundY.value = WEBGL.floor.ground.position.y));
        } else e.light.volume.visible = !1;
      }
    },
  };
}
