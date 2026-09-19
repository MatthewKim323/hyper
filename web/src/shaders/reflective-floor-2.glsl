#define GLSLIFY 1
varying vec2 vUv2;
varying vec4 vUv4;
varying vec3 vNormal;
varying vec3 vViewPosition;

uniform vec3 color;
uniform sampler2D tDiffuse;
uniform sampler2D tFloor;
uniform sampler2D tWater;
uniform float dispPower;
uniform float blurPower;
uniform float alpha;
uniform float time;
uniform float fadePower;
uniform float fadePowerPower;
uniform float repeatWater;
uniform float repeatFloor;
uniform vec2 uv_resolution;

uniform vec3 danmenColor;

uniform float cnoiseDisp;
uniform float cnoiseHeight;
uniform float cnoiseAlpha;
varying float vNoise;

uniform float fogDensity;

uniform float dotView;
uniform float dotProduct;

uniform float backfaceAlphaPower;
uniform float frontfaceAlphaPower;

void main() {

	vec2 uvOffset = vec2(0.0, sin(time) * 0.05 );
	vec2 uvRepeat = vUv2 + uvOffset;
	vec4 iFloor = texture2D( tFloor, uvRepeat );
	vec4 iWater = texture2D( tWater, uvRepeat );
	vec4 iDisp  = gl_FrontFacing ? iFloor : iWater;
	float pDisp = gl_FrontFacing ? dispPower : dispPower * dotProduct * 2.0;

	vec4 uvDisp = vUv4;
	uvDisp.x = uvDisp.x * clamp( 0.9 + iDisp.r * pDisp * 0.1, 0.0, 1.0 ) + uvDisp.x * 0.06;
	uvDisp.y = uvDisp.y * clamp( 0.9 + iDisp.r * pDisp * 0.1, 0.0, 1.0 );

	float rad = radians( vUv2.x * 180. ) * 0.5;
	float fade = 1.0 - pow( sin( rad ) * ( vUv2.y - fadePower ), 2.0 );
	fade = clamp( pow( fade, fadePowerPower ), 0.0, 1.0 );

	vec4 bBase;
	bBase += texture2DProj( tDiffuse, vec4( uvDisp.x, uvDisp.y - 4.0 * blurPower * fade, uvDisp.zw ) ) * 0.051;
	bBase += texture2DProj( tDiffuse, vec4( uvDisp.x, uvDisp.y - 3.0 * blurPower * fade, uvDisp.zw ) ) * 0.0918;
	bBase += texture2DProj( tDiffuse, vec4( uvDisp.x, uvDisp.y - 2.0 * blurPower * fade, uvDisp.zw ) ) * 0.12245;
	bBase += texture2DProj( tDiffuse, vec4( uvDisp.x, uvDisp.y - 1.0 * blurPower * fade, uvDisp.zw ) ) * 0.1531;
	bBase += texture2DProj( tDiffuse, uvDisp ) * 0.1633;

	vec4 iFin = vec4( vec3( mix( bBase.rgb, color, fade ) ), 1.0 );

	float vFogDepth = 1.0 - vViewPosition.z;
	float fogFactor = exp( - ( fogDensity * 0.1 ) * ( fogDensity * 0.1 ) * vFogDepth * vFogDepth );

	vec4 iFin2 = iFin - vNoise * cnoiseAlpha;
	float iFinA = gl_FrontFacing ? alpha * fogFactor * frontfaceAlphaPower : fogFactor * backfaceAlphaPower;
	float a = gl_FrontFacing ? vViewPosition.z : vViewPosition.z - vNoise;

	float a2 = clamp( a, 0.0, 1.0 );
	vec4 rgba = ( vUv2.y <= 0.01 ) ? vec4( danmenColor, sin( vViewPosition.y ) ) : vec4( mix( color, iFin2.rgb, iFinA ), a2 );
	gl_FragColor = rgba;

}