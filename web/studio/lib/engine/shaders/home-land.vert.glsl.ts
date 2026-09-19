
export const homeLandVert = /* glsl */ `#define GLSLIFY 1
varying vec3 vWorldPosition;

void main () {
	vWorldPosition = (modelMatrix * vec4(position, 1.)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1 );
}`;
