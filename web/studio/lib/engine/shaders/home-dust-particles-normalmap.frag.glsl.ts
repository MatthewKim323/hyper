
export const homeDustParticlesNormalmapFrag = /* glsl */ `#define GLSLIFY 1
varying vec3 vWorldPosition;
varying vec3 vPos;
varying vec2 vUv;
varying float aUv;

uniform vec3 u_baseColor;
uniform sampler2D u_particleTex;
uniform vec3 u_lightPos;

vec2 rotate2d(vec2 uv, float a) {
    return mat2(cos(a), -sin(a), sin(a), cos(a)) * uv;
}

void main() {
	vec3 baseColor = u_baseColor;

	vec4 particleColor = texture2D(u_particleTex, vec2((vUv.x + aUv) * 0.125, vUv.y * 0.5));
	vec4 particleBlur = texture2D(u_particleTex, vec2((vUv.x + aUv) * 0.125, (vUv.y + 1.) * 0.5));
	vec4 particleMix = mix(particleBlur, particleColor, smoothstep(0., 1., (cameraPosition.z - vWorldPosition.z) * 10.));
	// vec4 particleMix = mix(vec4(1., 0., 0., 1.), vec4(0., 1., 0., 1.), (cameraPosition.z - vWorldPosition.z) * 10.);

	vec3 normal = vec3(particleMix.rg * 2.0 - 1.0, 0.0);
    normal.xy = rotate2d(normal.xy, 3.1415926);
    normal.z = sqrt(1.0 - normal.x * normal.x - normal.y * normal.y);
    normal = normalize(normal);
    vec3 lightPosition = u_lightPos;
    float light = max(0.0, dot(normal, normalize(lightPosition)));

    float alpha = particleMix.b;
    gl_FragColor = vec4(baseColor, alpha * light);
	gl_FragColor.a *= 1. - smoothstep(-0.015, -0.02, vPos.y);
	// gl_FragColor = particleMix;
}`;
