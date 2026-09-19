#define GLSLIFY 1
varying vec2 vUv;
uniform vec2 uv_resolution;
uniform float alpha;
uniform sampler2D tDiffuse;
uniform float rgbShiftAmount;
uniform float rgbShiftDeg;
uniform vec3 rgbShiftRatio;
uniform float rgbShiftPower;

vec4 applyRGBShift(sampler2D tex, vec2 uv, float power ) {
	float rad = radians(rgbShiftDeg);
	vec2 shift = rgbShiftAmount * vec2(cos(rad), sin(rad));
	float r = texture2D(tex, uv - shift * rgbShiftRatio.r * power ).r;
	float g = texture2D(tex, uv - shift * rgbShiftRatio.g * power ).g;
	float b = texture2D(tex, uv - shift * rgbShiftRatio.b * power ).b;
	float a = texture2D(tex, uv).a;
	return vec4(r, g, b, a);
}

void main() {
	vec4 iDiffuse = applyRGBShift( tDiffuse, vUv, rgbShiftPower );
	gl_FragColor.rgb = iDiffuse.rgb;
	gl_FragColor.a = iDiffuse.a * alpha;
}