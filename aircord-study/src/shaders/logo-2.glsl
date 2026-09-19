#define GLSLIFY 1
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;
uniform vec3 tColor;
uniform float alpha;
uniform float opacity;
uniform float time;
uniform vec2 mouse;
uniform float cnoiseDisp;
uniform float cnoisePower;
uniform float mousePower;
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
void main() {
	float dist = distance( normalize(vViewPosition).xy, mouse );
	float glow = smoothstep( 1.0, mousePower, dist );
	float g = glow + clamp( cnoise( vec3( vec2( vUv * cnoiseDisp ), time ) ) * cnoisePower, 0.0, 1.0 );
	gl_FragColor = vec4( tColor.rgb, g * alpha * opacity );
}