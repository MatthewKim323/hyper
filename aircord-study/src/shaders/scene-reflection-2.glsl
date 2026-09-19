#define GLSLIFY 1
varying vec2 vUv2;
varying vec4 vUv4;
varying vec3 vNormal;
varying vec3 vViewPosition;
uniform vec3 color;
uniform float alpha;
uniform sampler2D tDiffuse;
uniform sampler2D tFloor;
uniform float tFloorRepeat;
uniform float quality;
uniform float dispAlpha;
uniform float dispPower;
uniform vec2 resolution;
uniform float noiseAlpha;
uniform float zoomPower;
varying float vNoise;
uniform float fogPower;
uniform float fogDensity;

void main() {

	float vFogDepth = 1.0 - vViewPosition.z;
	float fd = fogDensity * 0.1;
	float fogFactor = exp( - ( fd ) * ( fd ) * vFogDepth * vFogDepth );

	vec2 uvRepeat = vUv2 * vec2( tFloorRepeat );
	uvRepeat.y += zoomPower;
	vec4 iFloor = texture2D( tFloor, uvRepeat );

	vec4 uvDisp = vUv4;
	float dispValue = quality == 0.0 ? 0.0 : dispPower;
	uvDisp.x = uvDisp.x * ( 1.0 + ( iFloor.r * 2.0 - 0.75 ) * dispValue * (fogFactor) );
	uvDisp.y = uvDisp.y * ( 1.0 + ( iFloor.r * 2.0 - 1.0 ) * dispValue );

	vec4 iDisp = texture2DProj( tDiffuse, uvDisp );
	vec3 iColor = quality == 0.0 ? color.rgb : iFloor.rgb;
	vec4 iFin = vec4( vec3( mix( iDisp.rgb, iColor.rgb, 1.0 - dispAlpha ) ), 1.0 );

	gl_FragColor.rgb = iFin.rgb - ( vNoise * noiseAlpha );
	gl_FragColor.a = (1.0 - ( pow( fogFactor, fogPower ))) * pow( fogFactor, fogPower ) * alpha * 2.0;

	//
	// gl_FragColor = vec4(1.0,0.0,0.0,1.0);

}