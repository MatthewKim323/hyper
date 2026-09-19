#define GLSLIFY 1
varying vec2 vUv;
uniform vec3 color;
uniform vec2 resolution;
uniform vec2 speed;
uniform float time;
uniform float alphaPower;
uniform float vigPower;

uniform int noiseQuality;
uniform float noisePer;
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

void main() {

	vec2 uv = vUv;
	uv *= 1.0 - vUv.yx;
	float vig = uv.x * uv.y * vigPower;
	vig = pow( vig, 2.0 );

	vec2 vUMap = vUv * resolution;
	float c = 1.0;

	vec2 t = vUMap + time * speed;
	c *= cloud( vec2(t) );

	float a = clamp( pow( c, 4.0 ) * vig * alphaPower, 0.0, 1.0 );
	gl_FragColor = vec4( color, a );

}