#define GLSLIFY 1
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;
uniform vec3 tColor;
uniform float alpha;
uniform float opacity;
uniform float time;
uniform sampler2D tDiffuse;
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
uniform float cnoiseDisp;
uniform float cnoisePower;
uniform float colorPower;

void main() {

	float noise = cnoise( vec3( vec2( vUv * cnoiseDisp ), time ));
	float emphasizedNoise = noise * (1.0 - noise) * cnoisePower; // 0近くと1近くで強調

	float col = sin(1.0 - vUv.y) * sin(vUv.x);
	float a = clamp( ( col + clamp( noise, 0.0, 0.5 ) ) * alpha, 0.2, 1.0 );
	col = col + emphasizedNoise;

	float offsetStrength = length( sin(vUv) - 0.5) * colorPower;
	vec3 originalColor = tColor * clamp(col, 0.0, 1.0);

	vec3 offsetR = vec3(0.1, -0.05, -0.05) * offsetStrength;
	vec3 offsetG = vec3(-0.05, 0.1, -0.05) * offsetStrength;
	vec3 offsetB = vec3(-0.05, -0.05, 0.1) * offsetStrength;

	vec3 colorR = originalColor + offsetR;
	vec3 colorG = originalColor + offsetG;
	vec3 colorB = originalColor + offsetB;

	vec3 finalColor = mix( mix( colorR, colorB, vUv.y ), colorB, vUv.y );
	finalColor = clamp( finalColor * finalColor + a, 0.2, 1.0 );
	gl_FragColor = vec4( finalColor, a * opacity );
}