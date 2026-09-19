
export const homeLandFogFrag = /* glsl */ `#define GLSLIFY 1
varying vec3 vWorldPosition;

uniform vec3 u_baseColor;
uniform sampler2D u_gradientNoiseTexture;
uniform float u_time;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

void main() {
	vec3 baseColor = u_baseColor;

	// vec2 noisePos = vWorldPosition.xz * 8.;

	// vec3 n1 = (texture2D(u_gradientNoiseTexture, noisePos * 0.3 - vec2(0.5, 0.0)).rgb - 0.5) * 0.2;
    // vec3 n2 = (texture2D(u_gradientNoiseTexture, noisePos * 0.6 + vec2(n1.x + n1.y) * 0.3 + 200.0 - vec2(0.0, n1.z * 1.0)).rgb - 0.5);
	// float noise = (n1.x + n2.x * 4.0 - n1.y + n2.y * 5.0) * 0.3;

	// baseColor += clamp(noise, -0.2, 0.2) * 0.5;
	gl_FragColor = vec4(baseColor, 1.);

	float depth = gl_FragCoord.z / gl_FragCoord.w;
	float fogFactor = smoothstep( fogNear, fogFar, depth );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
}`;
