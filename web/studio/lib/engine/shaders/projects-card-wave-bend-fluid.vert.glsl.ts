
export const projectsCardWaveBendFluidVert = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewDir;
varying float zPos;
varying vec3 vFluid;

uniform sampler2D u_fluidTex;
uniform float u_time;
uniform float u_random;
uniform float u_heightOffset;
uniform vec2 u_bendPoint;

void main() {
	vUv = uv;
    vViewDir = -vec3(modelViewMatrix * vec4(position, 1.0));
    vWorldPos = vec3(modelMatrix * vec4(position, 1.0));

	float noise = sin((vWorldPos.x - vWorldPos.y * 0.1) * 0.03 + -u_time * 1.1 + cos(vWorldPos.z * 0.04) * 10.) * 50.;
	float noise2 = sin((vWorldPos.x + vWorldPos.y * 0.1) * 0.01 + -u_time * 0.4) * 0.5;

	vec3 transformedPos = position;

	float ripple = sin((vWorldPos.x - vWorldPos.y) * 0.02 + -u_time * 2.) * 12.;
	transformedPos.z += ripple;

	transformedPos.z -= 1200. * smoothstep(u_bendPoint.x, u_bendPoint.y, vWorldPos.y);
	transformedPos.z -= noise * smoothstep(u_bendPoint.x, u_bendPoint.y, vWorldPos.y);
	transformedPos.y -= (1.5 - noise2) * smoothstep(u_bendPoint.x * 1.1, u_bendPoint.y * 0.7, vWorldPos.y) * u_heightOffset;

	#ifdef FLUID
		vec4 earlyProjection = projectionMatrix * modelViewMatrix * vec4(transformedPos, 1.0);
		vec2 screenSpace = earlyProjection.xy / earlyProjection.w * 0.5 + vec2(0.5);
		vec3 fluidColor = texture2D(u_fluidTex, screenSpace).rgb;
		vec2 fluidPos = -normalize(fluidColor.rgb).xy * 0.01 * vec2(1., u_heightOffset);
		vFluid = fluidColor;
		transformedPos.xy += fluidPos;
	#endif

	zPos = ripple;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformedPos, 1.0);
}`;
