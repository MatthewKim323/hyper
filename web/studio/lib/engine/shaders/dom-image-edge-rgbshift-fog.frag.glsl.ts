export const domImageEdgeRgbshiftFogFrag = /* glsl */ `
vec4 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
  vec4 color = vec4(0.0);
  vec2 off1 = vec2(1.3846153846) * direction;
  vec2 off2 = vec2(3.2307692308) * direction;
  color += texture2D(image, uv) * 0.2270270270;
  color += texture2D(image, uv + (off1 / resolution)) * 0.3162162162;
  color += texture2D(image, uv - (off1 / resolution)) * 0.3162162162;
  color += texture2D(image, uv + (off2 / resolution)) * 0.0702702703;
  color += texture2D(image, uv - (off2 / resolution)) * 0.0702702703;
  return color;
}

vec2 scaleUv(vec2 uv, vec2 scaleOrigin, float scale) {
    return vec2(uv - scaleOrigin) / scale + scaleOrigin;
}

precision highp float;
#define GLSLIFY 1

varying vec2 vUv;
varying vec4 v_worldPos;
varying vec2 ssCoords;

uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_innerScale;
uniform float u_innerY;
uniform float u_innerX;
uniform float u_screenCenterTexture;
uniform float u_edgeFade;
uniform vec2 u_resolution;
uniform vec2 u_size;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

vec2 scaleOrigin = vec2(0.5, 0.5);

void main() {
    vec2 uv = vUv;
    uv.y += u_innerY;
    uv.x += u_innerX;

    vec2 screenCenter = (v_worldPos.xy / u_size) + 0.5;
    uv = screenCenter * (0. + u_screenCenterTexture) + uv * (1. - u_screenCenterTexture);

	vec4 color = texture2D(u_texture, vec2(vec2(uv - scaleOrigin) / u_innerScale + scaleOrigin));

    float colorShiftR = blur9(u_texture, scaleUv(uv + vec2(0., 0.005), scaleOrigin, u_innerScale), u_resolution, vec2(3., -3.)).r;
    float colorShiftG = blur9(u_texture, scaleUv(uv + vec2(0., -0.005), scaleOrigin, u_innerScale), u_resolution, vec2(-3., 3.)).g;
	color.a = color.a * u_opacity;

    float thresholdLeft = smoothstep(-0.85, -1., ssCoords.x) * u_edgeFade;
    float thresholdRight = smoothstep(0.85, 1., ssCoords.x) * u_edgeFade;
    float thresholdTop = smoothstep(0.85, 1., ssCoords.y) * u_edgeFade;
    float thresholdBottom = smoothstep(-0.85, -1., ssCoords.y) * u_edgeFade;
    float threshold = thresholdLeft + thresholdRight + thresholdBottom + thresholdTop;
    color.r = mix(color.r, colorShiftR, threshold);
    color.g = mix(color.g, colorShiftG, threshold);

	gl_FragColor = color;

	float depth = gl_FragCoord.z / gl_FragCoord.w;
	float fogFactor = smoothstep( fogNear, fogFar, depth );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
}
`;
