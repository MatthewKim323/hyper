
export const homeTransitionWipeZoomFrag = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;

uniform sampler2D u_fromScene;
uniform sampler2D u_toScene;
uniform sampler2D u_noise;
uniform float u_progress;
uniform float u_time;

vec2 mirrored(vec2 v) {
	vec2 m = mod(v, 2.);
	return mix(m, 2.0 - m, step(1.0, m));
}

void main() {
	vec2 noiseUv = vUv + u_time * 0.04;
	noiseUv.x *= 0.1;
	vec4 noise = texture2D(u_noise, mirrored(noiseUv));
	float prog = u_progress - 0.05 + noise.g * 0.06;
	float intpl = pow(abs(smoothstep(0., 1., (prog * 2. - vUv.y + 0.5))), 20.);

	vec4 fromColor = texture2D(u_fromScene, (vUv - 0.5) * (1.0 - intpl) + 0.5);
	vec4 toColor = texture2D(u_toScene, (vUv - 0.5) * intpl + 0.5);
	gl_FragColor = mix(fromColor, toColor, intpl);
}`;
