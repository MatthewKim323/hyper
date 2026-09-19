
export const projectsGodraysNoiseFrag = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;
varying vec4 vWorldPosition;

uniform sampler2D uNoiseTexture;
uniform float uTime;
uniform vec2 uDirection;
uniform float uStrength;
uniform float uLength;
uniform float uFadeSmoothness;
uniform float uScale;
uniform float uSpeed;
uniform vec3 uLightColor;
uniform float fogNear;
uniform float fogFar;

const vec2 lengthDirection = vec2(0., -1.);
const vec2 center = vec2(0.5);

void main() {
	vec2 worldPos = vWorldPosition.xy * 0.1;
	vec2 godRayOrigin = worldPos + vec2(-uDirection.x, uDirection.y);
    float uvDirection = atan(godRayOrigin.y, godRayOrigin.x);
	uvDirection *= uScale;

	float noise1 = texture2D(uNoiseTexture, vec2(uvDirection - uTime * 0.01)).r;
	float noise2 = texture2D(uNoiseTexture, vec2(uvDirection + uTime * 0.05 * uSpeed, uvDirection) * 1.5).g;
	float alpha = min(noise1, noise2);

	vec2 v2 = normalize(lengthDirection);
    float d = v2.x * center.x + v2.y * center.y;
	float length = uLength;
	alpha *= (1.0 - smoothstep(-uFadeSmoothness, 0.0, v2.x * vUv.x + v2.y * vUv.y - (d - 0.5 + length * (1. + uFadeSmoothness))));

	alpha *= uStrength;

	gl_FragColor = vec4(uLightColor, alpha);

	gl_FragColor.a *= smoothstep(0., 500., cameraPosition.z - 1000. - vWorldPosition.z);

	float fogDepth = gl_FragCoord.z / gl_FragCoord.w;
	float fogFactor = smoothstep(fogNear, fogFar, fogDepth);
	gl_FragColor.a = mix(gl_FragColor.a, 0., fogFactor);
}`;
