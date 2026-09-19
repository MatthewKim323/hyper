#define GLSLIFY 1
varying vec2 vUv;
uniform vec2 i_resolution;
uniform vec2 uv_resolution;

uniform vec3 tPreColor;

uniform sampler2D tImage;
uniform sampler2D tVideo;
uniform sampler2D tPreload;

uniform float tPreloadFade;
uniform float tImageFade;
uniform float tVideoFade;
uniform float tImageAlpha;

vec3 LinearTosRGB(vec3 linear) {
	return pow(linear, vec3(1.0 / 2.2));
}

vec4 mix2D( vec4 tFront, vec4 tBack ){
	vec3 rgb = vec3( min( tFront.rgb * tFront.a + tBack.rgb * tBack.a * ( 1.0 - tFront.a ), 1.0 ) );
	float a  = min( tFront.a + tBack.a, 1.0 );
	vec4 rgba = vec4( rgb, a );
	return rgba;
}

void main() {

	vec2 ratio = vec2(
		min((uv_resolution.x / uv_resolution.y) / (i_resolution.x / i_resolution.y), 1.0),
		min((uv_resolution.y / uv_resolution.x) / (i_resolution.y / i_resolution.x), 1.0)
	);
	vec2 uvCover = vec2(
		vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
		vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
	);

	float fadeY = clamp( uvCover.y + (1.0 - uvCover.y) * tImageFade, 0.0, 1.0 );

	vec4 iPreload = texture2D( tPreload, uvCover );
	iPreload.a = tPreloadFade * fadeY;

	vec4 iImage = texture2D( tImage, uvCover );
	iImage.a = tImageAlpha * fadeY;

	vec4 iVideo = texture2D( tVideo, uvCover );
	iVideo.a = tVideoFade * fadeY;

	vec4 iMedia = mix2D( iVideo, iImage );
	vec4 iPreloadBefore = mix( vec4( LinearTosRGB(tPreColor), 1.0 ), iPreload, tPreloadFade );
	vec4 iFin = mix( iPreloadBefore, iMedia, tImageFade );
	gl_FragColor = iFin;

}