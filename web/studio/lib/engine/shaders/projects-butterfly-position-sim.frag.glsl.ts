
export const projectsButterflyPositionSimFrag = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;

uniform sampler2D uBaseTexture;
uniform sampler2D uTexture;
uniform sampler2D u_velocity;
uniform float u_time;
uniform float uDelta;
uniform vec2 uResolution;
uniform vec2 u_screenResolution;
uniform vec3 u_mouse;

float random(vec2 co) {
	float a = 12.9898;
	float b = 78.233;
	float c = 43758.5453;
	float dt = dot(co.xy, vec2(a, b));
	float sn = mod(dt, 3.14);
	return fract(sin(sn) * c);
}

void main() {
	vec2 uv = gl_FragCoord.xy / uResolution.xy;
	vec4 origPos = texture2D(uBaseTexture, uv);
	vec4 tmpPos = texture2D(uTexture, uv);
	vec3 position = tmpPos.xyz;
	vec3 velocity = texture2D(u_velocity, uv).xyz;

	float phase = tmpPos.w;

	float randomVal = random(position.xy);

	if (abs(u_mouse.x) < 1.0 && abs(u_mouse.y) < 1.0 && randomVal < 0.01 && origPos.w > 1. && phase < 100.) {
		phase = 100.;
		position.xyz = vec3(u_mouse.x * u_screenResolution.x * 0.6, u_mouse.y * u_screenResolution.y * 0.6, 800.0);
	}

	if (phase >= 100. && phase <= 101.) {
		phase += 0.05;
	}

	if (phase >= 101.) {
		phase = max(0.06, length(velocity) * 0.04);
	} else if (phase < 100.) {
		phase += max(0.06, length(velocity) * 0.04);
	}

	gl_FragColor = vec4(position + velocity * uDelta * 12., phase);
}`;
