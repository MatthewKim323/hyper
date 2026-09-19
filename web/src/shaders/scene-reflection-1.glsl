#define GLSLIFY 1
uniform mat4 textureMatrix;
varying vec4 vUv4;
varying vec2 vUv2;
varying vec3 vNormal;
varying vec3 vViewPosition;
uniform float quality;
uniform vec2 resolution;
uniform float time;
uniform int noiseQuality;
uniform float noisePer;
uniform vec2 noiseSpeed;
uniform float noisePower;
uniform float noiseAlpha;
const float PI = 3.1415926;

float interpolate(float a, float b, float x){
	float f = (1.0 - cos(x * PI)) * 0.5;
	return a * (1.0 - f) + b * f;
}

float rnd(vec2 p){
	return fract(sin(dot(p ,vec2(12.9898,78.233))) * 43758.5453);
}

float irnd(vec2 p){
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec4 v = vec4(rnd(vec2(i.x, i.y )),
	rnd(vec2(i.x + 1.0, i.y )),
	rnd(vec2(i.x, i.y + 1.0)),
	rnd(vec2(i.x + 1.0, i.y + 1.0)));
	return interpolate(interpolate(v.x, v.y, f.x), interpolate(v.z, v.w, f.x), f.y);
}

float cloud(vec2 p){
	float t = 0.0;
	for(int i = 0; i < noiseQuality; i++){
		float freq = pow(2.0, float(i));
		float amp  = pow(noisePer, float(noiseQuality - i));
		t += irnd(vec2(p.x / freq, p.y / freq)) * amp;
	}
	return t;
}
varying float vNoise;
uniform float curvePower;
uniform float curveHeight;
uniform float curveOffset;
#include <common>

void main() {

	vUv2 = uv;
	vUv4 = textureMatrix * vec4( position, 1.0 );

	vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

	vNoise = cloud( vUv2 * resolution - time * noiseSpeed );
	vNoise = pow( vNoise, noisePower );

	vec2 uvRad = radians( vUv2 * 180. );
	vec2 uvSin = sin( uvRad );
	mvPosition.y = mvPosition.y + pow( uvSin.x * uvSin.y, curvePower ) * curveHeight - curveOffset;
	vViewPosition = -mvPosition.xyz;
	vNormal = normalize(mat3(modelViewMatrix) * normal);
	gl_Position = projectionMatrix * mvPosition;
}