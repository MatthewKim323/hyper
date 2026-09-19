#define GLSLIFY 1
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
uniform float alpha;
uniform float tvNoizePower;
uniform float tvNoizeDisp;

#define STANDARD
#ifdef PHYSICAL
#define IOR
#define USE_SPECULAR
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>

void main() {

	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>

	float aspect = resolution.x/resolution.y;

	#ifdef USE_MAP

		vec2 ratio = vec2(
			min((resolution.x / resolution.y) / (i_resolution.x / i_resolution.y), 1.0),
			min((resolution.y / resolution.x) / (i_resolution.y / i_resolution.x), 1.0)
		);
		vec2 uvRatio = vec2(
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
		vec2 uvOffset = uvRatio - vec2( offset * offsetMix, 0.0 );
		vec2 offsetScale = vec2( 1.0 + abs( offsetMix ) * 0.25 );
		vec2 offsetResize = 1.0/offsetScale;
		vec2 offsetMove = offsetResize * (offsetScale - 1.0) * 0.5;
		uvOffset = mod(uvOffset * offsetResize + offsetMove, 2.0);
		if (uvOffset.x > 1.0) uvOffset.x = 2.0 - uvOffset.x;
		if (uvOffset.y > 1.0) uvOffset.y = 2.0 - uvOffset.y;

		vec4 iMap = texture2D( map, uvOffset );

		diffuseColor *= iMap;

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

	float tvNoiseHr = (1.0 - tvNoizePower) + tvNoizePower * sin( vUv2.y * tvNoizeDisp );
	gl_FragColor.rgb *= tvNoiseHr;

	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}