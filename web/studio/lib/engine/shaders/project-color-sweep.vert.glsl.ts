export const projectColorSweepVert = /* glsl */ `
#define GLSLIFY 1
void main () {
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1 );
}
`;
