
export const projectsCardCoverFogFrag = /* glsl */ `#define GLSLIFY 1
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

varying vec2 vUv;
varying vec3 vWorldPos;
varying float zPos;
varying vec3 vFluid;

uniform sampler2D uTexture;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform vec2 u_imageSize;
uniform vec2 u_meshSize;
uniform float u_innerScale;
uniform float u_opacity;

vec2 scaleOrigin = vec2(0.5, 0.5);

const vec3 W = vec3(0.2125, 0.7154, 0.0721);
float luminance(in vec3 color) {
    return dot(color, W);
}

void main() {
	vec2 uv = backgroundCoverUv(u_meshSize, u_imageSize, vUv);
	uv = vec2(vec2(uv - scaleOrigin) / u_innerScale + scaleOrigin);

	vec4 imageColor = texture2D(uTexture, uv);
	imageColor.rgb += smoothstep(0., 10., zPos * 0.3) * 0.3;

	#ifdef FLUID
		float lum = luminance(abs(vFluid));
		imageColor.rgb += lum * 0.15;
	#endif

	gl_FragColor = imageColor;

	float depth = gl_FragCoord.z / gl_FragCoord.w;

	gl_FragColor.a *= smoothstep(2000., 1500., depth);

	float fogFactor = smoothstep( fogNear, fogFar, depth );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );

	gl_FragColor.a *= u_opacity;
}`;
