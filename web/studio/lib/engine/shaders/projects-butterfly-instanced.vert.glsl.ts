
export const projectsButterflyInstancedVert = /* glsl */ `#define GLSLIFY 1
attribute vec2 aFboUv;
attribute vec3 color;
attribute float aScale;
attribute vec2 aUvOffset;
attribute vec2 uv2;
attribute vec4 tangent;

uniform sampler2D tPosition;
uniform sampler2D tVelocity;

varying float z;
varying vec2 vUv;
varying vec2 vUv2;
varying vec2 vUvOffset;
varying vec3 vColor;
varying vec3 vViewPosition;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vBitangent;

uniform float u_time;

vec3 animate(vec3 geometryPosition, vec4 texturePosition, vec3 velocity) {
    vec3 position = geometryPosition;
    vec3 v = velocity;
    vec4 p = texturePosition;
    float wingFlap = sin( p.w) * (10. + (sin(uv2.y * 10. + u_time * 3.) * 5.)) * smoothstep(0., 1., pow(1. - color.r, 2.));
    position.y += wingFlap;
    position *= aScale;
    if (p.w >= 100.) {
        position *= p.w - 100.;
    }
    position = mat3(modelMatrix) * position;
    v.z *= -1.;
    float xz = length(v.xz);
    float xyz = 1.;
    float x = sqrt(1. - v.y * v.y);
    float cosry = v.x / xz;
    float sinry = v.z / xz;
    float cosrz = x / xyz;
    float sinrz = v.y / xyz;
    mat3 maty = mat3(cosry, 0, -sinry, 0, 1, 0, sinry, 0, cosry);
    mat3 matz = mat3(cosrz, sinrz, 0, -sinrz, cosrz, 0, 0, 0, 1);
    position = maty * matz * position;
    position += p.xyz;
    return position;
}

  // http://lolengine.net/blog/2013/09/21/picking-orthogonal-vector-combing-coconuts
vec3 orthogonal(vec3 v) {
    return normalize(abs(v.x) > abs(v.z) ? vec3(-v.y, v.x, 0.0) : vec3(0.0, -v.z, v.y));
}

float tangentFactor = 0.005;

void main() {
    vUv = uv;
    vUv2 = uv2;
    vUvOffset = aUvOffset;
    vColor = color;

    vec4 texturePosition = texture2D(tPosition, aFboUv);
    vec3 velocity = normalize(texture2D(tVelocity, aFboUv).xyz);

    vec3 newPosition = position;

    newPosition = animate(newPosition, texturePosition, velocity);

    vec3 tangent1 = orthogonal(normal);
    vec3 tangent2 = normalize(cross(normal, tangent1));
    vec3 nearby1 = position + tangent1 * tangentFactor;
    vec3 nearby2 = position + tangent2 * tangentFactor;
    vec3 distorted1 = animate(nearby1, texturePosition, velocity);
    vec3 distorted2 = animate(nearby2, texturePosition, velocity);
    vec3 distortedNormal = normalize(cross(distorted1 - newPosition, distorted2 - newPosition));

    // Recalculate normals
    vec3 transformedNormal = distortedNormal;
    transformedNormal = normalMatrix * transformedNormal;
    vNormal = normalize(transformedNormal);

    vec3 objectTangent = vec3(tangent.xyz);
    vec3 transformedTangent = mat3(modelMatrix) * objectTangent;
    transformedTangent = normalize(transformedTangent);

    vNormal = transformedNormal;
    vTangent = normalize((modelViewMatrix * vec4(transformedTangent, 0.0)).xyz);
    vBitangent = normalize(cross(vNormal, vTangent) * tangent.w);

    vec4 newPosition2 = vec4(newPosition, 1.);
    vec4 mvPosition = viewMatrix * newPosition2;
    vViewPosition = -mvPosition.xyz;

    gl_Position = projectionMatrix * viewMatrix * vec4(newPosition, 1.0);
}`;
