
export const homeWaterReflectorVert = /* glsl */ `#define GLSLIFY 1
varying vec4 vMirrorCoord;
varying vec2 vUv;
varying vec3 vWorldPosition;

uniform mat4 uTextureMatrix;

void main () {
	vec3 transformedPosition = position;

	vUv = uv;

	vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;

	vMirrorCoord = uTextureMatrix * vec4( transformedPosition, 1.0 );

	vec4 mvPosition = vec4( transformedPosition, 1.0 );
	mvPosition = modelViewMatrix * mvPosition;

	gl_Position = projectionMatrix * mvPosition;
}`;
