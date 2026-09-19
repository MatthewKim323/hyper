#define GLSLIFY 1
#define STANDARD
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
varying vec3 vNormal3;
varying vec2 vUv2;
varying float vFar;
uniform vec3 fogColor;
uniform float fogAlpha;

#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif

#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
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

void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
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
	#include <premultiplied_alpha_fragment>
	vec3 color = mix( totalDiffuse, fogColor, 1.5 - vFar );
	vec3 pos = normalize( vViewPosition );
	vec3 globalLight = vec3( clamp( pow( pow( sin( 1.0 - pos.x ), 6.0 ) * ( vUv2.x * vUv2.y ) * vFar, 10.0 ), 0.0, 1.0 ) * 0.05 );
	color += globalLight;
	gl_FragColor.rgb = clamp( color + fogColor.rgb * (1.0 - fogAlpha), vec3(0.0), vec3(1.0) );
	gl_FragColor.a = clamp( vFar * fogAlpha, 0.0, 1.0 );
}