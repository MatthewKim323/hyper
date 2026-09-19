#define GLSLIFY 1
uniform sampler2D tDiffuse;
uniform vec3 color;
varying vec2 vUv;
varying vec3 vViewPosition;
uniform float opacity;
uniform float enterPower_01_10;
uniform float titleArrayLength;
uniform float fontScale;
uniform float width;
uniform float height;
uniform float mozX;
uniform float mozPower;
uniform float paraPower;

vec3 LinearTosRGB(vec3 linear) {
	return pow(linear, vec3(1.0 / 2.2));
}

float random(vec2 st) {
	return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

void main() {

	float aspect = width/height;
	vec2 adjustedUV = vUv;
	adjustedUV.x *= aspect;

	vec2 center = vec2(0.5 * aspect, 0.5);
	vec2 dnutPos = adjustedUV - center;
	float dnutDist = length( dnutPos );
	float dnutRadius = 0.6;
	float dnutInnerRadius = aspect * dnutRadius * enterPower_01_10 - 0.5;
	float dnutOuterRadius = aspect * dnutRadius * enterPower_01_10;
	float dnutPower = smoothstep( dnutInnerRadius, dnutOuterRadius, dnutDist ) - smoothstep( dnutOuterRadius, dnutOuterRadius + 1.0, dnutDist );
	float dnutAlpha = clamp( ( 1.0 - dnutDist * 0.5 ) * enterPower_01_10 * 3.0, 0.0, 1.0 );

	float mozY = mozX * 1.0/aspect;
	vec2 mozSize = vec2(1.0/mozX, 1.0/mozY);
	vec2 mozIndex = floor(vUv / mozSize);
	float mozValue = random(mozIndex);
	vec2 mozVec = vec2(mozValue, random(mozIndex));
	vec2 mozUV = vUv + mozVec * mozPower * dnutPower * enterPower_01_10;

	vec2 uvTranslate = vUv;
	uvTranslate.y = vUv.y + fontScale * 0.5;
	if( titleArrayLength == 2.0 ){
		uvTranslate.x = mozUV.x - clamp( vViewPosition.x * (vUv.y < 0.5 ? 0.015 : 0.01), -1.0, 1.0 ) * paraPower;
	}

	vec4 iText = texture2D( tDiffuse, uvTranslate );

	float a = iText.a * dnutAlpha;
	gl_FragColor = vec4( LinearTosRGB( color ), a );

}