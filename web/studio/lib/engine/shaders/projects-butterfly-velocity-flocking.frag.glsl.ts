
export const projectsButterflyVelocityFlockingFrag = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;

uniform float uTime;
uniform float testing;
uniform float uDelta; // about 0.016
uniform float u_separationDistance; // 20
uniform float u_alignmentDistance; // 40
uniform float u_cohesionDistance; //
uniform float u_freedomFactor;
uniform vec3 u_mouse;
uniform vec3 uCentralPosition;
uniform vec2 uResolution;
uniform sampler2D u_position;
uniform sampler2D uBaseTexture;
uniform sampler2D uTexture;

const float PI = 3.141592653589793;
const float PI_2 = PI * 2.0;

const float UPPER_BOUNDS = 2500.;
const float LOWER_BOUNDS = -UPPER_BOUNDS;

const float SPEED_LIMIT = 8.0;

void main() {

	float zoneRadius = u_separationDistance + u_alignmentDistance + u_cohesionDistance;
	float separationThresh = u_separationDistance / zoneRadius;
	float alignmentThresh = (u_separationDistance + u_alignmentDistance) / zoneRadius;
	float zoneRadiusSquared = zoneRadius * zoneRadius;

	float delta = 0.016;

	vec2 uv = gl_FragCoord.xy / uResolution.xy;
	vec3 birdPosition, birdVelocity;

	vec3 selfPosition = texture2D(u_position, uv).xyz;
	vec3 selfVelocity = texture2D(uTexture, uv).xyz;

	float dist;
	vec3 dir; // direction
	float distSquared;

	float f;
	float percent;

	vec3 velocity = selfVelocity;

	float limit = SPEED_LIMIT;

	dir = u_mouse * UPPER_BOUNDS - selfPosition;
	dir.z = 0.;
	dist = length(dir);
	distSquared = dist * dist;

	float preyRadius = 250.0;
	float preyRadiusSq = preyRadius * preyRadius;

	// move birds away from predator
	// if (dist < preyRadius && selfPosition.z > 500.) {
	// 	f = (distSquared / preyRadiusSq - 1.0) * delta * 100.; // turn speed
	// 	velocity -= normalize(dir) * f;
	// 	limit += 5.0; // move speed
	// }

	// Attract flocks to the center
	vec3 central = uCentralPosition;
	dir = selfPosition - central;
	dist = length(dir);
	// velocity -= normalize(dir) * delta * 1.5;

	dir.x *= 0.5;
	dir.z *= 0.005;
	velocity -= normalize( dir ) * delta * 1.;

	// avoid floor
	if (selfPosition.y < -150.) {
		velocity.y -= normalize(vec3(0., -150., 0.) - uCentralPosition).y * 0.4;
	}

	if (selfPosition.y < -250.) {
		velocity.y = 1.;
	}

	// move back towards center if near projects
	if (selfPosition.z > 900.) {
		velocity.z -= normalize(vec3(0., 0., 1800.) - uCentralPosition).z * 0.4;
	}

	// move back towards center if too far in the distances
	if (selfPosition.z < -2000.) {
		velocity.z -= normalize(vec3(0., 0., -2000.) - uCentralPosition).z * 0.4;
	}

	for (float y = 0.0; y < uResolution.y; y++) {
		for (float x = 0.0; x < uResolution.x; x++) {

			vec2 ref = vec2(x + 0.5, y + 0.5) / uResolution;
			birdPosition = texture2D(u_position, ref).xyz;

			dir = birdPosition - selfPosition;
			dist = length(dir);

			if (dist < 0.0001)
				continue;

			distSquared = dist * dist;

			if (distSquared > zoneRadiusSquared)
				continue;

			percent = distSquared / zoneRadiusSquared;

			if (percent < separationThresh) { // low

				// Separation - Move apart for comfort
				f = (separationThresh / percent - 1.0) * delta;
				velocity -= normalize(dir) * f;

			} else if (percent < alignmentThresh) { // high

				// Alignment - fly the same direction
				float threshDelta = alignmentThresh - separationThresh;
				float adjustedPercent = (percent - separationThresh) / threshDelta;

				birdVelocity = texture2D(uTexture, ref).xyz;

				f = (0.5 - cos(adjustedPercent * PI_2) * 0.5 + 0.5) * delta;
				velocity += normalize(birdVelocity) * f;

			} else {

				// Attraction / Cohesion - move closer
				float threshDelta = 1.0 - alignmentThresh;
				float adjustedPercent;
				if (threshDelta == 0.)
					adjustedPercent = 1.;
				else
					adjustedPercent = (percent - alignmentThresh) / threshDelta;

				f = (0.5 - (cos(adjustedPercent * PI_2) * -0.5 + 0.5)) * delta;

				velocity += normalize(dir) * f;

			}

		}

	}

	// this make tends to fly around than down or up
	// if (velocity.y > 0.) velocity.y *= (1. - 0.2 * delta);

	// Speed Limits
	if (length(velocity) > limit) {
		velocity = normalize(velocity) * limit;
	}

	// minimum velocity
	if (length(velocity) < 1.) {
		velocity = normalize(velocity) * 2.;
	}

	gl_FragColor = vec4(velocity, 1.0);
}`;
