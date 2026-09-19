export const projectModelMatcapTransitionFrag = /* glsl */ `
#define GLSLIFY 1
varying vec3 vNormal;
varying vec3 vViewPosition;

uniform sampler2D uMatcapLight;
uniform sampler2D uMatcapDark;
uniform float uTransitionProgress;
uniform vec3 uBaseColor;
uniform vec3 uNextBaseColor;
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

	#ifdef LIGHTMODE
		vec3 matcapA = texture2D( uMatcapDark, uv ).rgb;
		matcapA += uBaseColor;
	#else
		vec3 matcapA = texture2D( uMatcapLight, uv ).rgb;
	#endif

	#ifdef TRANSITION
		#ifdef TO_LIGHTMODE
			vec3 matcapB = texture2D( uMatcapDark, uv ).rgb;
			matcapB += uNextBaseColor;
		#else
			vec3 matcapB = texture2D( uMatcapLight, uv ).rgb;
		#endif

		vec3 matcapColor = mix(matcapA, matcapB, smoothstep(0.333, 0.666, uTransitionProgress));
	#else
		vec3 matcapColor = matcapA;
	#endif

	gl_FragColor = vec4(matcapColor.rgb, 0.3);

	float depth = gl_FragCoord.z / gl_FragCoord.w;
	float fogFactor = smoothstep( fogNear, fogFar, depth );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
}
`;
