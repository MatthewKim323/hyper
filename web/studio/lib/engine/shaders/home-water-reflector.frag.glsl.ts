
export const homeWaterReflectorFrag = /* glsl */ `#define GLSLIFY 1
varying vec4 vMirrorCoord;
varying vec2 vUv;
varying vec3 vWorldPosition;

uniform sampler2D uTexture;
uniform sampler2D uAOTexture;
uniform sampler2D uNoiseTexture;
uniform sampler2D uFluidTexture;
uniform vec2 uMipmapTextureSize;
uniform vec2 uResolution;
uniform vec3 uColor;
uniform float uBaseLod;
uniform float uDistortionAmount;
uniform float uReflectionIntensity;
uniform float uTime;

vec4 cubic(float v) {
    vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
    vec4 s = n * n * n;
    float x = s.x;
    float y = s.y - 4.0 * s.x;
    float z = s.z - 4.0 * s.y + 6.0 * s.x;
    float w = 6.0 - x - y - z;
    return vec4(x, y, z, w);
}

// https://stackoverflow.com/questions/13501081/efficient-bicubic-filtering-code-in-glsl
vec4 textureBicubic(sampler2D t, vec2 texCoords, vec2 textureSize) {
   vec2 invTexSize = 1.0 / textureSize;
   texCoords = texCoords * textureSize - 0.5;

    vec2 fxy = fract(texCoords);
    texCoords -= fxy;
    vec4 xcubic = cubic(fxy.x);
    vec4 ycubic = cubic(fxy.y);

    vec4 c = texCoords.xxyy + vec2 (-0.5, 1.5).xyxy;

    vec4 s = vec4(xcubic.xz + xcubic.yw, ycubic.xz + ycubic.yw);
    vec4 offset = c + vec4 (xcubic.yw, ycubic.yw) / s;

    offset *= invTexSize.xxyy;

    vec4 sample0 = texture2D(t, offset.xz);
    vec4 sample1 = texture2D(t, offset.yz);
    vec4 sample2 = texture2D(t, offset.xw);
    vec4 sample3 = texture2D(t, offset.yw);

    float sx = s.x / (s.x + s.y);
    float sy = s.z / (s.z + s.w);

    return mix(
       mix(sample3, sample2, sx), mix(sample1, sample0, sx)
    , sy);
}

// With original size argument
vec4 packedTexture2DLOD( sampler2D tex, vec2 uv, int level, vec2 originalPixelSize ) {
    float floatLevel = float( level );
    vec2 atlasSize;
    atlasSize.x = floor( originalPixelSize.x * 1.5 );
    atlasSize.y = originalPixelSize.y;

    // we stop making mip maps when one dimension == 1

    float maxLevel = min( floor( log2( originalPixelSize.x ) ), floor( log2( originalPixelSize.y ) ) );
    floatLevel = min( floatLevel, maxLevel );

    // use inverse pow of 2 to simulate right bit shift operator

    vec2 currentPixelDimensions = floor( originalPixelSize / pow( 2.0, floatLevel ) );
    vec2 pixelOffset = vec2(
    floatLevel > 0.0 ? originalPixelSize.x : 0.0, floatLevel > 0.0 ? currentPixelDimensions.y : 0.0
    );

    // "minPixel / atlasSize" samples the top left piece of the first pixel
    // "maxPixel / atlasSize" samples the bottom right piece of the last pixel
    vec2 minPixel = pixelOffset;
    vec2 maxPixel = pixelOffset + currentPixelDimensions;
    vec2 samplePoint = mix( minPixel, maxPixel, uv );
    samplePoint /= atlasSize;
    vec2 halfPixelSize = 1.0 / ( 2.0 * atlasSize );
    samplePoint = min( samplePoint, maxPixel / atlasSize - halfPixelSize );
    samplePoint = max( samplePoint, minPixel / atlasSize + halfPixelSize );
    return textureBicubic( tex, samplePoint, originalPixelSize );
}

vec4 packedTexture2DLOD( sampler2D tex, vec2 uv, float level, vec2 originalPixelSize ) {
    float ratio = mod( level, 1.0 );
    int minLevel = int( floor( level ) );
    int maxLevel = int( ceil( level ) );
    vec4 minValue = packedTexture2DLOD( tex, uv, minLevel, originalPixelSize );
    vec4 maxValue = packedTexture2DLOD( tex, uv, maxLevel, originalPixelSize );
    return mix( minValue, maxValue, ratio );
}

const vec3 W = vec3(0.2125, 0.7154, 0.0721);
float luminance(in vec3 color) {
    return dot(color, W);
}

void main() {
	vec3 baseColor = uColor;
    float ao = texture2D(uAOTexture, vUv).r;
	vec4 fluid = texture2D(uFluidTexture, vUv);
	vec2 fluidPos = normalize(fluid.rgb).xy;

	float noiseTime = uTime * 0.05;
	vec2 noisePos = vec2((vUv.x + 0.5) * 6., vUv.y * 20.) * 0.25;
	vec3 n1 = texture2D(uNoiseTexture, noisePos + vec2(0., 1. - noiseTime)).rgb - 0.5;

	float edgeReduce = smoothstep(0., uResolution.x * 0.1, gl_FragCoord.x) * smoothstep(uResolution.x, uResolution.x * 0.9, gl_FragCoord.x);

    vec2 reflectionUv = vMirrorCoord.xy / vMirrorCoord.w;
	reflectionUv.x += n1.x * 0.03 * edgeReduce * ao;
	reflectionUv.xy += fluidPos * 0.02 * ao * edgeReduce;

	vec2 fluidSpec = n1.xy + abs(fluidPos * 8.);
	vec3 worldNormal = normalize(vec3(fluidSpec.x, 0.5 + fluidSpec.x, fluidSpec.y));
	vec3 specRay = reflect(normalize(vWorldPosition - cameraPosition), worldNormal);
	float spec = smoothstep(0.05, 1., dot(specRay, normalize(vec3(-1.0, 1.0, 1.0))));
	// spec += fluidPos.x + fluidPos.y;

    float lod = clamp(uBaseLod + spec * 2., 0., 4.) * ao;

    vec3 color = packedTexture2DLOD(uTexture, reflectionUv, lod + clamp(length(fluidPos.xy) * 12., 0., 2.), uMipmapTextureSize).rgb;

	color *= baseColor;
	color *= mix(0.9, 1., n1.x) + spec * 0.2 * ao;

	float lum = luminance(abs(fluid.rgb));
    color += lum * 0.7 * ao;

    gl_FragColor = vec4(color, 1.);
    // gl_FragColor = vec4(vec3(ao), 1.);
}`;
