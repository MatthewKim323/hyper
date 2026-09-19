export const projectColorSweepScreenspaceFogFrag = /* glsl */ `
#define GLSLIFY 1
#define M_PI 3.141592653589

uniform vec2 u_resolution;
uniform vec3 u_fromColor;
uniform vec3 u_toColor;
uniform float u_progress;
uniform float u_adjust;
uniform float u_velo;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

float parabola( float x, float k, float curve ){
    return pow( curve * x * (1.0 - x), k );
}

void main() {
	// vec2 st = gl_FragCoord.xy / u_resolution.xy;
	// float curve = parabola(st.x, (1. - u_progress) * 4.340, u_progress * 4.728);
	// vec3 finalColor = mix(u_fromColor, u_toColor, step(st.y, curve));
	// gl_FragColor = vec4(finalColor, 1.);

	vec2 uv = gl_FragCoord.xy / u_resolution.xy;
	float pct = 1. - ((distance(uv, vec2(.5))) * u_adjust);
    pct = smoothstep(0., 1., pct);
    uv.y -= ((sin(uv.x * M_PI) * u_velo) * .5);
    float tf = step(uv.y, clamp(u_progress * pct, 0., 1.));
    vec3 finalColor = mix(u_fromColor, u_toColor, tf);
	gl_FragColor = vec4(finalColor, 1.);

	float depth = gl_FragCoord.z / gl_FragCoord.w;
	float fogFactor = smoothstep( fogNear, fogFar, depth );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
}
`;
