export const postFluidOverlayFrag = /* glsl */ `
#define GLSLIFY 1
varying vec2 vUv;

uniform sampler2D uFluidTexture;
uniform sampler2D tDiffuse;
uniform float uOpacity;
uniform vec2 uRamp;
uniform float uImageDistortion;

const vec3 W = vec3(0.2125, 0.7154, 0.0721);
float luminance(in vec3 color) {
    return dot(color, W);
}

void main(){
    vec4 fluid = texture2D(uFluidTexture, vUv);
	vec2 fluidPos = -normalize(fluid.rgb).xy;
    vec4 sceneColor = texture2D(tDiffuse, vUv + fluidPos * uImageDistortion);
    float lum = luminance(abs(fluid.rgb));
    float gradient = smoothstep(uRamp.x, uRamp.y, lum);
	sceneColor.rgb += gradient * uOpacity * (1. - sceneColor.a );
	gl_FragColor = sceneColor;
}
`;
