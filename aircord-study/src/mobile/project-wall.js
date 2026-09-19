// Recovered responsive implementation. See PROVENANCE.md.
import * as THREE from "three";
export default function initialize() {
  "use strict";
  var n = THREE;
  class r extends n.MeshStandardMaterial {
    constructor(t) {
      const {
        enterPower_010: e,
        enterPower_01_10: i,
        mouseEnterZ: n,
        mouseNoiseRatio: r,
        mouseNoiseDisp: s,
        mouseNoisePower: o,
        mouseNoiseDir: a,
        vigAlpha: l,
        cylinderCenter: h,
        cylinderDirection: c,
        cylinderRadiusTop: u,
        cylinderRadiusBottom: d,
        cylinderHeight: p,
        tvNoizePower: m,
        tvNoizeDisp: f,
        mozX: g,
        mozPower: v,
        fogAlpha: _,
        fogColor: y,
        data: x,
        dir: S,
        radius: w,
        width: E,
        height: T,
        rotate: b,
        angleRange: M,
        curvePower: A,
        zoomPower: P,
        borderWidth: R,
        resolution: L,
        offsetPower: C,
        i_resolution: I,
        ...N
      } = t;
      (super(N),
        (this.props = t),
        (this.anim = { enter: {}, leave: {} }),
        (this.userData.uniforms = {
          fogAlpha: { value: this.props.fogAlpha || 0 },
          fogColor: { value: this.props.fogColor || this.props.color },
          mozX: { value: this.props.mozX || 60 },
          mozPower: { value: this.props.mozPower },
          dir: { value: this.props.dir || 1 },
          radius: { value: this.props.radius || 0 },
          width: { value: this.props.width || 0 },
          height: { value: this.props.height || 0 },
          rotate: { value: this.props.rotate || 0 },
          angleRange: { value: this.props.angleRange || 0 },
          curvePower: { value: this.props.curvePower || 1 },
          zoomPower: { value: this.props.zoomPower || 0 },
          borderWidth: { value: this.props.borderWidth || 1 },
          resolution: { value: this.props.resolution || { x: 0, y: 0 } },
          offsetPower: { value: this.props.offsetPower || 0 },
          i_resolution: { value: this.props.i_resolution || { x: 0, y: 0 } },
          mouseEnterZ: { value: this.props.mouseEnterZ || 1 },
          enterPower_010: { value: this.props.enterPower_010 || 0 },
          enterPower_01_10: { value: this.props.enterPower_01_10 || 0 },
          tvNoizePower: { value: this.props.tvNoizePower || 0.05 },
          tvNoizeDisp: { value: this.props.tvNoizePower || 1024 },
          mouseNoiseRatio: { value: this.props.mouseNoiseRatio },
          mouseNoiseDisp: { value: this.props.mouseNoiseDisp },
          mouseNoisePower: { value: this.props.mouseNoisePower },
          mouseNoiseDir: { value: this.props.mouseNoiseDir },
          vigAlpha: { value: this.props.vigAlpha },
          cylinderCenter: { value: this.props.cylinderCenter },
          cylinderDirection: { value: this.props.cylinderDirection },
          cylinderRadiusTop: { value: this.props.cylinderRadiusTop },
          cylinderRadiusBottom: { value: this.props.cylinderRadiusBottom },
          cylinderHeight: { value: this.props.cylinderHeight },
        }),
        (this.onBeforeCompile = (t) => {
          (Object.assign(t.uniforms, this.userData.uniforms),
            (t.vertexShader =
              "#define GLSLIFY 1\nuniform float dir;\nuniform float radius;\nuniform float rotate;\nuniform float angleRange;\nuniform float curvePower;\nuniform float width;\nuniform float height;\nvarying vec2 vUv2;\nvec3 rotateAroundY(vec3 v, float angle) {\n    float sinA = sin(angle);\n    float cosA = cos(angle);\n    return vec3(\n        cosA * v.x + sinA * v.z,\n        v.y,\n        -sinA * v.x + cosA * v.z\n    );\n}\nvarying vec3 vNormal3;\nvarying float vFar;\n#define STANDARD\nvarying vec3 vViewPosition;\n#ifdef USE_TRANSMISSION\nvarying vec3 vWorldPosition;\n#endif\n#include <common>\n#include <uv_pars_vertex>\n#include <color_pars_vertex>\n#include <normal_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\n\nfloat noise(vec2 n) {\n\tconst vec2 d = vec2(0.0, 1.0);\n\tvec2 b = floor(n), f = smoothstep(vec2(0.0), vec2(1.0), fract(n));\n\treturn mix(mix(rand(b), rand(b + d.yx), f.x), mix(rand(b + d.xy), rand(b + d.yy), f.x), f.y);\n}\nmat2 rotate2d(float angle){ return mat2(cos(angle),-sin(angle),sin(angle),cos(angle)); }\n\nfloat gaussian(float x, float a, float b, float c) {\n    return a * exp(-pow((x - b), 2.0) / (2.0 * pow(c, 2.0)));\n}\n\nvoid main() {\n\n\tvUv2 = uv;\n\tvNormal3 = normal;\n\n\t#include <uv_vertex>\n\t#include <color_vertex>\n\t#include <morphcolor_vertex>\n\t#include <beginnormal_vertex>\n\t#include <defaultnormal_vertex>\n\t#include <normal_vertex>\n\t#include <begin_vertex>\n\tvec4 mvPosition = vec4( transformed, 1.0 );\n\t#ifdef USE_INSTANCING\n\tmvPosition = instanceMatrix * mvPosition;\n\t#endif\n\n\tfloat rotation = radians( rotate );  // 回転（radians）\n\tfloat angle = mix( 0.0, angleRange, position.x );\n\n\tfloat tx = mvPosition.x * width * (1.0 - curvePower) + ( 1.0 - curvePower ) + radius * sin(angle) * curvePower;\n\tfloat ty = mvPosition.y * height;\n\tfloat tz = position.z - radius * (1.0 - cos(angle)) * curvePower;\n\tvec3 newPos = vec3(tx, ty, tz);\n\tvec3 center = vec3(0.0, ty, -radius);\n\tvec3 offsetPos = newPos - center;\n\tvec3 rotatedPos = rotateAroundY(offsetPos, rotation);\n\tnewPos = rotatedPos + center;\n\n\tfloat zFar = newPos.z - center.z;\n\tvFar = clamp( (2.0 - ( 1.0 - (zFar / radius) )) * 5.0, 0.0, 1.0 );\n\tif( zFar <= 0.5 ){\n\t\tif( newPos.x <= 0.5 ){\n\t\t\tnewPos.x = ( -newPos.x - radius * 2.0 );\n\t\t} else {\n\t\t\tnewPos.x = ( -newPos.x + radius * 2.0 );\n\t\t}\n\t}\n\n\tmvPosition = modelViewMatrix * vec4(newPos, 1.0);\n\tgl_Position = projectionMatrix * mvPosition;\n\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n\tvViewPosition = - mvPosition.xyz;\n\t#include <worldpos_vertex>\n\t#ifdef USE_TRANSMISSION\n\tvWorldPosition = worldPosition.xyz;\n\t#endif\n\n}"),
            (t.fragmentShader =
              "#define GLSLIFY 1\nuniform vec3 fogColor;\nuniform float fogAlpha;\nuniform vec3 diffuse;\nuniform vec3 emissive;\nuniform float roughness;\nuniform float metalness;\nuniform float opacity;\nvarying vec2 vUv2;\nuniform float rotate;\nuniform float offsetPower;\nuniform vec2 resolution;\nuniform vec2 i_resolution;\nuniform float tvNoizePower;\nuniform float tvNoizeDisp;\nuniform float borderWidth;\nvarying vec3 vNormal3;\nvarying float vFar;\nvarying float vFadeFactor;\nuniform sampler2D poster;\nuniform float posterAlpha;\nuniform vec2  mouseNoiseDisp;\nuniform vec2  mouseNoisePower;\nuniform vec2  mouseNoiseDir;\nuniform float mouseNoiseRatio;\nuniform float vigAlpha;\nuniform float enterPower_010;\nuniform float enterPower_01_10;\nuniform float mozX;\nuniform float mozPower;\n#define STANDARD\n#ifdef PHYSICAL\n#define IOR\n#define USE_SPECULAR\n#endif\nvarying vec3 vViewPosition;\n#include <common>\n#include <packing>\n#include <color_pars_fragment>\n#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <lights_pars_begin>\n#include <normal_pars_fragment>\n#include <lights_physical_pars_fragment>\n#include <roughnessmap_pars_fragment>\n#include <metalnessmap_pars_fragment>\n#include <logdepthbuf_pars_fragment>\nfloat random(vec2 st) {\n\treturn fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);\n}\n\nvoid main() {\n\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n\tReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );\n\tvec3 totalEmissiveRadiance = emissive;\n\t#include <logdepthbuf_fragment>\n\n\tfloat dnutAlpha = 1.0;\n\tfloat aspect = resolution.x/resolution.y;\n\tvec2 adjustedUV = vUv2;\n\tadjustedUV.x *= aspect;\n\n\t#ifdef USE_MAP\n\n\t\tvec2 ratio = vec2(\n\t\t\tmin((resolution.x / resolution.y) / (i_resolution.x / i_resolution.y), 1.0),\n\t\t\tmin((resolution.y / resolution.x) / (i_resolution.y / i_resolution.x), 1.0)\n\t\t);\n\t\tvec2 uvCover = vec2(\n\t\t\tvMapUv.x * ratio.x + (1.0 - ratio.x) * 0.5,\n\t\t\tvMapUv.y * ratio.y + (1.0 - ratio.y) * 0.5\n\t\t);\n\n\t\tfloat offsetMix = offsetPower;\n\t    float angle = mod(rotate, 360.0) / 360.0;\n\t\tfloat a1 = step(0.0, angle) * step(angle, 0.25) * (-4.0 * angle);\n\t\tfloat a2 = step(0.25, angle) * step(angle, 0.5) * (-1.0 + 4.0 * (angle - 0.25));\n\t\tfloat a3 = step(0.5, angle) * step(angle, 0.75) * (4.0 * (angle - 0.5));\n\t\tfloat a4 = step(0.75, angle) * (1.0 - 4.0 * (angle - 0.75));\n\t\tfloat offset = a1 + a2 + a3 + a4;\n\t\tvec2 uvOffset = uvCover - vec2( offset * offsetMix, 0.0 );\n\n\t\tvec2 offsetScale = vec2( 1.0 + abs( offsetMix ) * 0.25 ); // vec2( 1.0 + abs(offsetPower) * 0.5 );\n\t\tvec2 offsetResize = 1.0/offsetScale;\n\t\tvec2 offsetMove = offsetResize * (offsetScale - 1.0) * 0.5;\n\t\tuvOffset = mod(uvOffset * offsetResize + offsetMove, 2.0);\n\t\tif (uvOffset.x > 1.0) uvOffset.x = 2.0 - uvOffset.x;\n\t\tif (uvOffset.y > 1.0) uvOffset.y = 2.0 - uvOffset.y;\n\n\t\tfloat mozY = mozX * 1.0/aspect;\n\t\tvec2 mozSize = vec2(1.0/mozX, 1.0/mozY);\n\t\tvec2 mozIndex = floor(vUv2 / mozSize);\n\t\tfloat mozValue = random(mozIndex);\n\t\tvec2 mozVec = vec2(mozValue, random(mozIndex));\n\n\t\tvec2 center = vec2(0.5 * aspect, 0.5);\n\t\tvec2 dnutPos = adjustedUV - center;\n\t\tfloat dnutDist = length( dnutPos );\n\t\tfloat dnutRadius = 0.6;\n\t\tfloat dnutInnerRadius = aspect * dnutRadius * enterPower_01_10 - 0.5;\n\t\tfloat dnutOuterRadius = aspect * dnutRadius * enterPower_01_10;\n\t\tfloat dnutPower = smoothstep( dnutInnerRadius, dnutOuterRadius, dnutDist ) - smoothstep( dnutOuterRadius, dnutOuterRadius + 1.0, dnutDist );\n\t\tdnutAlpha = clamp( ( 1.0 - dnutDist * 0.5 ) * enterPower_01_10 * 3.0, 0.0, 1.0 );\n\t\tvec2 mozUV = uvOffset + mozVec * mozPower * dnutPower * enterPower_01_10;\n\n\t\tdiffuseColor *= texture2D( map, mozUV );\n\n\t#endif\n\t#include <color_fragment>\n\t#include <roughnessmap_fragment>\n\t#include <metalnessmap_fragment>\n\t#include <normal_fragment_begin>\n\t#include <normal_fragment_maps>\n\t#include <lights_physical_fragment>\n\t#include <lights_fragment_begin>\n\t#include <lights_fragment_maps>\n\t#include <lights_fragment_end>\n\n\tvec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;\n\tvec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;\n\tvec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n\n\t#include <opaque_fragment>\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n\n\tfloat tvNoiseHr = (1.0 - tvNoizePower) + tvNoizePower * sin( vUv2.y * tvNoizeDisp * 0.8 );\n\n\tvec2 borderThreshold = vec2(2.0 / resolution.x, 2.0 / resolution.y);\n\tborderThreshold *= ( borderWidth * 0.1 );\n\tif (vUv2.x < borderThreshold.x || vUv2.x > 1.0 - borderThreshold.x || vUv2.y < borderThreshold.y || vUv2.y > 1.0 - borderThreshold.y) {\n\t\tdiscard;\n\t}\n\n\tvec2 vigRad = radians( vUv2 * 180. );\n\tvec2 vigSin = vec2( sin( vigRad ) );\n\tfloat vigColor = clamp( min( vigSin.x, vigSin.y ) + 0.5, (1.0 - vigAlpha), 1.0 );\n\n\tgl_FragColor.rgb = clamp( gl_FragColor.rgb * tvNoiseHr + fogColor.rgb * (1.0 - fogAlpha), vec3(0.0), vec3(1.0) );\n\tgl_FragColor.a = clamp( (vigColor) * (vFar * vFar * vFar * opacity - dnutAlpha * 0.5) * fogAlpha, 0.0, 1.0 );\n\n\t#include <premultiplied_alpha_fragment>\n\n}"));
        }));
    }
  }
  var s = THREE;
  class o extends s.MeshStandardMaterial {
    constructor(t) {
      const {
        fogColor: e,
        fogAlpha: i,
        data: n,
        dir: r,
        radius: s,
        width: o,
        height: a,
        rotate: l,
        angleRange: h,
        curvePower: c,
        zoomPower: u,
        ...d
      } = t;
      (super(d),
        (this.props = t),
        (this.anim = { enter: {}, leave: {} }),
        (this.userData.uniforms = {
          dir: { value: this.props.dir || 1 },
          radius: { value: this.props.radius || 0 },
          width: { value: this.props.width || 0 },
          height: { value: this.props.height || 0 },
          rotate: { value: this.props.rotate || 0 },
          angleRange: { value: this.props.angleRange || 0 },
          curvePower: { value: this.props.angleRange || 1 },
          zoomPower: { value: this.props.zoomPower || 0 },
          fogColor: { value: this.props.fogColor || this.props.color },
          fogAlpha: { value: this.props.fogAlpha || 0 },
        }),
        (this.onBeforeCompile = (t) => {
          (Object.assign(t.uniforms, this.userData.uniforms),
            (t.fragmentShader =
              "#define GLSLIFY 1\n#define STANDARD\nuniform vec3 diffuse;\nuniform vec3 emissive;\nuniform float roughness;\nuniform float metalness;\nuniform float opacity;\nvarying vec3 vNormal3;\nvarying vec2 vUv2;\nvarying float vFar;\nuniform vec3 fogColor;\nuniform float fogAlpha;\n\n#ifdef PHYSICAL\n\t#define IOR\n\t#define USE_SPECULAR\n#endif\n\n#ifdef USE_IRIDESCENCE\n\tuniform float iridescence;\n\tuniform float iridescenceIOR;\n\tuniform float iridescenceThicknessMinimum;\n\tuniform float iridescenceThicknessMaximum;\n#endif\n\nvarying vec3 vViewPosition;\n#include <common>\n#include <packing>\n#include <color_pars_fragment>\n#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <lights_pars_begin>\n#include <normal_pars_fragment>\n#include <lights_physical_pars_fragment>\n#include <roughnessmap_pars_fragment>\n#include <metalnessmap_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n\nvoid main() {\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n\tReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );\n\tvec3 totalEmissiveRadiance = emissive;\n\t#include <logdepthbuf_fragment>\n\t#include <map_fragment>\n\t#include <color_fragment>\n\t#include <roughnessmap_fragment>\n\t#include <metalnessmap_fragment>\n\t#include <normal_fragment_begin>\n\t#include <normal_fragment_maps>\n\t#include <lights_physical_fragment>\n\t#include <lights_fragment_begin>\n\t#include <lights_fragment_maps>\n\t#include <lights_fragment_end>\n\tvec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;\n\tvec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;\n\tvec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n\t#include <opaque_fragment>\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n\t#include <premultiplied_alpha_fragment>\n\tvec3 color = mix( totalDiffuse, fogColor, 1.5 - vFar );\n\tvec3 pos = normalize( vViewPosition );\n\tvec3 globalLight = vec3( clamp( pow( pow( sin( 1.0 - pos.x ), 6.0 ) * ( vUv2.x * vUv2.y ) * vFar, 10.0 ), 0.0, 1.0 ) * 0.05 );\n\tcolor += globalLight;\n\tgl_FragColor.rgb = clamp( color + fogColor.rgb * (1.0 - fogAlpha), vec3(0.0), vec3(1.0) );\n\tgl_FragColor.a = clamp( vFar * fogAlpha, 0.0, 1.0 );\n}"),
            (t.vertexShader =
              "#define GLSLIFY 1\nuniform float dir;\nuniform float radius;\nuniform float rotate;\nuniform float angleRange;\nuniform float curvePower;\nuniform float width;\nuniform float height;\nvarying vec2 vUv2;\nvec3 rotateAroundY(vec3 v, float angle) {\n    float sinA = sin(angle);\n    float cosA = cos(angle);\n    return vec3(\n        cosA * v.x + sinA * v.z,\n        v.y,\n        -sinA * v.x + cosA * v.z\n    );\n}\nvarying vec3 vNormal3;\nvarying float vFar;\n#define STANDARD\nvarying vec3 vViewPosition;\n#ifdef USE_TRANSMISSION\nvarying vec3 vWorldPosition;\n#endif\n#include <common>\n#include <uv_pars_vertex>\n#include <color_pars_vertex>\n#include <normal_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\n\nvoid main() {\n\n\tvUv2 = uv;\n\tvNormal3 = normal;\n\n\t#include <uv_vertex>\n\t#include <color_vertex>\n\t#include <morphcolor_vertex>\n\t#include <beginnormal_vertex>\n\t#include <defaultnormal_vertex>\n\t#include <normal_vertex>\n\t#include <begin_vertex>\n\n\tvec4 mvPosition = vec4( transformed, 1.0 );\n\t#ifdef USE_INSTANCING\n\tmvPosition = instanceMatrix * mvPosition;\n\t#endif\n\n\tfloat atsumi = 0.1;\n\tmvPosition.z = -mvPosition.z * 0.5 - atsumi;\n\tbool isBackFace = (mvPosition.z > 0.0 || mvPosition.y > 0.0 || mvPosition.y < 0.0 || mvPosition.x > 0.0 || mvPosition.x < 0.0);\n\n\tif( isBackFace ){\n\t\tmvPosition.z = -mvPosition.z * 0.5 - atsumi;\n\t\tmvPosition.x = mvPosition.x * ( 1.0 + mvPosition.z * 0.12 );\n\t}\n\n\tfloat depth = abs( mvPosition.z * 2.0 );\n\tfloat rotation = radians( rotate );\n\tfloat angle = mix( 0.0, angleRange, mvPosition.x );\n\n\tfloat tx = mvPosition.x * width * (1.0 - curvePower) + ( 1.0 - curvePower ) + radius * sin(angle) * curvePower;\n\tfloat ty = mvPosition.y * height;\n\tfloat tz = mvPosition.z - radius * (1.0 - cos(angle)) * curvePower;\n\tvec3 newPos = vec3(tx, ty, tz);\n\tvec3 center = vec3(0.0, ty, -radius );\n\tvec3 offsetPos = newPos - center;\n\tvec3 rotatedPos = rotateAroundY(offsetPos, rotation);\n\tnewPos = rotatedPos + center;\n\n\tfloat zFar = newPos.z - center.z;\n\tvFar = 2.0 - (1.0 - (zFar / radius));\n\tif( zFar < 0.5 ){\n\t\tif( newPos.x < 0.5 ){\n\t\t\tnewPos.x = ( -newPos.x - ( radius - depth * 0.5 ) * 2.0 );\n\t\t\tnewPos.z = newPos.z - depth * 0.5;\n\t\t} else {\n\t\t\tnewPos.x = ( -newPos.x + ( radius - depth * 0.5 ) * 2.0 );\n\t\t\tnewPos.z = newPos.z - depth * 0.5;\n\t\t}\n\t}\n\n\tmvPosition = modelViewMatrix * vec4(newPos, 1.0);\n\tgl_Position = projectionMatrix * mvPosition;\n\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n\n\tvViewPosition = -mvPosition.xyz;\n\n\t#include <worldpos_vertex>\n\n\t#ifdef USE_TRANSMISSION\n\tvWorldPosition = worldPosition.xyz;\n\t#endif\n\n}"));
        }));
    }
  }
  var a = THREE;
  class l {
    constructor(t = {}) {
      ((this.props = t),
        (this.anim = { enter: {}, leave: {} }),
        (this.fontScale = this.props.fontScale || 0.06),
        (this.geometory = this.props.geometory),
        (this.titleStr = ""));
      for (let t = 0; t < this.props.titleArray.length; t++) {
        const e = this.props.titleArray[t],
          i = htmlDecode(e);
        this.titleStr += i.toUpperCase() + "\n";
      }
      (this.onInitTexture(), this.onInit());
    }
    onInitTexture() {
      ((this.canvas = document.createElement("canvas")),
        (this.canvas.width = WW),
        (this.canvas.height =
          this.canvas.width *
          (WEBGL.screen.params.screen.h / WEBGL.screen.params.screen.w)),
        (this.ctx = this.canvas.getContext("2d")),
        this.drawTitle(),
        (this.texture = new a.CanvasTexture(this.canvas)),
        (this.texture.needsUpdate = !1),
        (this.texture.minFilter = a.LinearFilter),
        (this.texture.magFilter = a.LinearFilter),
        (this.texture.format = a.RGBAFormat));
    }
    drawTitle() {
      ((this.fontSize = this.canvas.width * this.fontScale),
        (this.lineHeight = 0.8),
        CanvasTextWrapper(this.canvas, this.titleStr, {
          font: "400 " + this.fontSize + "px 'NeueMontreal', sans-serif",
          allowNewLine: !0,
          verticalAlign: "middle",
          textAlign: "center",
          lineHeight: this.fontSize * this.lineHeight + "px",
        }));
    }
    drawInfo() {
      (this.ctx.restore(),
        this.ctx.resetTransform(),
        (this.infoFontSize = 0.5 * this.fontSize),
        (this.ctx.font =
          "400 " + this.infoFontSize + "px 'NeueMontreal', sans-serif"),
        (this.ctx.textAlign = "center"),
        (this.ctx.textBaseline = "middle"));
      let t = 0.5 * this.canvas.width,
        e = this.canvas.height - 2 * this.infoFontSize;
      (this.ctx.fillText("CLIENT : " + this.props.data.client, t, e),
        this.ctx.fillText(
          "CATEGORY : " + this.props.data.category,
          t,
          e - this.infoFontSize * this.lineHeight,
        ));
    }
    onInit() {
      ((this.material = new a.ShaderMaterial({
        transparent: !0,
        uniforms: {
          tDiffuse: { value: this.texture },
          mozX: { value: this.props.mozX || 60 },
          mozPower: { value: this.props.mozPower || 0.05 },
          color: { value: COLOR.table.title.three },
          fontScale: { value: this.fontScale },
          opacity: { value: 0 },
          radius: { value: 0 },
          width: { value: 0 },
          height: { value: 0 },
          angleRange: { value: 0 },
          curvePower: { value: 0 },
          zoomPower: { value: 0 },
          rotate: { value: 0 },
          titleArrayLength: { value: this.props.titleArray.length },
          enterPower_010: { value: this.props.enterPower_010 || 0 },
          enterPower_01_10: { value: this.props.enterPower_01_10 || 0 },
          depthWrite: !1,
          depthTest: !0,
          paraPower: { value: 1 },
        },
        vertexShader:
          "#define GLSLIFY 1\nuniform float radius;\nuniform float rotate;\nuniform float angleRange;\nuniform float curvePower;\nuniform float width;\nuniform float height;\nvarying vec2 vUv;\nvec3 rotateAroundY(vec3 v, float angle) {\n    float sinA = sin(angle);\n    float cosA = cos(angle);\n    return vec3(\n        cosA * v.x + sinA * v.z,\n        v.y,\n        -sinA * v.x + cosA * v.z\n    );\n}\nuniform float enterPower_01_10;\nuniform float mouseEnterZ;\nvarying vec3 vViewPosition;\n\nvoid main() {\n\n\tvUv = uv;\n\n\tvec4 mvPosition = vec4( position.xyz, 1.0 );\n\tmvPosition.z = mvPosition.z + 0.2;\n\n\tfloat rotation = radians( rotate );\n\tfloat angle = mix( 0.0, angleRange, mvPosition.x );\n\n\tfloat tx = mvPosition.x * width * (1.0 - curvePower) + ( 1.0 - curvePower ) + radius * sin(angle) * curvePower;\n\tfloat ty = mvPosition.y * height;\n\tfloat tz = mvPosition.z - radius * (1.0 - cos(angle)) * curvePower;\n\tvec3 newPos = vec3(tx, ty, tz);\n\tvec3 center = vec3(0.0, ty, -radius );\n\tvec3 offsetPos = newPos - center;\n\tvec3 rotatedPos = rotateAroundY(offsetPos, rotation);\n\n\tnewPos = rotatedPos + center;\n\tmvPosition = modelViewMatrix * vec4(newPos, 1.0);\n\tgl_Position = projectionMatrix * mvPosition;\n\n\tvViewPosition = -mvPosition.xyz;\n}",
        fragmentShader:
          "#define GLSLIFY 1\nuniform sampler2D tDiffuse;\nuniform vec3 color;\nvarying vec2 vUv;\nvarying vec3 vViewPosition;\nuniform float opacity;\nuniform float enterPower_01_10;\nuniform float titleArrayLength;\nuniform float fontScale;\nuniform float width;\nuniform float height;\nuniform float mozX;\nuniform float mozPower;\nuniform float paraPower;\n\nvec3 LinearTosRGB(vec3 linear) {\n\treturn pow(linear, vec3(1.0 / 2.2));\n}\n\nfloat random(vec2 st) {\n\treturn fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);\n}\n\nvoid main() {\n\n\tfloat aspect = width/height;\n\tvec2 adjustedUV = vUv;\n\tadjustedUV.x *= aspect;\n\n\tvec2 center = vec2(0.5 * aspect, 0.5);\n\tvec2 dnutPos = adjustedUV - center;\n\tfloat dnutDist = length( dnutPos );\n\tfloat dnutRadius = 0.6;\n\tfloat dnutInnerRadius = aspect * dnutRadius * enterPower_01_10 - 0.5;\n\tfloat dnutOuterRadius = aspect * dnutRadius * enterPower_01_10;\n\tfloat dnutPower = smoothstep( dnutInnerRadius, dnutOuterRadius, dnutDist ) - smoothstep( dnutOuterRadius, dnutOuterRadius + 1.0, dnutDist );\n\tfloat dnutAlpha = clamp( ( 1.0 - dnutDist * 0.5 ) * enterPower_01_10 * 3.0, 0.0, 1.0 );\n\n\tfloat mozY = mozX * 1.0/aspect;\n\tvec2 mozSize = vec2(1.0/mozX, 1.0/mozY);\n\tvec2 mozIndex = floor(vUv / mozSize);\n\tfloat mozValue = random(mozIndex);\n\tvec2 mozVec = vec2(mozValue, random(mozIndex));\n\tvec2 mozUV = vUv + mozVec * mozPower * dnutPower * enterPower_01_10;\n\n\tvec2 uvTranslate = vUv;\n\tuvTranslate.y = vUv.y + fontScale * 0.5;\n\tif( titleArrayLength == 2.0 ){\n\t\tuvTranslate.x = mozUV.x - clamp( vViewPosition.x * (vUv.y < 0.5 ? 0.015 : 0.01), -1.0, 1.0 ) * paraPower;\n\t}\n\n\tvec4 iText = texture2D( tDiffuse, uvTranslate );\n\n\tfloat a = iText.a * dnutAlpha;\n\tgl_FragColor = vec4( LinearTosRGB( color ), a );\n\n}",
      })),
        DETECT.device.any && (this.material.uniforms.paraPower.value = 0),
        (this.mesh = new a.Mesh(this.geometory, this.material)),
        (this.mesh.renderOrder = 10));
    }
    onUpdate() {
      ((this.material.uniforms.opacity.value =
        PAGE_TRANSITION.anim.ptFadeTitle *
        PAGE_TRANSITION.page.projects.ptWebGl),
        this.material.uniforms.opacity.value *
          this.material.uniforms.enterPower_01_10.value ==
        0
          ? (this.mesh.visible = !1)
          : (this.mesh.visible = !0));
    }
  }
  var h = THREE;
  WEBGL.screen = {
    ready: !1,
    visible: !0,
    meshes: [],
    segmentW: 128,
    segmentH: 8,
    params: {
      slit: { ratio: 0.5, disp: { x: 0, y: 0 } },
      mozX: 40,
      mozPower: 0.05,
      screen: { w: 3, h: 1, roughness: 1, metalness: 0 },
      padding: { degOrigin: 2, deg: 0, x: 0, scale: { x: 0.5, y: 1 } },
      frame: { roughness: 1, metalness: 0 },
      borderWidth: 0.2,
      cylinder: {
        deg: 0,
        radius: 0.8,
        center: { x: 0, y: 0, z: 1 },
        direction: { x: 0, y: 0, z: -1 },
        radiusTop: 0,
        radiusBottom: 0.25,
        height: 1,
      },
      mouse: {
        ratio: 0.5,
        power: { x: 0.2, y: 0 },
        disp: { x: 0.2, y: 0 },
        enter: { z: 1 },
      },
      speed: 0.1,
      width: 0,
      height: 0,
      origin: { width: 0, height: 0 },
      progress: 0,
      scale: 1,
      radius: 0,
      degWrap: 60,
      degInner: 0,
      angleRange: 0,
      tvNoizePower: 0.1,
      tvNoizeDisp: Math.floor(WH),
      curvePower: 1,
      zoomPower: 0,
      offsetPower: 0.5,
      fontScale: 0.065,
    },
    setForDevice() {
      (DETECT.device.any &&
        ((this.params.mozPower = 0), (this.params.padding.scale.y = 2)),
        WW <= MOBILE_WIDTH &&
          ((this.params.screen.h = 1),
          (this.params.screen.w = 2.5),
          (this.params.padding.degOrigin = 3)));
    },
    once() {
      (this.setForDevice(),
        (this.stage = new h.Group()),
        PROJECTS.json.forEach((t, e) => {
          let i = null,
            n = null,
            r = null,
            s = getVideoSrc(t.video.hd, t.video.hd, t.video.sd, t.video.hd),
            o = getSrc(t.image.d1x, t.image.d1x, t.image.mob, t.image.d1x);
          s &&
            o &&
            (DETECT_INIT.islow || DETECT.device.any
              ? (r = new h.TextureLoader().load(o))
              : ((i = document.createElement("video")),
                (i.src = s),
                (i.preload = "metadata"),
                (i.muted = !0),
                (i.loop = !0),
                i.setAttribute("crossorigin", "anonymous"),
                i.setAttribute("muted", ""),
                i.setAttribute("playsinline", "playsinline"),
                (n = new h.VideoTexture(i)),
                (i.currentTime = 0.01)),
            this.meshes.push({
              mouseenter: {
                timer: null,
                screen_010: { tl: null, power: 0 },
                screen_01_10: { tl: null, power: 0 },
                title_01_10: { tl: null, power: 0 },
              },
              mouseleave: {
                timer: null,
                screen_010: { tl: null },
                screen_01_10: { tl: null },
                title_01_10: { tl: null },
              },
              data: t,
              index: e,
              width: Number(t.width),
              height: Number(t.height),
              group: new h.Group(),
              deg: 0,
              rotate: 0,
              frame: null,
              screen: null,
              image: { src: o, timer: null, tex: r },
              video: {
                el: i,
                src: s,
                play: { func: null, flg: !1 },
                playing: { func: null, flg: !1 },
                canplay: { func: null, flg: !1 },
                timer: null,
                tex: n,
              },
              param: { curvePower: 1, zoomPower: 0 },
            }));
        }),
        (this.params.degTotal = this.params.degWrap * this.meshes.length),
        this.onInitScreens(),
        WEBGL.scene.add(this.stage),
        this.onResize(),
        (this.ready = !0));
    },
    onLoadTexture() {},
    onInit(t = PAGE_TRANSITION.current) {},
    casterOriginalPositions: [],
    casterTransformPositions: [],
    onInitScreens() {
      ((this.screenGeometry = new h.PlaneGeometry(
        1,
        1,
        this.segmentW,
        this.segmentH,
      )),
        (this.frameGeometry = new h.BoxGeometry(
          1,
          1,
          0.3,
          this.segmentW,
          1,
          1,
        )),
        (this.casterGeometory = new h.PlaneGeometry(1, 1, 4, 1)),
        (this.casterOriginalPositions = Float32Array.from(
          this.casterGeometory.getAttribute("position").array,
        )),
        (this.casterTransformPositions = Float32Array.from(
          this.casterGeometory.getAttribute("position").array,
        )));
      const t = new h.PlaneGeometry(1, 1, 8, 1);
      (this.meshes.forEach((e, i) => {
        let n = e.video.tex ? e.video.tex : e.image.tex;
        const s = new r({
          data: e,
          color: "#fff",
          transparent: !0,
          roughness: 1,
          metalness: 0,
          dir: i % 2 != 0 ? 1 : -1,
          mozX: this.params.mozX,
          mozPower: this.params.mozPower,
          map: n,
          enterPower_010: 0,
          enterPower_01_10: 0,
          mouseEnterZ: 0.5,
          mouseNoiseRatio: this.params.mouse.ratio,
          mouseNoiseDisp: this.params.mouse.disp,
          mouseNoisePower: this.params.mouse.power,
          mouseNoiseDir: { x: 0, y: 0 },
          vigAlpha: 1,
          fogAlpha: 0,
          fogColor: COLOR.table.bg.three,
        });
        ((e.screen = { mesh: new h.Mesh(this.screenGeometry, s) }),
          e.group.add(e.screen.mesh));
        const a = new o({
          data: e,
          color: COLOR.table.screen.three,
          fogAlpha: 0,
          fogColor: COLOR.table.bg.three,
          transparent: !0,
          roughness: 0.2,
          metalness: 0,
          dir: i % 2 != 0 ? 1 : -1,
        });
        ((e.frame = { mesh: new h.Mesh(this.frameGeometry, a) }),
          e.group.add(e.frame.mesh),
          (e.frame.mesh.renderOrder = -1));
        const c = new h.ShaderMaterial({
          transparent: !0,
          uniforms: { color: { value: new h.Color("#f00") } },
          vertexShader:
            "\n\t\t\t\t\tvarying vec2 vUv;\n\t\t\t\t\tvoid main(){\n\t\t\t\t\t\tvUv = uv;\n\t\t\t\t\t\tgl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);\n\t\t\t\t\t}\n\t\t\t\t\t",
          fragmentShader:
            "\n\t\t\t\t\tuniform vec3 color;\n\t\t\t\t\tvarying vec2 vUv;\n\t\t\t\t\tvoid main() {\n\t\t\t\t\t\tgl_FragColor = vec4(0.0);\n\t\t\t\t\t}\n\t\t\t\t\t",
        });
        ((e.caster = {
          isMouseOver: !1,
          mesh: new h.Mesh(this.casterGeometory, c),
        }),
          (e.caster.mesh.visible = !1),
          e.group.add(e.caster.mesh),
          (e.title = new l({
            data: e.data,
            fontScale: this.params.fontScale,
            titleArray: e.data.titleArray,
            geometory: t,
            enterPower_01_10: 0,
            mouseEnterZ: 0.5,
            mozX: this.params.mozX,
            mozPower: this.params.mozPower,
          })),
          e.group.add(e.title.mesh),
          this.stage.add(e.group));
      }),
        DETECT.device.any || this.onInitEventsForDesktop());
    },
    onInitEventsForDesktop() {
      this.meshes.forEach((t) => {
        ((t.onMouseEnter = () => {
          (clearTimeout(t.mouseenter.timer),
            clearTimeout(t.mouseleave.timer),
            $html.classList.add("is-hv-a"),
            (t.mouseenter.timer = setTimeout(() => {
              (styleProjects && styleProjects.onMouseEnter(t.data),
                t.video.el && t.video.el.paused && onPlayVideo(t.video.el),
                (t.mouseenter.screen_010.tl = gsap.timeline()),
                t.mouseenter.screen_010.tl.to(t.mouseenter.screen_010, {
                  duration: 0.6,
                  ease: "power2.inOut",
                  power: 0.5,
                }),
                t.mouseenter.screen_010.tl.to(t.mouseenter.screen_010, {
                  duration: 1.8,
                  ease: "power2.out",
                  power: 0,
                }),
                (t.mouseenter.screen_01_10.tl = gsap.to(
                  t.mouseenter.screen_01_10,
                  { duration: 1.8, ease: "power2.out", power: 1 },
                )),
                (t.mouseenter.title_01_10.tl = gsap.to(
                  t.mouseenter.title_01_10,
                  { duration: 1.8, ease: "power2.out", power: 1 },
                )));
            }, 200)));
        }),
          (t.onMouseLeave = () => {
            (clearTimeout(t.mouseenter.timer),
              clearTimeout(t.mouseleave.timer),
              $html.classList.remove("is-hv-a"),
              t.video.el &&
                !PAGE_TRANSITION.ing &&
                (t.video.el.paused || t.video.el.pause()),
              t.mouseenter.screen_01_10.tl &&
                t.mouseenter.screen_01_10.tl.kill(),
              (t.mouseenter.screen_01_10.tl = null),
              gsap.to(t.mouseenter.screen_01_10, {
                duration: 1.2,
                ease: "power2.out",
                power: 0,
              }),
              t.mouseenter.title_01_10.tl && t.mouseenter.title_01_10.tl.kill(),
              (t.mouseenter.title_01_10.tl = null),
              gsap.to(t.mouseenter.title_01_10, {
                duration: 0.6,
                ease: "power2.out",
                power: 0,
              }));
          }));
      });
    },
    onClick(t = 0, e = 0) {
      const i = t + 0.5 * ((1 * WEBGL.width) / RESCALE - window.innerWidth);
      ((WEBGL.scenes.first.mouse.x =
        (i / ((1 * WEBGL.width) / RESCALE)) * 2 - 1),
        (WEBGL.scenes.first.mouse.y =
          (-e / ((1 * WEBGL.height) / RESCALE)) * 2 + 1),
        WEBGL.scenes.first.raycaster.setFromCamera(
          WEBGL.scenes.first.mouse,
          WEBGL.scenes.cameras.models.camera,
        ));
      for (let t = 0; t < this.meshes.length; t++) {
        const e = this.meshes[t];
        if (
          PAGE_TRANSITION.ing ||
          styleMenu.isopen ||
          !(
            this.visible &&
            PAGE_TRANSITION.mixAnim.ptZoom >= 0.99 &&
            PAGE_TRANSITION.page.single.ptWebGl <= 0.05
          )
        )
          return !1;
        WEBGL.scenes.first.raycaster.intersectObject(e.caster.mesh).length >
          0 &&
          ("ja" === styleLang.data.current
            ? barba.go(e.data.permalink.ja)
            : barba.go(e.data.permalink.en));
      }
    },
    dom: {
      padding: { x: 0 },
      radius: 0,
      degInner: 0,
      width: 0,
      height: 0,
      sync: { width: 0, height: 0, padding: 0 },
    },
    acc: {
      s: getParam("sc-acc-s") ? Number(getParam("sc-acc-s")) : 3,
      e: getParam("sc-acc-e") ? Number(getParam("sc-acc-e")) : "power3.out",
      min: getParam("sc-acc-min") ? Number(getParam("sc-acc-min")) : 0,
      max: getParam("sc-acc-max") ? Number(getParam("sc-acc-max")) : 0.5,
      ratio: getParam("sc-acc-ratio") ? Number(getParam("sc-acc-ratio")) : 0.3,
    },
    onResize() {
      const t = 1 / (this.params.mozX / WW);
      ((this.params.slit.disp.x = 28e-6 * t),
        (this.params.slit.disp.y = 0),
        (this.width = WEBGL.width),
        (this.height = WEBGL.height),
        (this.params.padding.deg = this.params.padding.degOrigin),
        (this.params.degInner = this.params.degWrap - this.params.padding.deg));
      const e = Math.min(0.5 * this.width, this.height);
      if (MOUSE.enable) {
        const t = clamp(PAGE_SCROLL_PROJECTS.acc, this.acc.min, this.acc.max);
        this.params.radius =
          e + e * t * this.acc.ratio * PAGE_TRANSITION.page.projects.ptWebGl;
      } else this.params.radius = e;
      ((this.params.origin.width =
        ((this.params.degInner * Math.PI) / 180) * this.params.radius),
        (this.params.origin.height =
          this.params.origin.width *
          (this.params.screen.h / this.params.screen.w)),
        (this.params.padding.x =
          ((this.params.padding.deg * Math.PI) / 180) * this.params.radius),
        (this.dom.degInner =
          this.params.degWrap - this.params.padding.degOrigin),
        (this.dom.radius = Math.min(0.5 * this.width, this.height)),
        (this.dom.width =
          ((this.dom.degInner * Math.PI) / 180) * this.dom.radius),
        (this.dom.height =
          this.dom.width * (this.params.screen.h / this.params.screen.w)),
        (this.dom.padding.x =
          ((this.params.padding.degOrigin * Math.PI) / 180) * this.dom.radius),
        (this.dom.sync.width = (1 * this.dom.width) / RESCALE),
        (this.dom.sync.height = (1 * this.dom.height) / RESCALE),
        (this.dom.sync.padding = (1 * this.dom.padding.x) / RESCALE),
        $wrap.style.setProperty("--project-w", this.dom.sync.width / WW),
        $wrap.style.setProperty("--project-h", this.dom.sync.height / WW),
        $wrap.style.setProperty("--project-x", this.dom.sync.padding / WW));
    },
    onUpdateBefore() {
      ((SCREEN_PADDING.x = this.params.padding.x * this.params.padding.scale.x),
        (SCREEN_PADDING.y =
          this.params.padding.x * this.params.padding.scale.y),
        (GROUND.y =
          -this.params.origin.height * this.params.scale * 0.5 -
          SCREEN_PADDING.y),
        this.onResize());
    },
    time: 0,
    getProgress() {
      isFiniteAndNotNaN(PAGE_SCROLL_PROJECTS.scroll.p) &&
        isNumber(PAGE_SCROLL_PROJECTS.scroll.p) &&
        (this.getBuffer(),
        (this.progress = PAGE_SCROLL_PROJECTS.scroll.p + this.bufferProgress));
    },
    currnetIndex: 0,
    bufferProgress: 0,
    getBuffer() {
      let t = PAGE_SCROLL_PROJECTS.scroll.p,
        e = this.currnetIndex / this.meshes.length;
      this.bufferProgress =
        this.getShortestDistance(t, e) * PAGE_TRANSITION.page.single.ptWebGl;
    },
    getShortestDistance(t, e) {
      let i = e - t,
        n = e > t ? e - (t + 1) : e + 1 - t;
      return Math.abs(i) <= Math.abs(n) ? i : n;
    },
    onReset() {
      this.time = 0;
    },
    onUpdate() {
      if (
        ("home" === PAGE_TRANSITION.current.name && (this.time += 1),
        this.onUpdateBefore(),
        this.onUpdateForTransition(),
        !this.stage.visible)
      )
        return !1;
      const t = this.width / this.params.origin.width - 1,
        e = this.height / this.params.origin.height - 1;
      ((this.params.scale =
        1 + Math.max(t, e) * PAGE_TRANSITION.page.single.ptWebGl),
        this.getProgress());
      let i = (-this.progress * this.params.degTotal) % this.params.degTotal;
      i -=
        ((this.time * this.params.speed) % this.params.degTotal) *
        (1 - PAGE_TRANSITION.anim.ptZoomIn);
      for (let t = 0; t < this.meshes.length; t++) {
        const e = this.meshes[t];
        if (
          ((e.rotate = (this.params.degWrap * t + i) % this.params.degTotal),
          Math.abs(e.rotate) <= 180 ||
          Math.abs(e.rotate) >= this.params.degTotal - 180
            ? ((e.group.visible = !0), (e.group.position.y = 0))
            : ((e.group.visible = !1), (e.group.position.y = WEBGL.height)),
          (e.group.position.x =
            -4 * this.dom.padding.x * PAGE_TRANSITION.page.single.ptWebGl),
          t === this.currnetIndex)
        ) {
          let t =
              this.params.origin.height * this.params.scale -
              (this.params.origin.height * this.params.scale - WEBGL.height) *
                PAGE_TRANSITION.page.single.ptWebGl,
            i =
              this.params.origin.width * this.params.scale -
              (this.params.origin.width * this.params.scale - WEBGL.width) *
                PAGE_TRANSITION.page.single.ptWebGl;
          ((e.screen.mesh.material.userData.uniforms.width.value = i),
            (e.screen.mesh.material.userData.uniforms.height.value = t),
            (e.frame.mesh.material.userData.uniforms.width.value = i),
            (e.frame.mesh.material.userData.uniforms.height.value = t),
            (e.screen.mesh.material.userData.uniforms.resolution.value.x = i),
            (e.screen.mesh.material.userData.uniforms.resolution.value.y = t),
            (e.screen.mesh.visible = !0),
            (e.frame.mesh.visible = !0));
        } else
          ((e.screen.mesh.material.userData.uniforms.width.value =
            this.params.origin.width),
            (e.screen.mesh.material.userData.uniforms.height.value =
              this.params.origin.height),
            (e.frame.mesh.material.userData.uniforms.width.value =
              this.params.origin.width),
            (e.frame.mesh.material.userData.uniforms.height.value =
              this.params.origin.height),
            (e.screen.mesh.material.userData.uniforms.resolution.value.x =
              this.params.origin.width),
            (e.screen.mesh.material.userData.uniforms.resolution.value.y =
              this.params.origin.height),
            PAGE_TRANSITION.page.single.ptWebGl > 0.55
              ? ((e.screen.mesh.visible = !1), (e.frame.mesh.visible = !1))
              : ((e.screen.mesh.visible = !0), (e.frame.mesh.visible = !0)));
        (DETECT.device.any
          ? ((e.screen.mesh.material.userData.uniforms.enterPower_010.value =
              PAGE_TRANSITION.anim.ptFadeTitle),
            (e.screen.mesh.material.userData.uniforms.enterPower_01_10.value =
              PAGE_TRANSITION.anim.ptFadeTitle))
          : ((e.screen.mesh.material.userData.uniforms.enterPower_010.value =
              e.mouseenter.screen_010.power),
            (e.screen.mesh.material.userData.uniforms.enterPower_01_10.value =
              e.mouseenter.screen_01_10.power)),
          this.onUpdateScreen(e),
          this.onUpdateFrame(e),
          e.title &&
            (DETECT.device.any
              ? ((e.title.mesh.material.uniforms.enterPower_010.value =
                  PAGE_TRANSITION.anim.ptFadeTitle),
                (e.title.mesh.material.uniforms.enterPower_01_10.value =
                  PAGE_TRANSITION.anim.ptFadeTitle))
              : ((e.title.mesh.material.uniforms.enterPower_010.value =
                  e.mouseenter.title_01_10.power),
                (e.title.mesh.material.uniforms.enterPower_01_10.value =
                  e.mouseenter.title_01_10.power)),
            e.title.onUpdate()),
          e.title && this.onUpdateTitle(e),
          e.caster &&
            (this.onUpdateCaster(e), DETECT.device.any || this.onUpdateRay(e)));
      }
      (this.onUpdateCurrentIndex(), this.onUpdatePlayVideo());
    },
    onUpdatePlayVideo() {
      for (let t = 0; t < this.meshes.length; t++) {
        const e = this.meshes[t];
        switch (PAGE_TRANSITION.current.name) {
          case "single":
            this.currnetIndex === t &&
              e.video.el &&
              e.video.el.paused &&
              onPlayVideo(e.video.el);
            break;
          case "home":
            DETECT.device.any &&
              e.video.el &&
              (e.video.el.paused || e.video.el.pause());
            break;
          case "projects":
            DETECT.device.any &&
              (Math.abs(e.rotate) <= 90 ||
              Math.abs(e.rotate) >= this.params.degTotal - 90
                ? e.video.el && e.video.el.paused && onPlayVideo(e.video.el)
                : e.video.el && (e.video.el.paused || e.video.el.pause()));
        }
      }
    },
    onUpdateCurrentIndex() {
      this.currnetIndex = 0;
      for (let t = 0; t < this.meshes.length; t++) {
        const e = this.meshes[t];
        if (PAGE_TRANSITION.flag.isSingleToSingleFromFooter)
          e.data.slug === PAGE_TRANSITION.next.slug
            ? ((this.currnetIndex = t), (e.group.visible = !0))
            : (e.group.visible = !1);
        else if ("single" === PAGE_TRANSITION.current.name)
          e.data.slug === PAGE_TRANSITION.current.slug &&
            (this.currnetIndex = t);
        else
          (e.data.slug !== PAGE_TRANSITION.current.slug &&
            e.data.slug !== PAGE_TRANSITION.prev.slug) ||
            (this.currnetIndex = t);
      }
    },
    onUpdateScreen(t) {
      ((t.screen.mesh.material.opacity =
        1 - 0.3 * PAGE_TRANSITION.page.home.ptWebGl * COLOR.power.dark),
        (t.screen.mesh.material.roughness =
          this.params.screen.roughness *
          (1 - PAGE_TRANSITION.page.single.ptWebGl)),
        (t.screen.mesh.material.metalness =
          this.params.screen.metalness *
          (1 - PAGE_TRANSITION.page.single.ptWebGl)),
        (t.screen.mesh.material.userData.uniforms.radius.value =
          this.params.radius),
        (t.screen.mesh.material.userData.uniforms.fogAlpha.value = clamp(
          PAGE_TRANSITION.page.home.ptWebGl +
            PAGE_TRANSITION.page.single.ptWebGl +
            PAGE_TRANSITION.page.projects.ptWebGl,
          0,
          1,
        )),
        (t.screen.mesh.material.userData.uniforms.angleRange.value =
          this.params.degInner * (Math.PI / 180)),
        (t.screen.mesh.material.userData.uniforms.curvePower.value =
          1 - PAGE_TRANSITION.page.single.ptWebGl),
        (t.screen.mesh.material.userData.uniforms.zoomPower.value =
          PAGE_TRANSITION.page.single.ptWebGl),
        (t.screen.mesh.material.userData.uniforms.offsetPower.value =
          (1 - PAGE_TRANSITION.page.single.ptWebGl) * this.params.offsetPower),
        (t.screen.mesh.material.userData.uniforms.rotate.value = t.rotate),
        (t.screen.mesh.material.userData.uniforms.borderWidth.value =
          this.params.borderWidth * (1 - PAGE_TRANSITION.page.single.ptWebGl)),
        (t.screen.mesh.material.userData.uniforms.i_resolution.value.x =
          t.width),
        (t.screen.mesh.material.userData.uniforms.i_resolution.value.y =
          t.height),
        (t.screen.mesh.material.userData.uniforms.tvNoizePower.value =
          this.params.tvNoizePower * (1 - PAGE_TRANSITION.page.single.ptWebGl)),
        (t.screen.mesh.material.userData.uniforms.vigAlpha.value =
          1 - COLOR.power.light));
    },
    onUpdateFrame(t) {
      ((t.frame.mesh.material.userData.uniforms.radius.value =
        this.params.radius),
        (t.frame.mesh.material.userData.uniforms.angleRange.value =
          this.params.degInner * (Math.PI / 180)),
        (t.frame.mesh.material.userData.uniforms.curvePower.value =
          1 - PAGE_TRANSITION.page.single.ptWebGl),
        (t.frame.mesh.material.userData.uniforms.zoomPower.value =
          PAGE_TRANSITION.page.single.ptWebGl),
        (t.frame.mesh.material.userData.uniforms.rotate.value = t.rotate),
        (t.frame.mesh.material.userData.uniforms.fogAlpha.value = clamp(
          PAGE_TRANSITION.page.home.ptWebGl +
            PAGE_TRANSITION.page.projects.ptWebGl,
          0,
          1,
        )),
        (t.frame.mesh.material.color.r = COLOR.table.screen.three.r),
        (t.frame.mesh.material.color.g = COLOR.table.screen.three.g),
        (t.frame.mesh.material.color.b = COLOR.table.screen.three.b));
    },
    onUpdateTitle(t) {
      ((t.title.mesh.material.uniforms.radius.value = this.params.radius),
        (t.title.mesh.material.uniforms.width.value = this.params.origin.width),
        (t.title.mesh.material.uniforms.height.value =
          this.params.origin.height),
        (t.title.mesh.material.uniforms.angleRange.value =
          this.params.degInner * (Math.PI / 180)),
        (t.title.mesh.material.uniforms.curvePower.value =
          1 - PAGE_TRANSITION.page.single.ptWebGl),
        (t.title.mesh.material.uniforms.zoomPower.value =
          PAGE_TRANSITION.page.single.ptWebGl),
        (t.title.mesh.material.uniforms.rotate.value = t.rotate));
    },
    onUpdateCaster(t) {
      const e = this.params.radius,
        i = this.params.degInner * (Math.PI / 180),
        n = this.params.origin.width,
        r = this.params.origin.height,
        s = (t.rotate + 90) * (Math.PI / 180),
        o = e * Math.cos(s),
        a = e * Math.sin(s);
      ((t.caster.mesh.position.x = -o),
        (t.caster.mesh.position.z = a - e),
        (t.caster.mesh.rotation.y = t.rotate * (Math.PI / 180)));
      const l = t.caster.mesh.geometry.attributes.position.array;
      let h = 0;
      for (let t = 0; t < this.casterTransformPositions.length; t += 3) {
        const s = this.casterOriginalPositions[t] * i;
        ((this.casterTransformPositions[t] =
          this.casterOriginalPositions[t] * n * 0 + 0 + e * Math.sin(s) * 1),
          (this.casterTransformPositions[t + 1] =
            this.casterOriginalPositions[t + 1] * r),
          (this.casterTransformPositions[t + 2] =
            this.casterOriginalPositions[t + 2] - e * (1 - Math.cos(s)) * 1),
          l[t] != this.casterTransformPositions[t] && h++,
          l[t + 1] != this.casterTransformPositions[t + 1] && h++,
          l[t + 2] != this.casterTransformPositions[t + 2] && h++);
      }
      if (0 != h) {
        for (let t = 0; t < l.length; t += 3)
          ((l[t] = this.casterTransformPositions[t]),
            (l[t + 1] = this.casterTransformPositions[t + 1]),
            (l[t + 2] = this.casterTransformPositions[t + 2]));
        t.caster.mesh.geometry.getAttribute("position").needsUpdate = !0;
      } else t.caster.mesh.geometry.getAttribute("position").needsUpdate = !1;
    },
    onMouseLeaveRay() {
      if (!DETECT.device.any)
        for (let t = 0; t < this.meshes.length; t++) {
          const e = this.meshes[t];
          e.caster && ((e.caster.isMouseOver = !1), e.onMouseLeave());
        }
    },
    onUpdateRay(t) {
      if (MOUSE.enable) {
        var e;
        if (
          PAGE_TRANSITION.ing ||
          styleMenu.isopen ||
          !(
            null !== (e = MOUSE.body) &&
            void 0 !== e &&
            e.isActive &&
            t.group.visible &&
            this.visible &&
            PAGE_TRANSITION.mixAnim.ptZoom >= 0.99 &&
            PAGE_TRANSITION.page.single.ptWebGl <= 0.05
          )
        )
          return !1;
        WEBGL.scenes.first.raycaster.intersectObject(t.caster.mesh).length > 0
          ? t.caster.isMouseOver ||
            ((t.caster.isMouseOver = !0), t.onMouseEnter())
          : t.caster.isMouseOver &&
            ((t.caster.isMouseOver = !1), t.onMouseLeave());
      }
    },
    onUpdateForTransition() {
      const t = this.width * PAGE_TRANSITION.screen.radius;
      let e =
        PAGE_TRANSITION.screen.deg -
        PAGE_TRANSITION.mixAnim.ptShowScreen * PAGE_TRANSITION.screen.deg;
      e = Math.max(e, 0);
      let i = e * (Math.PI / 180),
        n = t * Math.cos(i) - t,
        r = t * Math.sin(i);
      const s =
        3 *
        Math.sin((Math.PI / 180) * 180 * PAGE_TRANSITION.page.single.ptWebGl) *
        (Math.PI / 180);
      (e > 30
        ? (this.visible = !1)
        : ((this.visible = !0),
          (this.stage.position.y =
            n +
            0.01 * WEBGL.height * PAGE_TRANSITION.page.projects.ptWebGl +
            0.2 *
              WEBGL.height *
              clamp(
                1 -
                  (PAGE_TRANSITION.page.projects.ptWebGl +
                    PAGE_TRANSITION.page.home.ptWebGl),
                0,
                1,
              ) *
              (1 - PAGE_TRANSITION.page.single.ptWebGl)),
          (this.stage.position.z = -r),
          (this.stage.rotation.x = -i),
          (this.stage.rotation.y = 0.5 * -i),
          MOUSE.enable &&
            (this.stage.rotation.z =
              s +
              PAGE_TRANSITION.anim.ptZoomIn *
                (1 - PAGE_TRANSITION.page.single.ptWebGl) *
                MOUSE.body.array[0].acceleration.delta.x *
                MOUSE.params.rotation.z *
                (Math.PI / 180))),
        this.stage &&
          (this.stage.visible = this.visible && !WEBGL.floor.isUnderWater));
    },
    onDestroy() {
      $html.classList.remove("is-hv-a");
      for (let t = 0; t < this.meshes.length; t++) {
        const e = this.meshes[t];
        e.caster && (e.caster.isMouseOver = !1);
      }
    },
  };
}
