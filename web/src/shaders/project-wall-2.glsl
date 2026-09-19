#define GLSLIFY 1
uniform vec3 fogColor;
uniform float fogAlpha;
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
varying vec2 vUv2;
uniform float rotate;
uniform float offsetPower;
uniform vec2 resolution;
uniform vec2 i_resolution;
uniform float tvNoizePower;
uniform float tvNoizeDisp;
uniform float borderWidth;
varying vec3 vNormal3;
varying float vFar;
varying float vFadeFactor;
uniform sampler2D poster;
uniform float posterAlpha;
uniform vec2  mouseNoiseDisp;
uniform vec2  mouseNoisePower;
uniform vec2  mouseNoiseDir;
uniform float mouseNoiseRatio;
uniform float vigAlpha;
uniform float enterPower_010;
uniform float enterPower_01_10;
uniform float mozX;
uniform float mozPower;
#define STANDARD
#ifdef PHYSICAL
#define IOR
#define USE_SPECULAR
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
float random(vec2 st) {
	return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

void main() {

	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>

	float dnutAlpha = 1.0;
	float aspect = resolution.x/resolution.y;
	vec2 adjustedUV = vUv2;
	adjustedUV.x *= aspect;

	#ifdef USE_MAP

		vec2 ratio = vec2(
			min((resolution.x / resolution.y) / (i_resolution.x / i_resolution.y), 1.0),
			min((resolution.y / resolution.x) / (i_resolution.y / i_resolution.x), 1.0)
		);
		vec2 uvCover = vec2(
			vMapUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
			vMapUv.y * ratio.y + (1.0 - ratio.y) * 0.5
		);

		float offsetMix = offsetPower;
	    float angle = mod(rotate, 360.0) / 360.0;
		float a1 = step(0.0, angle) * step(angle, 0.25) * (-4.0 * angle);
		float a2 = step(0.25, angle) * step(angle, 0.5) * (-1.0 + 4.0 * (angle - 0.25));
		float a3 = step(0.5, angle) * step(angle, 0.75) * (4.0 * (angle - 0.5));
		float a4 = step(0.75, angle) * (1.0 - 4.0 * (angle - 0.75));
		float offset = a1 + a2 + a3 + a4;
		vec2 uvOffset = uvCover - vec2( offset * offsetMix, 0.0 );

		vec2 offsetScale = vec2( 1.0 + abs( offsetMix ) * 0.25 ); // vec2( 1.0 + abs(offsetPower) * 0.5 );
		vec2 offsetResize = 1.0/offsetScale;
		vec2 offsetMove = offsetResize * (offsetScale - 1.0) * 0.5;
		uvOffset = mod(uvOffset * offsetResize + offsetMove, 2.0);
		if (uvOffset.x > 1.0) uvOffset.x = 2.0 - uvOffset.x;
		if (uvOffset.y > 1.0) uvOffset.y = 2.0 - uvOffset.y;

		float mozY = mozX * 1.0/aspect;
		vec2 mozSize = vec2(1.0/mozX, 1.0/mozY);
		vec2 mozIndex = floor(vUv2 / mozSize);
		float mozValue = random(mozIndex);
		vec2 mozVec = vec2(mozValue, random(mozIndex));

		vec2 center = vec2(0.5 * aspect, 0.5);
		vec2 dnutPos = adjustedUV - center;
		float dnutDist = length( dnutPos );
		float dnutRadius = 0.6;
		float dnutInnerRadius = aspect * dnutRadius * enterPower_01_10 - 0.5;
		float dnutOuterRadius = aspect * dnutRadius * enterPower_01_10;
		float dnutPower = smoothstep( dnutInnerRadius, dnutOuterRadius, dnutDist ) - smoothstep( dnutOuterRadius, dnutOuterRadius + 1.0, dnutDist );
		dnutAlpha = clamp( ( 1.0 - dnutDist * 0.5 ) * enterPower_01_10 * 3.0, 0.0, 1.0 );
		vec2 mozUV = uvOffset + mozVec * mozPower * dnutPower * enterPower_01_10;

		diffuseColor *= texture2D( map, mozUV );

	#endif
	#include <color_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>

	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;

	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>

	float tvNoiseHr = (1.0 - tvNoizePower) + tvNoizePower * sin( vUv2.y * tvNoizeDisp * 0.8 );

	vec2 borderThreshold = vec2(2.0 / resolution.x, 2.0 / resolution.y);
	borderThreshold *= ( borderWidth * 0.1 );
	if (vUv2.x < borderThreshold.x || vUv2.x > 1.0 - borderThreshold.x || vUv2.y < borderThreshold.y || vUv2.y > 1.0 - borderThreshold.y) {
		discard;
	}

	vec2 vigRad = radians( vUv2 * 180. );
	vec2 vigSin = vec2( sin( vigRad ) );
	float vigColor = clamp( min( vigSin.x, vigSin.y ) + 0.5, (1.0 - vigAlpha), 1.0 );

	gl_FragColor.rgb = clamp( gl_FragColor.rgb * tvNoiseHr + fogColor.rgb * (1.0 - fogAlpha), vec3(0.0), vec3(1.0) );
	gl_FragColor.a = clamp( (vigColor) * (vFar * vFar * vFar * opacity - dnutAlpha * 0.5) * fogAlpha, 0.0, 1.0 );

	#include <premultiplied_alpha_fragment>

}