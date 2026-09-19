export const postScreenfxChromaticBarrelVignetteGrainFrag = /* glsl */ `
precision highp float;
#define GLSLIFY 1

uniform sampler2D tDiffuse;
uniform float u_time;
uniform float u_noiseOnly;
uniform float u_maxDistort;
uniform float u_bendAmount;
uniform float u_vignetteStrength;
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

void main() {
    float f = hash12(gl_FragCoord.xy + u_time);
    vec4 noise = vec4(vec3(f), 0.05) * 0.07;

	vec4 baseColor;
	if (u_noiseOnly > 0.) {
		baseColor = texture2D(tDiffuse, vUv);
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
			sumcol += w * texture2D( tDiffuse, barrelDistortion(vUv, u_bendAmount * u_maxDistort*t ) );
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
