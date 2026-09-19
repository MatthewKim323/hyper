// Recovered responsive implementation. See PROVENANCE.md.
import * as THREE from "three";
export default function initialize() {
  var n = THREE;
  const r = WEBGL.scenes.first;
  WEBGL.scenes.first.frame = {
    segmentW: 1,
    segmentH: 1,
    segmentD: 1,
    ready: !1,
    once() {
      ((this.geometry = new n.BoxGeometry(
        1,
        1,
        1,
        this.segmentW,
        this.segmentH,
        this.segmentD,
      )),
        (this.side = new n.ShaderMaterial({
          vertexShader:
            "\n\t\t\t\tvarying vec2 vUv;\n\t\t\t\tvoid main(){\n\t\t\t\t\tvUv = uv;\n\t\t\t\t\tgl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);\n\t\t\t\t}\n\t\t\t",
          fragmentShader:
            "\n\t\t\t\tvarying vec2 vUv;\n\t\t\t\tuniform vec3 color;\n\t\t\t\tvec3 LinearTosRGB(vec3 linear) {\n\t\t\t\t\treturn pow(linear, vec3(1.0 / 2.2));\n\t\t\t\t}\n\t\t\t\tvoid main() {\n\t\t\t\t\tgl_FragColor = vec4( LinearTosRGB(color), 1.0 );\n\t\t\t\t}\n\t\t\t",
          uniforms: { color: { value: COLOR.table.frame.three } },
          depthWrite: !1,
          depthTest: !0,
        })),
        (this.mesh = new n.Mesh(this.geometry, this.side)),
        (this.mesh.renderOrder = 1),
        WEBGL.scenes.first.stage.add(this.mesh),
        (this.ready = !0));
    },
    onResize() {},
    onUpdate() {
      ((this.mesh.scale.x =
        (r.screen.scale.x + 0.02 * WEBGL.width) * SPLASH.params.ptBarScaleX),
        (this.mesh.scale.y = r.screen.scale.y + 0.015 * WEBGL.width),
        (this.mesh.scale.z = 0.05 * WEBGL.width * SPLASH.params.ptBarScaleZ),
        (this.mesh.position.z =
          -this.mesh.scale.z * SPLASH.params.ptCameraAngle),
        (this.mesh.rotation.y = r.screen.rotation.y),
        (this.mesh.rotation.z = r.screen.rotation.z));
    },
  };
}
