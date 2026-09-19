export const postScreenfxChromaticBarrelVignetteGrainFrag = /* glsl */ `
precision highp float;
#define GLSLIFY 1

uniform sampler2D tDiffuse;
uniform float u_time;
uniform float u_noiseOnly;
uniform float u_maxDistort;
uniform float u_bendAmount;
uniform float u_vignetteStrength;
uniform vec4 u_glassRect;
uniform vec2 u_glassViewport;
uniform float u_glassRadius;
uniform float u_glassStrength;
varying vec2 vUv;

const int iterations = 5;

vec2 barrelDistortion(vec2 coord, float amt) {
	vec2 cc = coord - 0.5;
	float dist = dot(cc, cc);
	return coord + cc * dist * amt;
}

float sat( float t )
{
	return clamp( t, 0.0, 1.0 );
}

float linterp( float t ) {
	return sat( 1.0 - abs( 2.0*t - 1.0 ) );
}

float remap( float t, float a, float b ) {
	return sat( (t - a) / (b - a) );
}

vec4 spectrum_offset( float t ) {
	vec4 ret;
	float lo = step(t,0.5);
	float hi = 1.0-lo;
	float w = linterp( remap( t, 1.0/6.0, 5.0/6.0 ) );
	ret = vec4(lo,1.0,hi, 1.) * vec4(1.0-w, w, 1.0-w, 1.);

	return pow( ret, vec4(1.0/2.2) );
}

float hash12(vec2 p) {
	vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// A clear rounded lens: only its curved rim refracts the scene underneath.
vec2 glassRefraction(vec2 uv) {
    if (u_glassStrength <= 0. || min(u_glassRect.z, u_glassRect.w) <= 0.) return vec2(0.);

    vec2 viewport = max(u_glassViewport, vec2(1.));
    vec2 halfSize = u_glassRect.zw * 0.5;
    vec2 p = vec2(uv.x, 1. - uv.y) * viewport - u_glassRect.xy - halfSize;
    if (abs(p.x) >= halfSize.x || abs(p.y) >= halfSize.y) return vec2(0.);

    float radius = clamp(u_glassRadius, 0., min(halfSize.x, halfSize.y));
    vec2 q = abs(p) - halfSize + radius;
    vec2 corner = max(q, 0.);
    float cornerLength = length(corner);
    float distanceToEdge = cornerLength + min(max(q.x, q.y), 0.) - radius;
    float rimWidth = clamp(radius * 0.6, 10., 18.);
    if (distanceToEdge >= 0. || distanceToEdge <= -rimWidth) return vec2(0.);

    // The signed-distance gradient points outwards, including around corners.
    vec2 outward = cornerLength > 0.0001
        ? corner / cornerLength
        : (q.x > q.y ? vec2(1., 0.) : vec2(0., 1.));
    outward *= sign(p);
    float t = -distanceToEdge / rimWidth;
    float lensCurve = 16. * t * t * (1. - t) * (1. - t);
    vec2 inwardPixels = -outward * rimWidth * 0.65 * lensCurve * u_glassStrength;
    return inwardPixels * vec2(1., -1.) / viewport;
}

void main() {
    float f = hash12(gl_FragCoord.xy + u_time);
    vec4 noise = vec4(vec3(f), 0.05) * 0.07;
    vec2 glassOffset = glassRefraction(vUv);

	vec4 baseColor;
	if (u_noiseOnly > 0.) {
		baseColor = texture2D(tDiffuse, vUv + glassOffset);
	}

	vec4 screenFx;
	if (u_noiseOnly < 1.) {
		vec4 sumcol = vec4(0.0);
		vec4 sumw = vec4(0.0);
		float reci_num_iter_f = 1.0 / float(iterations);
		for (int i = 0; i < iterations; i++){
			float t = float(i) * reci_num_iter_f;
			vec4 w = spectrum_offset( t );
			sumw += w;
			sumcol += w * texture2D( tDiffuse, barrelDistortion(vUv, u_bendAmount * u_maxDistort*t ) + glassOffset * (0.985 + 0.03 * t) );
		}

		vec2 uv2 = vUv;
		uv2 *= 1.0 - vUv.yx;   //vec2(1.0)- uv.yx; -> 1.-u.yx; Thanks FabriceNeyret !
		float vig = uv2.x*uv2.y * 20.0; // multiply with sth for intensity
		vig = pow(vig, u_vignetteStrength); // change pow for modifying the extend of the  vignette

		screenFx = mix(vec4(vec3(0.), 1.), sumcol / sumw, vig);
	}


	gl_FragColor = mix(screenFx, baseColor, u_noiseOnly) + noise;
}
`;
