export const worldIntroTextFlickerFrag = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;

uniform float u_time;
uniform float u_strength;
uniform float u_opacity;

void main () {
	vec4 color = vec4(1.);

	float time = fract(u_time * u_strength) * 15.;
	float division = 1. / 12.;

    float a1 = (step(division, abs(vUv.x - division)) + sin(time + 1.12)) * u_opacity;
    float a2 = (step(division, abs(vUv.x - division * 3.)) + sin(time + 0.25)) * u_opacity;
	float a3 = (step(division, abs(vUv.x - division * 5.)) + sin(time + 1.23)) * u_opacity;
    float a4 = (step(division, abs(vUv.x - division * 7.)) + sin(time + 0.86)) * u_opacity;
	float a5 = (step(division, abs(vUv.x - division * 9.)) + sin(time + 1.832)) * u_opacity;
    float a6 = (step(division, abs(vUv.x - division * 11.)) + sin(time + 1.)) * u_opacity;

	color.a = a1 * a2 * a3 * a4 * a5 * a6;
	gl_FragColor = color;
}
`;
