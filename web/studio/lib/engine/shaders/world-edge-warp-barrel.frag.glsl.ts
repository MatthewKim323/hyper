export const worldEdgeWarpBarrelFrag = /* glsl */ `precision highp float;
#define GLSLIFY 1

uniform sampler2D tDiffuse;
uniform float u_strength;
uniform float u_scale;
varying vec2 vUv;

vec2 barrelPincushion(vec2 uv, float strength) {
    vec2 st = uv - 0.5;
    float theta = atan(st.x, st.y);
    float radius = sqrt(dot(st, st));
    radius *= 1.0 + strength * (radius * radius);

    return 0.5 + radius * vec2(sin(theta), cos(theta));
}

void main() {

    vec2 scaleOrigin = vec2(0.5, 0.5);

    gl_FragColor = texture2D(tDiffuse, barrelPincushion(vec2(vec2(vUv - scaleOrigin) / u_scale + scaleOrigin), u_strength));

}
`;
