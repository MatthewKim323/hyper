export const projectTextRevealNoiseMaskVert = /* glsl */ `
#define GLSLIFY 1
varying vec3 vWorldPosition;
varying vec2 vUv;

void main () {
	vUv = uv;
	vWorldPosition = (modelMatrix * vec4(position, 1.)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1 );
}
`;
