export const worldIntroGlitchScanlinesFrag = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform sampler2D u_noise;
uniform float u_time;
uniform float u_strength;

#define pi 3.1415926

vec2 glitch(vec2 uv, float s)
{
    float v = pow(0.5 - 0.5 * cos(2.0 * pi * uv.y * 10.), 50.0) * sin(2.0 * pi * uv.y * 0.5);
    uv.x += v * s * 0.1;
    return uv;
}

void main() {
	float t = u_time / 10.;

	vec2 uv = vUv;

    float r = texture2D(u_noise, vec2(t, 0.0)).x;
    float jitter = texture2D(u_noise, vec2(t * 5., 0.0)).x;
    uv = glitch(uv + vec2(0.0, fract(t * 2.0)), 5.0 * sign(r) * pow(abs(r), 5.0) * u_strength) - vec2(0.0, fract(t * 2.0));
	uv.x += jitter * 0.001 * u_strength;

    vec3 col;

	vec2 rgbOffset = vec2(jitter * 0.003, 0.001) * u_strength;

    col.r = texture2D(tDiffuse, uv + rgbOffset).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - rgbOffset).b;

	float c = 1.;

	float scanlineSpeed = u_time * 10.;

	c += 2. * sin(scanlineSpeed + uv.y * 1000.);
	c += 1. * sin(scanlineSpeed + uv.y * 999.);

	float x = uv.x * uv.y * 1.0 *  1000.0;
    x = mod( x, 13.0 ) * mod( x, 123.0 );
    float dx = mod( x, 0.01 );
    vec3 cResult = col.rgb + col.rgb * clamp( 0.1 + dx * 100.0, 0.0, 1.0 );
    vec2 sc = vec2( sin( uv.y * 1500. + scanlineSpeed ), cos( uv.y * 1500. + scanlineSpeed ) );
    cResult += col.rgb * vec3( sc.x, sc.y, sc.x ) * 2.;
    cResult = col.rgb + clamp( 0.3, 0.0, 1.0 ) * ( cResult - col.rgb ) * u_strength;

	gl_FragColor = vec4(cResult, 1.);
}
`;
