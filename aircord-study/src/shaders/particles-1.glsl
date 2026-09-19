#define GLSLIFY 1
varying vec2 vScreenPosition;

uniform float time;
uniform vec2 uv_resolution;

attribute float size;
attribute float scale;
attribute vec2 wave;

varying float vFadeFactor;
uniform vec3 cylinderCenter;
uniform vec3 cylinderDirection;
uniform float cylinderRadiusTop;
uniform float cylinderRadiusBottom;
uniform float cylinderHeight;

void main() {
	vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
	mvPosition.y = mvPosition.y + wave.y * sin( wave.x + time );
	vec3 toPoint = position.xyz - cylinderCenter;
	float dotProd = dot(cylinderDirection, toPoint);
	if (dotProd < 0.0 || dotProd > cylinderHeight) {
		vFadeFactor = 0.0;
	} else {
		float interpolatedRadius = mix(cylinderRadiusTop, cylinderRadiusBottom, dotProd / cylinderHeight);
		vec3 projectedPoint = dotProd * cylinderDirection;
		vec3 difference = toPoint - projectedPoint;
		float distToEdge = interpolatedRadius - length(difference);
		vFadeFactor = smoothstep(0.0, 0.5 * interpolatedRadius, distToEdge);
	}
	gl_PointSize = size * ( uv_resolution.y / ( -mvPosition.z * 2.0 ) ) * scale;
	gl_Position = projectionMatrix * mvPosition;
	vScreenPosition = gl_Position.xy / gl_Position.w;
}