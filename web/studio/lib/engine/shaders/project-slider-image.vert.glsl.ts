export const projectSliderImageVert = /* glsl */ `
#define GLSLIFY 1
varying vec2 vUv;
varying vec2 ssCoords;

void main () {
    vUv = uv;
	vec3 pos = position;

    mat4 MVPM = projectionMatrix * modelViewMatrix;
    vec4 originalPosition = MVPM * vec4(position, 1.);
    ssCoords = vec2(originalPosition.xy / originalPosition.w);

    gl_Position = MVPM * vec4(pos, 1.);
}
`;
