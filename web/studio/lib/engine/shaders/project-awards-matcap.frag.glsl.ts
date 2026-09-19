export const projectAwardsMatcapFrag = /* glsl */ `
#define GLSLIFY 1
varying vec3 vNormal;
varying vec3 vViewPosition;

uniform sampler2D uMatcap;
uniform vec3 uBaseColor;
uniform float uOpacity;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

void main() {
	float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif

	vec3 viewDir = normalize( vViewPosition );
    vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
    vec3 y = cross( viewDir, x );
    vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5; // 0.495 to remove artifacts caused by undersized matcap disks

	vec3 matcapColor = texture2D( uMatcap, uv ).rgb;

	#ifdef LIGHTMODE
		matcapColor += uBaseColor;
	#endif

	gl_FragColor = vec4(matcapColor, uOpacity);

	float depth = gl_FragCoord.z / gl_FragCoord.w;
	float fogFactor = smoothstep( fogNear, fogFar, depth );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
}
`;
