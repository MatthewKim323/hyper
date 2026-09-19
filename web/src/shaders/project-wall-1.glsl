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

float noise(vec2 n) {
	const vec2 d = vec2(0.0, 1.0);
	vec2 b = floor(n), f = smoothstep(vec2(0.0), vec2(1.0), fract(n));
	return mix(mix(rand(b), rand(b + d.yx), f.x), mix(rand(b + d.xy), rand(b + d.yy), f.x), f.y);
}
mat2 rotate2d(float angle){ return mat2(cos(angle),-sin(angle),sin(angle),cos(angle)); }

float gaussian(float x, float a, float b, float c) {
    return a * exp(-pow((x - b), 2.0) / (2.0 * pow(c, 2.0)));
}

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

	float rotation = radians( rotate );  // 回転（radians）
	float angle = mix( 0.0, angleRange, position.x );

	float tx = mvPosition.x * width * (1.0 - curvePower) + ( 1.0 - curvePower ) + radius * sin(angle) * curvePower;
	float ty = mvPosition.y * height;
	float tz = position.z - radius * (1.0 - cos(angle)) * curvePower;
	vec3 newPos = vec3(tx, ty, tz);
	vec3 center = vec3(0.0, ty, -radius);
	vec3 offsetPos = newPos - center;
	vec3 rotatedPos = rotateAroundY(offsetPos, rotation);
	newPos = rotatedPos + center;

	float zFar = newPos.z - center.z;
	vFar = clamp( (2.0 - ( 1.0 - (zFar / radius) )) * 5.0, 0.0, 1.0 );
	if( zFar <= 0.5 ){
		if( newPos.x <= 0.5 ){
			newPos.x = ( -newPos.x - radius * 2.0 );
		} else {
			newPos.x = ( -newPos.x + radius * 2.0 );
		}
	}

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