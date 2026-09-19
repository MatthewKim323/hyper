// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";

export default function initialize() {
  "use strict";
  var n = THREE;
  WEBGL.mouse = {
    ready: !1,
    once() {
      ((this.scene = new n.Scene()),
        (this.fbo = new n.WebGLRenderTarget(
          WEBGL.gloablWidth * RES.ratio,
          WEBGL.gloablHeight * RES.ratio,
          { minFilter: n.LinearFilter, magFilter: n.LinearFilter },
        )),
        this.onInit(),
        (this.ready = !0));
    },
    params: { mouse: { size: 0.8, age: 0.2 }, trail: { power: 0.1 } },
    onInit() {
      let t = [],
        e = [],
        i = [];
      for (let r = 0; r < TRAILS.maxAge; r++)
        (t.push(new n.Vector2()), e.push(0), i.push(0));
      ((this.geometry = new n.PlaneGeometry(1, 1, 1, 1)),
        (this.material = new n.ShaderMaterial({
          vertexShader: NormalVert,
          fragmentShader: `const int MAX_TRAIL_SIZE = ${TRAILS.maxAge};\n\t\t\t#define GLSLIFY 1\nvarying vec2 vUv;\nuniform vec2 resolution;\nuniform int mouseTrailsCount;\nuniform vec2 mouseTrailsArray[MAX_TRAIL_SIZE];\nuniform float mouseTrailsIntensity[MAX_TRAIL_SIZE];\nuniform float mouseTrailsAge[MAX_TRAIL_SIZE];\nuniform float mouseTrailsMaxAge;\nuniform float mouseTrailsSize;\nuniform float mouseTrailsAgeRatio;\n\nfloat calculateTotalTrailColor(vec2 uv) {\n\tfloat totalTrailColor = 0.0;\n\tfor (int i = 0; i < mouseTrailsCount; i++) {\n\t\tif( mouseTrailsIntensity[i] != 0.0 ){\n\t\t\tvec2 trailPos = vec2(mouseTrailsArray[i].x, mouseTrailsArray[i].y * resolution.y / resolution.x);\n\t\t\tfloat distance = distance(uv, trailPos);\n\t\t\tfloat ageFactor = 1.0 - mouseTrailsAge[i] / mouseTrailsMaxAge;\n\t\t\tfloat adjustedSize = mouseTrailsSize * (1.0 + ageFactor * mouseTrailsAgeRatio) * 0.1;\n\t\t\tfloat trailIntensity = mouseTrailsIntensity[i] * (1.0 - mouseTrailsAge[i] / mouseTrailsMaxAge);\n\t\t\tfloat trailValue = mix(1.0, 0.0, clamp(distance / adjustedSize, 0.0, 1.0));\n\t\t\tfloat trailAdd = clamp( trailValue * trailIntensity, 0.0, 1.0 );\n\t\t\ttotalTrailColor += trailAdd;\n\t\t}\n\t}\n\treturn totalTrailColor;\n}\n\nvoid main() {\n\tvec2 vUvA = vec2( vUv.x, vUv.y * resolution.y / resolution.x );\n\tfloat trailColor = calculateTotalTrailColor(vUvA);\n\tgl_FragColor = vec4(1.0, 0.0, 0.0, trailColor );\n}`,
          transparent: !0,
          uniforms: {
            resolution: { value: { x: 0, y: 0 } },
            mouseTrailsCount: { value: TRAILS.maxAge },
            mouseTrailsArray: { value: t },
            mouseTrailsIntensity: { value: e },
            mouseTrailsAge: { value: i },
            mouseTrailsMaxAge: { value: TRAILS.maxAge },
            mouseTrailsSize: { value: this.params.mouse.size },
            mouseTrailsAgeRatio: { value: this.params.mouse.age },
          },
        })),
        (this.mesh = new n.Mesh(this.geometry, this.material)),
        this.scene.add(this.mesh));
    },
    onUpdate() {
      if (this.material.uniforms.mouseTrailsCount) {
        clamp(
          MOUSE.body.array[2].acceleration.delta.distance *
            this.params.trail.power +
            MOUSE.body.array[0].acceleration.delta.distance *
              (1 - this.params.trail.power),
          0,
          1,
        );
        let t =
          MOUSE.body.move.active *
          this.params.mouse.size *
          SPLASH.params.ptMouseTrailsSize;
        ((this.material.uniforms.mouseTrailsSize.value = clamp(t, 0, 1)),
          (this.material.uniforms.mouseTrailsAgeRatio.value =
            this.params.mouse.age),
          (this.material.uniforms.mouseTrailsCount.value = Math.min(
            TRAILS.body.trails.length,
            TRAILS.maxAge,
          )));
        for (let t = 0; t < TRAILS.body.trails.length; t++) {
          const e = TRAILS.body.trails[t];
          this.material.uniforms.mouseTrailsArray.value[t] &&
            ((this.material.uniforms.mouseTrailsArray.value[t].x = e.x),
            (this.material.uniforms.mouseTrailsArray.value[t].y = e.y),
            (this.material.uniforms.mouseTrailsIntensity.value[t] =
              e.intensity),
            (this.material.uniforms.mouseTrailsAge.value[t] = e.age));
        }
      }
    },
    onRender() {
      (WEBGL.renderer.setRenderTarget(this.fbo),
        WEBGL.renderer.render(this.scene, WEBGL.scenes.cameras.ocam));
    },
    onResize() {
      (this.fbo &&
        this.fbo.setSize(0.05 * WEBGL.gloablWidth, 0.05 * WEBGL.gloablHeight),
        this.mesh &&
          ((this.mesh.scale.x = WEBGL.width),
          (this.mesh.scale.y = WEBGL.height),
          (this.mesh.position.x = 0),
          (this.mesh.position.y = 0),
          (this.mesh.position.z = 0),
          (this.mesh.material.uniforms.resolution.value.x = this.mesh.scale.x),
          (this.mesh.material.uniforms.resolution.value.y =
            this.mesh.scale.y)));
    },
  };
}
