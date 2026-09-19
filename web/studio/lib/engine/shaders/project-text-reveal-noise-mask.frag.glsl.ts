export const projectTextRevealNoiseMaskFrag = /* glsl */ `
precision highp float;
#define GLSLIFY 1

varying vec3 vWorldPosition;
varying vec2 vUv;

uniform vec3 u_bgColor;
uniform float u_progress;
uniform float u_scrollPos;
uniform float u_ratio;

float scale = 0.03; // = 4.0
float smoothness = 0.5; // = 0.01
float seed = 12.9898; // = 12.9898

// http://byteblacksmith.com/improvements-to-the-canonical-one-liner-glsl-rand-for-opengl-es-2-0/
float random(vec2 co)
{
    highp float a = seed;
    highp float b = 78.233;
    highp float c = 43758.5453;
    highp float dt= dot(co.xy ,vec2(a,b));
    highp float sn= mod(dt,3.14);
    return fract(sin(sn) * c);
}

// 2D Noise based on Morgan McGuire @morgan3d
// https://www.shadertoy.com/view/4dS3Wd
float noise (in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);

    // Four corners in 2D of a tile
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));

    // Smooth Interpolation

    // Cubic Hermine Curve.  Same as SmoothStep()
    vec2 u = f*f*(3.0-2.0*f);
    // u = smoothstep(0.,1.,f);

    // Mix 4 coorners porcentages
    return mix(a, b, u.x) +
            (c - a)* u.y * (1.0 - u.x) +
            (d - b) * u.x * u.y;
}

void main() {
    vec4 from = vec4(u_bgColor.rgb, 1.);
    vec4 to = vec4(u_bgColor.rgb, 0.);

	vec2 ratio = vec2(1.0, 1.0 / u_ratio);
	float dist = length((vec2(vUv) - vec2(0., 1.)) * ratio * 0.75);

    float n = noise(vec2(vWorldPosition.x, vWorldPosition.y - u_scrollPos) * scale);

    float p = mix(-smoothness, 1.0 + smoothness, u_progress);
    float lower = p - smoothness;
    float higher = p + smoothness;

	float edge = smoothstep(lower, higher, n);
	float q = smoothstep(u_progress - edge, u_progress, dist);

	gl_FragColor = mix(from, to, 1. - q);
}
`;
