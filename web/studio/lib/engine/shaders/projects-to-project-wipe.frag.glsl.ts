
export const projectsToProjectWipeFrag = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform vec3 u_bgColor;
uniform float u_progress;
uniform float u_opacity;

const vec2 center = vec2(0.5, 0.5);
const float smoothness = 0.6;

void main() {
	vec2 v = normalize(vec2(1., 0.));
	v /= abs(v.x)+abs(v.y);
	float d = v.x * center.x + v.y * center.y;
	float m =
		(1.0-step(1. - u_progress, 0.0)) *
		(1.0 - smoothstep(-smoothness, 0.0, v.x * vUv.x + v.y * vUv.y - (d-0.5+(1. - u_progress)*(1.+smoothness))));
	m = clamp(m, 0.0, 1.0);

	vec4 sceneColor = texture2D(tDiffuse, vUv);
	if (sceneColor.a < 1.) {
		sceneColor = vec4(u_bgColor, 0.);
	}

	gl_FragColor = mix(vec4(u_bgColor, u_opacity), sceneColor, m);
}`;
