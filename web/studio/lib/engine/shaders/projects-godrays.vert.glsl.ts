
export const projectsGodraysVert = /* glsl */ `#define GLSLIFY 1
attribute float aOffset;

varying vec2 vUv;
varying vec4 vWorldPosition;

void main () {
    vUv = uv;

	vec4 worldPosition = vec4( position, 1.0 );
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	vWorldPosition = modelMatrix * worldPosition;

	vec4 mvPosition = vec4( position, 1.0 );
	#ifdef USE_INSTANCING
		mvPosition = instanceMatrix * mvPosition;
	#endif
	mvPosition = modelViewMatrix * mvPosition;
	gl_Position = projectionMatrix * mvPosition;
}`;
