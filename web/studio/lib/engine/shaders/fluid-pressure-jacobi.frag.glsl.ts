export const fluidPressureJacobiFrag = /* glsl */ `
#define GLSLIFY 1
uniform sampler2D uTexture;
uniform sampler2D uDivergence;
uniform float uAlpha;
uniform float uBeta;
uniform vec2 uCellSize;

varying vec2 vUv;

void main(){
    float x0 = texture2D(uTexture, vUv - vec2(uCellSize.x, 0.0)).r;
    float x1 = texture2D(uTexture, vUv + vec2(uCellSize.x, 0.0)).r;
    float y0 = texture2D(uTexture, vUv - vec2(0.0, uCellSize.y)).r;
    float y1 = texture2D(uTexture, vUv + vec2(0.0, uCellSize.y)).r;
    float b = texture2D(uDivergence, vUv).r;

    // program representation for Equation 16
    float relaxed = (x0 + x1 + y0 + y1 + uAlpha * b) * uBeta;

    gl_FragColor = vec4(relaxed);
}
`;
