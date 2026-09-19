export const projectSliderImageCoverEdgeRgbshiftFrag = /* glsl */ `
#define GLSLIFY 1
vec2 backgroundCoverUv( vec2 screenSize, vec2 imageSize, vec2 uv ) {
    float screenRatio = screenSize.x / screenSize.y;
    float imageRatio = imageSize.x / imageSize.y;
    vec2 newSize = screenRatio < imageRatio
        ? vec2(imageSize.x * (screenSize.y / imageSize.y), screenSize.y)
        : vec2(screenSize.x, imageSize.y * (screenSize.x / imageSize.x));
    vec2 newOffset = (screenRatio < imageRatio
        ? vec2((newSize.x - screenSize.x) / 2.0, 0.0)
        : vec2(0.0, (newSize.y - screenSize.y) / 2.0)) / newSize;
    return uv * screenSize / newSize + newOffset;
}

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

varying vec2 vUv;
varying vec2 ssCoords;

uniform sampler2D u_texture;
uniform vec2 u_imageSize;
uniform vec2 u_meshSize;
uniform vec2 u_resolution;
uniform float u_innerScale;

vec2 scaleOrigin = vec2(0.5, 0.5);

void main() {
	vec2 uv = backgroundCoverUv(u_meshSize, u_imageSize, vUv);
	uv = vec2(vec2(uv - scaleOrigin) / u_innerScale + scaleOrigin);

	vec4 color = texture2D(u_texture, uv);

    float colorShiftR = blur9(u_texture, uv + vec2(0., 0.005), u_resolution, vec2(3., -3.)).r;
    float colorShiftG = blur9(u_texture, uv + vec2(0., -0.005), u_resolution, vec2(-3., 3.)).g;

    float thresholdLeft = smoothstep(-0.7, -1., ssCoords.x);
    float thresholdRight = smoothstep(0.7, 1., ssCoords.x);
    float thresholdTop = smoothstep(0.7, 1., ssCoords.y);
    float thresholdBottom = smoothstep(-0.7, -1., ssCoords.y);
    float threshold = thresholdLeft + thresholdRight + thresholdBottom + thresholdTop;
    color.r = mix(color.r, colorShiftR, threshold);
    color.g = mix(color.g, colorShiftG, threshold);

	gl_FragColor = color;
}
`;
