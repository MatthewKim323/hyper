export const worldMediaTileFrag = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;

uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform sampler2D u_texture;
uniform vec2 u_textureSize;
uniform vec2 u_meshSize;
uniform float u_velocity;
uniform float opacity;

void main() {

	vec2 uv = vUv;
	vec2 scaleOrigin = vec2(0.5, 0.5);

	vec4 origColor = texture2D(u_texture, vec2(vec2(vUv - scaleOrigin) / (1. + u_velocity) + scaleOrigin));
	origColor.a = origColor.a * opacity;

	gl_FragColor = origColor;

	#ifdef USE_FOG
		#ifdef USE_LOGDEPTHBUF_EXT
			float depth = gl_FragDepthEXT / gl_FragCoord.w;
		#else
			float depth = gl_FragCoord.z / gl_FragCoord.w;
		#endif
		float fogFactor = smoothstep( fogNear, fogFar, depth );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	#endif

}
`;
