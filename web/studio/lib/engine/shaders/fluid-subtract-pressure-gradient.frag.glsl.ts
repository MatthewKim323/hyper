export const fluidSubtractPressureGradientFrag = /* glsl */ `
#define GLSLIFY 1
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uCellSize;

varying vec2 vUv;

void main() {

    float x0 = texture2D(uPressure, vUv - vec2(uCellSize.x, 0)).r;
    float x1 = texture2D(uPressure, vUv + vec2(uCellSize.x, 0)).r;
    float y0 = texture2D(uPressure, vUv - vec2(0, uCellSize.y)).r;
    float y1 = texture2D(uPressure, vUv + vec2(0, uCellSize.y)).r;

    vec2 v = texture2D(uVelocity, vUv).xy;

    // subtract gradient of pressure from velocity
    gl_FragColor = vec4(
        (v - vec2(x1 - x0, y1 - y0) * 0.5),
        1.0,
        1.0
    );

}
`;
