export const projectTransitionPlaneColorSweepFrag = /* glsl */ `
#define GLSLIFY 1
#define M_PI 3.141592653589

varying vec2 vUv;

uniform vec3 u_toColor;
uniform float u_progress;
uniform float u_adjust;
uniform float u_velo;

void main() {
	vec2 uv = vUv;
	float pct = 1. - ((distance(uv, vec2(.5))) * u_adjust);
    pct = smoothstep(0., 1., pct);
    uv.y -= ((sin(uv.x * M_PI) * u_velo) * .5);
    float tf = step(uv.y, clamp(u_progress * pct, 0., 1.));
    vec4 finalColor = mix(vec4(0.), vec4(u_toColor, 1.), tf);
	gl_FragColor = finalColor;
}
`;
