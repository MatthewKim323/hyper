
export const homeDustParticlesBillboardVert = /* glsl */ `#define GLSLIFY 1
varying vec3 vWorldPosition;
varying vec3 vPos;
varying vec2 vUv;
varying float aUv;

attribute float a_progress;
attribute float a_uv;

// uniform sampler2D u_gradientNoiseTexture;
uniform float u_time;

void main () {
	vUv = uv;
	aUv = a_uv;
	vWorldPosition = (modelMatrix * instanceMatrix * vec4(position, 1.)).xyz;

	// float noiseTime = 100. + u_time * 0.005;

	vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 billboardPos = right * position.x + up * position.y;

    vec4 mvPosition = vec4( billboardPos, 1.0 );

    // vec4 mvPosition = modelViewMatrix * (instanceMatrix * vec4(0., 0., 0., 1.));
	// mvPosition += vec4(position.x, position.y, position.z, 0.);

	// vec4 mvPosition = modelViewMatrix * (instanceMatrix * vec4(position, 1.));

	// vec2 noisePos = vWorldPosition.xz * 1.5;

	// vec3 n1 = (texture2D(u_gradientNoiseTexture, noisePos * 0.3 - vec2(noiseTime * 0.5, 0.0)).rgb - 0.5) * 0.2;
    // vec3 n2 = (texture2D(u_gradientNoiseTexture, noisePos * 0.6 + vec2(n1.x + n1.y) * 0.3 + 200.0 - vec2(0.0, noiseTime + n1.z * 1.0)).rgb - 0.5);
	// float noise = (n1.x + n2.x * 4.0 - n1.y + n2.y * 5.0) * 0.3;

	float progressTime = 100. + u_time * 0.8;
	float progress = mod(a_progress + progressTime * 0.002, 0.09);

	mvPosition = instanceMatrix * mvPosition;

	mvPosition.y -= progress;
	mvPosition.z -= progress;
	mvPosition.x += progress * 0.8;

    // mvPosition.xyz += (noise * 0.0015);
    // mvPosition.x += sin(noise) * 0.003;
    // mvPosition.y -= sin(noise) * 0.004;
    // mvPosition.z += sin(noise) * 0.005;

	vWorldPosition = mvPosition.xyz;

	mvPosition = modelViewMatrix * mvPosition;
	vPos = mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
}`;
