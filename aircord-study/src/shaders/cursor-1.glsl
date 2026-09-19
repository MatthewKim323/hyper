#define GLSLIFY 1
// uniform float dir;
uniform float radius; // 円柱の半径
uniform float rotate; // 回転
uniform float curvePower; // 曲面の角度
uniform float width;  //
uniform float height; //
uniform float angleRange; // 曲面の角度
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

//
varying float vFadeFactor;

//
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

	float rotation = radians( rotate );  // 回転（radians）
	float angle = mix( 0.0, angleRange, position.x );

	float tx = mvPosition.x * width;
	float ty = mvPosition.y * height;
	float tz = position.z - radius * (1.0 - cos(angle)) * curvePower;

	vec3 newPos = vec3(tx, ty, tz);
	vec3 center = vec3(0.0, ty, -radius);
	vec3 offsetPos = newPos - center;
	vec3 rotatedPos = rotateAroundY(offsetPos, rotation);
	newPos = rotatedPos + center;
	mvPosition = modelViewMatrix * vec4(newPos, 1.0);

	gl_Position = projectionMatrix * mvPosition;

	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>

	#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
	#endif

}