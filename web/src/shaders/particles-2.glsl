#define GLSLIFY 1
uniform sampler2D tDiffuse;
uniform float alpha;
uniform vec3 color;
varying vec2 vScreenPosition;
varying float vFadeFactor;

void main() {
    vec2 uv = gl_PointCoord;
    float dist = length(vScreenPosition);
    float screen = 1.0 - smoothstep(0.5, 1.0, dist);
    vec2 center = ( uv * 2.0 - 1.0 );
    float l = (1.0 - length( center ));
    float b = l+l;
    gl_FragColor = vec4( color, b * screen * alpha * vFadeFactor );
}