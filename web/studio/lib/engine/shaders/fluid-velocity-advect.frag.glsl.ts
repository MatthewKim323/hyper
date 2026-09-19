export const fluidVelocityAdvectFrag = /* glsl */ `
#define GLSLIFY 1
varying vec2 vUv;

uniform sampler2D uTexture;
uniform vec2 uCellSize;
uniform vec2 uForce;
uniform vec2 uMouse;
uniform vec2 uPrevMouse;
uniform vec2 uMouseVelocity;
uniform float uMouseRadius;
uniform float uPressure;

float sdLine( vec2 p, vec2 a, vec2 b ){
	float velocity = clamp(length(uMouseVelocity), 0.5, 1.5);
	vec2 pa = p - a, ba = b - a;
	float h = clamp( dot(pa, ba)/dot(ba, ba), 0.0, 1.0 );
	return length( pa - ba*h ) / velocity;
}

void main() {

    vec4 color = texture2D(uTexture, vUv - texture2D(uTexture, vUv).xy * uCellSize);

    // apply mouse interaction
    float dir = smoothstep(1. - uMouseRadius, 1., 1.0 - min(sdLine(vUv, uPrevMouse, uMouse), 1.0));
    vec4 minColor = vec4(-1.);
    vec4 maxColor = vec4(1.);
    color = clamp((color + vec4(uForce * dir, 0.0, 1.0)) * uPressure, minColor, maxColor); // blend
    gl_FragColor = color;
}
`;
