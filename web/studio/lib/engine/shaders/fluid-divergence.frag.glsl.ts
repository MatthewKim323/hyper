export const fluidDivergenceFrag = /* glsl */ `
#define GLSLIFY 1
varying vec2 vUv;

uniform sampler2D uVelocity;
uniform vec2 uCellSize;
uniform float uViscosity;

void main() {
    // gradient
    float x0 = texture2D(uVelocity, vUv - vec2(uCellSize.x, 0.0)).x;
    float x1 = texture2D(uVelocity, vUv + vec2(uCellSize.x, 0.0)).x;
    float y0 = texture2D(uVelocity, vUv - vec2(0.0, uCellSize.y)).y;
    float y1 = texture2D(uVelocity, vUv + vec2(0.0, uCellSize.y)).y;

    float divergence = (x1 - x0 + y1 - y0) * uViscosity;
    gl_FragColor = vec4(divergence);
}
`;
