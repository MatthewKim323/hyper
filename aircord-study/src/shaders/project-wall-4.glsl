#define GLSLIFY 1
uniform float dir;
uniform float radius;
uniform float rotate;
uniform float angleRange;
uniform float curvePower;
uniform float width;
uniform float height;
varying vec2 vUv2;
vec3 rotateAroundY(vec3 v, float angle) {
    float sinA = sin(angle);
    float cosA = cos(angle);
    return vec3(
        cosA * v.x + sinA * v.z,
        v.y,
        -sinA * v.x + cosA * v.z
    );
}
varying vec3 vNormal3;
varying float vFar;
#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
varying vec3 vWorldPosition;
#endif
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <normal_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {

	vUv2 = uv;
	vNormal3 = normal;

	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <beginnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>

	vec4 mvPosition = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
	#endif

	float atsumi = 0.1;
	mvPosition.z = -mvPosition.z * 0.5 - atsumi;
	bool isBackFace = (mvPosition.z > 0.0 || mvPosition.y > 0.0 || mvPosition.y < 0.0 || mvPosition.x > 0.0 || mvPosition.x < 0.0);

	if( isBackFace ){
		mvPosition.z = -mvPosition.z * 0.5 - atsumi;
		mvPosition.x = mvPosition.x * ( 1.0 + mvPosition.z * 0.12 );
	}

	float depth = abs( mvPosition.z * 2.0 );
	float rotation = radians( rotate );
	float angle = mix( 0.0, angleRange, mvPosition.x );

	float tx = mvPosition.x * width * (1.0 - curvePower) + ( 1.0 - curvePower ) + radius * sin(angle) * curvePower;
	float ty = mvPosition.y * height;
	float tz = mvPosition.z - radius * (1.0 - cos(angle)) * curvePower;
	vec3 newPos = vec3(tx, ty, tz);
	vec3 center = vec3(0.0, ty, -radius );
	vec3 offsetPos = newPos - center;
	vec3 rotatedPos = rotateAroundY(offsetPos, rotation);
	newPos = rotatedPos + center;

	float zFar = newPos.z - center.z;
	vFar = 2.0 - (1.0 - (zFar / radius));
	if( zFar < 0.5 ){
		if( newPos.x < 0.5 ){
			newPos.x = ( -newPos.x - ( radius - depth * 0.5 ) * 2.0 );
			newPos.z = newPos.z - depth * 0.5;
		} else {
			newPos.x = ( -newPos.x + ( radius - depth * 0.5 ) * 2.0 );
			newPos.z = newPos.z - depth * 0.5;
		}
	}

	mvPosition = modelViewMatrix * vec4(newPos, 1.0);
	gl_Position = projectionMatrix * mvPosition;

	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

	vViewPosition = -mvPosition.xyz;

	#include <worldpos_vertex>

	#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
	#endif

}