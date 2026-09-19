export const domImagePeelBendVert = /* glsl */ `
#define GLSLIFY 1
varying vec2 vUv;
varying vec4 v_worldPos;
varying vec2 ssCoords;

uniform float u_progress;
uniform bool u_enableBend;

#define M_PI 3.1415926535897932384626433832795

void main () {

    vec3 pos = position;
    v_worldPos = modelMatrix * vec4(position, 1.);

    mat4 MVPM = projectionMatrix * modelViewMatrix;
    vec4 originalPosition = MVPM * vec4(position, 1.);
    ssCoords = vec2(originalPosition.xy / originalPosition.w);

	if (u_enableBend) {
		float startAt = uv.y - 0.5;
		float finishAt = uv.y;
		float bend = smoothstep(startAt, finishAt, 1. - u_progress);

		pos.x *= 1. + (bend * .2) * abs(ssCoords.x);
		pos.z += ((1. - u_progress + 0.5) * 250.);
	}

    vUv = uv;
    gl_Position = MVPM * vec4(pos, 1.);

}
`;
