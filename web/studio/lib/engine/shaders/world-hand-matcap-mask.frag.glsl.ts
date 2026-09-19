export const worldHandMatcapMaskFrag = /* glsl */ `precision highp float;
#define GLSLIFY 1

varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vNormal;

uniform float uAlpha;
uniform sampler2D uMatcap;
uniform sampler2D uMatcapMap;

void main() {
    vec2 uv = vUv;

	vec3 normal = normalize( vNormal );
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 matcapUv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;

	vec4 matcapColor = texture2D( uMatcap, matcapUv );

	vec3 matcapMap = texture2D(uMatcapMap, uv).rgb;

	vec3 matcapMask = matcapColor.rgb * matcapMap.r;
	vec3 finalColor = (1. - matcapMap) + matcapMask;

    gl_FragColor = vec4(finalColor, uAlpha);
}
`;
