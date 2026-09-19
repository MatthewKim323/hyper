// Recovered responsive implementation. See PROVENANCE.md.
import * as THREE from "three";
export default function initialize() {
  "use strict";
  var n = THREE;
  WEBGL.scenes.final = {
    ready: !1,
    fbo: null,
    screen: null,
    material: null,
    geometry: null,
    scene: null,
    fov: 20,
    params: {
      noise: 0.05,
      alpha: 1,
      mouse: { size: 0.4, age: 1 },
      color: { rgbPow: 1, rgbMul: 1, rgbAdd: 0 },
      icon: {
        scale: 0.4,
        roughness: 0,
        metalness: 0.33,
        transmission: 1,
        thickness: 3.2,
      },
    },
    output: { scene: new n.Scene(), fbo: null, mesh: null },
    once() {
      ((this.output.fbo = new n.WebGLRenderTarget(
        WEBGL.gloablWidth * RES.ratio,
        WEBGL.gloablHeight * RES.ratio,
        {
          format: n.RGBFormat,
          minFilter: n.LinearFilter,
          magFilter: n.LinearFilter,
        },
      )),
        this.onInitOutput(),
        (this.ready = !0));
    },
    onInitOutput() {
      var t;
      const e =
          null !== (t = WEBGL.mouse) && void 0 !== t && t.fbo.texture
            ? WEBGL.mouse.fbo.texture
            : null,
        i = new n.PlaneGeometry(1, 1),
        r = new n.ShaderMaterial({
          vertexShader: NormalVert,
          fragmentShader:
            '#define GLSLIFY 1\nvarying vec2 vUv;\nuniform sampler2D tDiffuse;\nuniform vec2 uv_resolution;\nuniform float noise;\nuniform sampler2D tMouse;\nuniform float mozX;\nuniform float mozPower;\nuniform vec2 mouse;\nuniform vec2  mouseNoisePower;\nuniform vec2  mouseNoiseDir;\nuniform vec2  mouseNoiseDisp;\nuniform float mouseNoiseRatio;\n\n/**\nBasic FXAA implementation based on the code on geeks3d.com with the\nmodification that the texture2DLod stuff was removed since it\'s\nunsupported by WebGL.\n\n--\n\nFrom:\nhttps://github.com/mitsuhiko/webgl-meincraft\n\nCopyright (c) 2011 by Armin Ronacher.\n\nSome rights reserved.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are\nmet:\n\n    * Redistributions of source code must retain the above copyright\n      notice, this list of conditions and the following disclaimer.\n\n    * Redistributions in binary form must reproduce the above\n      copyright notice, this list of conditions and the following\n      disclaimer in the documentation and/or other materials provided\n      with the distribution.\n\n    * The names of the contributors may not be used to endorse or\n      promote products derived from this software without specific\n      prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS\n"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT\nLIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR\nA PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT\nOWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,\nSPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT\nLIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,\nDATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY\nTHEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT\n(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE\nOF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.\n*/\n\n#ifndef FXAA_REDUCE_MIN\n    #define FXAA_REDUCE_MIN   (1.0/ 128.0)\n#endif\n#ifndef FXAA_REDUCE_MUL\n    #define FXAA_REDUCE_MUL   (1.0 / 8.0)\n#endif\n#ifndef FXAA_SPAN_MAX\n    #define FXAA_SPAN_MAX     8.0\n#endif\n\n//optimized version for mobile, where dependent \n//texture reads can be a bottleneck\nvec4 fxaa(sampler2D tex, vec2 fragCoord, vec2 resolution,\n            vec2 v_rgbNW, vec2 v_rgbNE, \n            vec2 v_rgbSW, vec2 v_rgbSE, \n            vec2 v_rgbM) {\n    vec4 color;\n    mediump vec2 inverseVP = vec2(1.0 / resolution.x, 1.0 / resolution.y);\n    vec3 rgbNW = texture2D(tex, v_rgbNW).xyz;\n    vec3 rgbNE = texture2D(tex, v_rgbNE).xyz;\n    vec3 rgbSW = texture2D(tex, v_rgbSW).xyz;\n    vec3 rgbSE = texture2D(tex, v_rgbSE).xyz;\n    vec4 texColor = texture2D(tex, v_rgbM);\n    vec3 rgbM  = texColor.xyz;\n    vec3 luma = vec3(0.299, 0.587, 0.114);\n    float lumaNW = dot(rgbNW, luma);\n    float lumaNE = dot(rgbNE, luma);\n    float lumaSW = dot(rgbSW, luma);\n    float lumaSE = dot(rgbSE, luma);\n    float lumaM  = dot(rgbM,  luma);\n    float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));\n    float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));\n    \n    mediump vec2 dir;\n    dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));\n    dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));\n    \n    float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) *\n                          (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);\n    \n    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);\n    dir = min(vec2(FXAA_SPAN_MAX, FXAA_SPAN_MAX),\n              max(vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX),\n              dir * rcpDirMin)) * inverseVP;\n    \n    vec3 rgbA = 0.5 * (\n        texture2D(tex, fragCoord * inverseVP + dir * (1.0 / 3.0 - 0.5)).xyz +\n        texture2D(tex, fragCoord * inverseVP + dir * (2.0 / 3.0 - 0.5)).xyz);\n    vec3 rgbB = rgbA * 0.5 + 0.25 * (\n        texture2D(tex, fragCoord * inverseVP + dir * -0.5).xyz +\n        texture2D(tex, fragCoord * inverseVP + dir * 0.5).xyz);\n\n    float lumaB = dot(rgbB, luma);\n    if ((lumaB < lumaMin) || (lumaB > lumaMax))\n        color = vec4(rgbA, texColor.a);\n    else\n        color = vec4(rgbB, texColor.a);\n    return color;\n}\n\n//To save 9 dependent texture reads, you can compute\n//these in the vertex shader and use the optimized\n//frag.glsl function in your frag shader. \n\n//This is best suited for mobile devices, like iOS.\n\nvoid texcoords(vec2 fragCoord, vec2 resolution,\n\t\t\tout vec2 v_rgbNW, out vec2 v_rgbNE,\n\t\t\tout vec2 v_rgbSW, out vec2 v_rgbSE,\n\t\t\tout vec2 v_rgbM) {\n\tvec2 inverseVP = 1.0 / resolution.xy;\n\tv_rgbNW = (fragCoord + vec2(-1.0, -1.0)) * inverseVP;\n\tv_rgbNE = (fragCoord + vec2(1.0, -1.0)) * inverseVP;\n\tv_rgbSW = (fragCoord + vec2(-1.0, 1.0)) * inverseVP;\n\tv_rgbSE = (fragCoord + vec2(1.0, 1.0)) * inverseVP;\n\tv_rgbM = vec2(fragCoord * inverseVP);\n}\n\nvec4 apply(sampler2D tex, vec2 fragCoord, vec2 resolution) {\n\tmediump vec2 v_rgbNW;\n\tmediump vec2 v_rgbNE;\n\tmediump vec2 v_rgbSW;\n\tmediump vec2 v_rgbSE;\n\tmediump vec2 v_rgbM;\n\n\t//compute the texture coords\n\ttexcoords(fragCoord, resolution, v_rgbNW, v_rgbNE, v_rgbSW, v_rgbSE, v_rgbM);\n\t\n\t//compute FXAA\n\treturn fxaa(tex, fragCoord, resolution, v_rgbNW, v_rgbNE, v_rgbSW, v_rgbSE, v_rgbM);\n}\n\nfloat random(vec2 st) {\n\treturn fract( sin( dot( st.xy, vec2(12.9898, 78.233)) ) * 43758.5453123 );\n}\nfloat random(float v) {\n\treturn fract( sin( v ) * 43758.5453123 );\n}\n\nuniform vec2 slitDisp;\nuniform float slitRatio;\nuniform vec2 wd_resolution;\n\nuniform float noiseAlpha;\n\nconst float radius = 0.15;\nconst float power = 1.0;\n\nvoid main() {\n\n\tvec4 iDiffuse = texture2D( tDiffuse, vUv );\n\tvec4 iMouse = texture2D( tMouse, vUv );\n\n\tfloat zNoise = random(vUv) * noise * noiseAlpha;\n\n\tfloat aspect = uv_resolution.x/uv_resolution.y;\n\tvec2 distVec = ( vUv - mouse ) * vec2( max( 1.0, aspect ), max( 1.0, 1.0 / aspect) );\n\tfloat distLen = length( distVec );\n\tfloat gr = clamp( 1.0 - pow( distLen / radius, power ), 0.0, 1.0 );\n\n\tvec2 screenCoord = gl_FragCoord.xy / wd_resolution;\n\tvec2 slitNoiseXY = vec2(\n\t\trandom( screenCoord.x * slitDisp.x ),\n\t\trandom( screenCoord.y * slitDisp.y )\n\t);\n\tslitNoiseXY = (slitNoiseXY * iDiffuse.a * gr * mouseNoisePower );\n\tvec2 uvNoise = vUv + slitNoiseXY * slitRatio * mouseNoiseDir;\n\n\tvec2 fragCoord = uvNoise * uv_resolution;\t\t\n\tgl_FragColor = apply( tDiffuse, fragCoord, uv_resolution );\n\tgl_FragColor.rgb += (zNoise - iMouse.a * 0.02);\n\n}',
          uniforms: {
            uv_resolution: { value: { x: 0, y: 0 } },
            tDiffuse: { value: this.output.fbo.texture },
            noise: { value: this.params.noise },
            noiseAlpha: { value: 1 },
            tMouse: { value: e },
            mozX: { value: 2 * WEBGL.screen.params.mozX },
            mozPower: { value: WEBGL.screen.params.mozPower },
            wd_resolution: { value: { x: WW, y: WH } },
            slitDisp: { value: WEBGL.screen.params.slit.disp },
            slitRatio: { value: WEBGL.screen.params.slit.ratio },
            mouse: { value: { x: 0, y: 0 } },
            mouseNoiseRatio: { value: WEBGL.screen.params.mouse.ratio },
            mouseNoiseDisp: { value: WEBGL.screen.params.mouse.disp },
            mouseNoisePower: { value: WEBGL.screen.params.mouse.power },
            mouseNoiseDir: { value: { x: 0, y: 0 } },
          },
        });
      ((this.output.mesh = new n.Mesh(i, r)),
        this.output.scene.add(this.output.mesh));
    },
    onUpdate() {
      ((this.output.mesh.material.uniforms.noise.value =
        (this.params.noise -
          2 * this.params.noise * PAGE_TRANSITION.mixAnim.ptZoom) *
        (RES.ratio / 2)),
        (this.output.mesh.material.uniforms.noiseAlpha.value = clamp(
          SPLASH.params.ptNoiseAlpha - 0.5 * COLOR.power.light,
          0,
          1,
        )),
        MOUSE.enable &&
          ((this.output.mesh.material.uniforms.slitRatio.value =
            WEBGL.screen.params.slit.ratio *
            MOUSE.body.array[1].acceleration.delta.distance *
            (PAGE_TRANSITION.page.home.ptWebGl +
              PAGE_TRANSITION.page.single.ptWebGl +
              PAGE_TRANSITION.page.about.ptWebGl +
              PAGE_TRANSITION.page.error.ptWebGl)),
          (this.output.mesh.material.uniforms.mouse.value.x =
            0.5 * MOUSE.body.array[1].shader.x + 0.5),
          (this.output.mesh.material.uniforms.mouse.value.y =
            0.5 * MOUSE.body.array[1].shader.y + 0.5),
          (this.output.mesh.material.uniforms.mouseNoiseDir.value.x =
            -2 * MOUSE.body.array[0].acceleration.delta.x),
          (this.output.mesh.material.uniforms.mouseNoiseDir.value.y =
            -2 * MOUSE.body.array[0].acceleration.delta.y),
          (this.output.mesh.material.uniforms.slitDisp.value.x =
            WEBGL.screen.params.slit.disp.x),
          (this.output.mesh.material.uniforms.slitDisp.value.y =
            WEBGL.screen.params.slit.disp.y)));
    },
    onResize() {
      (this.output.fbo &&
        this.output.fbo.setSize(
          WEBGL.gloablWidth * RES.ratio,
          WEBGL.gloablHeight * RES.ratio,
        ),
        (this.output.mesh.scale.x = WEBGL.width),
        (this.output.mesh.scale.y = WEBGL.height),
        (this.output.mesh.material.uniforms.uv_resolution.value.x =
          WEBGL.gloablWidth * RES.ratio),
        (this.output.mesh.material.uniforms.uv_resolution.value.y =
          WEBGL.gloablHeight * RES.ratio),
        (this.output.mesh.material.uniforms.wd_resolution.value.x = WW),
        (this.output.mesh.material.uniforms.wd_resolution.value.y = WH));
    },
    onRender() {
      (WEBGL.renderer.setRenderTarget(this.output.fbo),
        WEBGL.renderer.render(
          WEBGL.scenes.second.scene,
          WEBGL.scenes.cameras.pcam,
        ),
        WEBGL.renderer.setRenderTarget(null),
        WEBGL.renderer.render(this.output.scene, WEBGL.scenes.cameras.pcam));
    },
  };
}
