#define GLSLIFY 1
uniform float radius;
uniform float rotate;
uniform float angleRange;
uniform float curvePower;
uniform float width;
uniform float height;
varying vec2 vUv;
vec3 rotateAroundY(vec3 v, float angle) {
    float sinA = sin(angle);
    float cosA = cos(angle);
    return vec3(
        cosA * v.x + sinA * v.z,
        v.y,
        -sinA * v.x + cosA * v.z
    );
}
uniform float enterPower_01_10;
uniform float mouseEnterZ;
varying vec3 vViewPosition;

void main() {

	vUv = uv;

	vec4 mvPosition = vec4( position.xyz, 1.0 );
	mvPosition.z = mvPosition.z + 0.2;

	float rotation = radians( rotate );
	float angle = mix( 0.0, angleRange, mvPosition.x );

	float tx = mvPosition.x * width * (1.0 - curvePower) + ( 1.0 - curvePower ) + radius * sin(angle) * curvePower;
	float ty = mvPosition.y * height;
	float tz = mvPosition.z - radius * (1.0 - cos(angle)) * curvePower;
	vec3 newPos = vec3(tx, ty, tz);
	vec3 center = vec3(0.0, ty, -radius );
	vec3 offsetPos = newPos - center;
	vec3 rotatedPos = rotateAroundY(offsetPos, rotation);

	newPos = rotatedPos + center;
	mvPosition = modelViewMatrix * vec4(newPos, 1.0);
	gl_Position = projectionMatrix * mvPosition;

	vViewPosition = -mvPosition.xyz;
}