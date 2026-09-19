
export const homeHeroTextFluidIridescentFrag = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;

uniform sampler2D uTexture;
uniform sampler2D uFluidTexture;
uniform float uOpacity;
uniform vec3 uTextColor1;
uniform vec3 uTextColor2;
uniform vec3 uTextColor3;
uniform vec3 uTextColor4;
uniform float uProgress;

const vec3 W = vec3(0.2125, 0.7154, 0.0721);
float luminance(in vec3 color) {
    return dot(color, W);
}

float scale = 15.; // = 4.0
float smoothness = 0.1; // = 0.01
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
	vec2 uv = vUv;

	vec2 ratio = vec2(1.0, 1.0 / 1.6);
	float dist = length((vec2(vUv) - vec2(0., 1.)) * ratio * 0.75);

	gl_FragColor = vec4(1.);

	vec4 fluid = texture2D(uFluidTexture, vUv);
	vec2 fluidPos = -normalize(fluid.rgb).xy;

	if (uProgress < 1.) {
		float n = noise(vUv * scale);
		float p = mix(-smoothness, 1.0 + smoothness, uProgress);
		float lower = p - smoothness;
		float higher = p + smoothness;

		float edge = smoothstep(lower, higher, n);
		float q = smoothstep(uProgress - edge, uProgress, dist);
		gl_FragColor.a *= 1. - q;
	}

	uv += fluidPos * 0.025;

	vec4 tex = texture2D(uTexture, uv);
	float lum = luminance(abs(fluid.rgb));
	float intensity = smoothstep(0., 1., (abs(normalize(fluid.xyz).r)) * 3.);

	float h = 0.333;
	vec3 col1 = mix(mix(uTextColor1, uTextColor2, intensity/h), mix(uTextColor2, uTextColor3, (intensity - h)/(1.0 - h*2.0)), step(h, intensity));
    vec3 col2 = mix(mix(uTextColor2, uTextColor3, (intensity - h)/(1.0 - h*2.0)), mix(uTextColor3, uTextColor4, (intensity - h*2.0)/(1.0-h*2.0)), step(h*2.0, intensity));
    vec3 col = mix(col1,col2,step(h*2.0,intensity));

	vec3 color = col * lum;
	color = max(vec3(0.13), color);
	gl_FragColor.rgb = color;
	gl_FragColor.a *= tex.a * uOpacity;
}`;
