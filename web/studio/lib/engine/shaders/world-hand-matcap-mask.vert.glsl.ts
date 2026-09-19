export const worldHandMatcapMaskVert = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vNormal;

void main () {
    vUv = uv;

	vec3 objectNormal = vec3(normal);
	vec3 transformedNormal = objectNormal;
	vNormal = normalMatrix * transformedNormal;

	vec4 mvPosition = vec4( position, 1.0 );
	mvPosition = modelViewMatrix * mvPosition;
	gl_Position = projectionMatrix * mvPosition;

	vViewPosition = -mvPosition.xyz;
}
`;
