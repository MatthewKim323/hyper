
export const homeReflectorMipmapDownsampleVert = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;

void main() {
    #include <begin_vertex>
    #include <project_vertex>
    vUv = uv;
}`;
