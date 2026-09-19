#define GLSLIFY 1
uniform float time;
uniform mat4 textureMatrix;
varying vec4 vUv4;
varying vec2 vUv2;
varying vec3 vNormal;
varying vec3 vViewPosition;
uniform vec2 uv_resolution;
uniform float cnoiseDisp;
uniform float cnoiseHeight;
uniform float cnoiseAlpha;
varying float vNoise;
uniform float curveEffect;
vec3 hash(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}

float cnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float a = dot(hash(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0));
    float b = dot(hash(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
    float c = dot(hash(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
    float d = dot(hash(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
    float e = dot(hash(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
    float f_val = dot(hash(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
    float g = dot(hash(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
    float h = dot(hash(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
    float k0 = mix(a, b, u.x);
    float k1 = mix(c, d, u.x);
    float k2 = mix(e, f_val, u.x);
    float k3 = mix(g, h, u.x);
    float l0 = mix(k0, k1, u.y);
    float l1 = mix(k2, k3, u.y);
    return mix(l0, l1, u.z);
}
#include <common>

void main() {

	vUv2 = uv;
	vUv4 = textureMatrix * vec4( position, 1.0 );
	vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
	float curve = radians( vUv2.y * 180.0 - 90.0 );
	float curveCos = cos( curve );
	float curveRadius = uv_resolution.x * 0.5;
	float curvePower = vUv2.y >= 0.5 ? ( curveCos * curveRadius - curveRadius ) : 0.0;
	vNoise = clamp( ( cnoise( vec3( vec2( vUv2 * uv_resolution * cnoiseDisp ), time ) )) * cnoiseHeight, -1.0, 1.0 );
	mvPosition.y = mvPosition.y - vNoise + curvePower * curveEffect;

	if( vUv2.y <= 0.0 ){
		mvPosition.y = mvPosition.z;
	}

	vViewPosition = -mvPosition.xyz;
	vNormal = normalize(mat3(modelViewMatrix) * normal);
	gl_Position = projectionMatrix * mvPosition;

}