
export const projectsButterflyMatcapNormalmapFrag = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;
varying vec2 vUv2;
varying vec2 vUvOffset;
varying vec3 vColor;
varying vec3 vViewPosition;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vBitangent;

uniform sampler2D tDiffuse;
uniform sampler2D tLightingMatcap;
uniform sampler2D tMatcap;
uniform sampler2D tNormal;
uniform float uNormalMapStrength;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

void main() {
    vec2 wingUvOffset = vec2(8., 2.);
    vec4 body = texture2D(tDiffuse, vUv);
    vec4 wings = texture2D(tDiffuse, vUv2 + vUvOffset / wingUvOffset);

    vec4 diffuseColor = body + wings * (1. - body.a);

    if (diffuseColor.a < 0.5) {
        discard;
    }

    // calculate TBN matrix for perturbing normals
    vec3 normal = normalize( vNormal );
    vec3 tangent = normalize( vTangent );
    vec3 bitangent = normalize( vBitangent );
    mat3 tbn = mat3( tangent, bitangent, normal );

    // sample normal map
    vec3 normalTexture = texture2D(tNormal, vUv2 + vUvOffset / wingUvOffset).rgb;
    normalTexture = normalTexture * 2.0 - 1.0;
    normalTexture.xy *= uNormalMapStrength;
    normalTexture = normalize( normalTexture );

    normal = tbn * normalTexture;

    float faceDirection = 1.0;

    #ifdef FLIP_SIDED
        faceDirection = -1.0;
    #endif

    normal = normal * faceDirection;

    vec3 viewDir = normalize( vViewPosition );
    vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
    vec3 y = cross( viewDir, x );
    vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5; // 0.495 to remove artifacts caused by undersized matcap disks

    vec3 matcapColor = texture2D( tMatcap, uv ).rgb;
    vec3 matcapLighting = texture2D( tLightingMatcap, uv ).rgb;

    // vec3 diffuse = mix(diffuseColor.rgb, matcapColor * 1., 0.9);
    // vec3 diffuse = clamp(vec3(0.5) + matcapColor * 0.5, 0.0, 1.0);
    vec3 diffuse = matcapColor.rgb;
    // diffuse += matcapLighting * 0.9;
    diffuse = clamp(diffuse, 0.0, 1.0);

    gl_FragColor = vec4(diffuse, diffuseColor.a);

    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float fogFactor = smoothstep( fogNear, fogFar, depth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );

    gl_FragColor.a = smoothstep( 50., 100., depth );
}`;
