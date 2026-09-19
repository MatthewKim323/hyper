
export const homeReflectorMipmapDownsampleFrag = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;

uniform sampler2D map;
uniform int parentLevel;
uniform vec2 parentMapSize;
uniform vec2 originalMapSize;

// With original size argument
vec4 packedTexture2DLOD( sampler2D tex, vec2 uv, int level, vec2 originalPixelSize ) {

    float floatLevel = float( level );
    vec2 atlasSize;
    atlasSize.x = floor( originalPixelSize.x * 1.5 );
    atlasSize.y = originalPixelSize.y;

    // we stop making mip maps when one dimension == 1
    float maxLevel = min( floor( log2( originalPixelSize.x ) ), floor( log2( originalPixelSize.y ) ) );
    floatLevel = min( floatLevel, maxLevel );

    // use inverse pow of 2 to simulate right bit shift operator
    vec2 currentPixelDimensions = floor( originalPixelSize / pow( 2.0, floatLevel ) );
    vec2 pixelOffset = vec2(
        floatLevel > 0.0 ? originalPixelSize.x : 0.0,
        floatLevel > 0.0 ? currentPixelDimensions.y : 0.0
    );

    // "minPixel / atlasSize" samples the top left piece of the first pixel
    // "maxPixel / atlasSize" samples the bottom right piece of the last pixel
    vec2 minPixel = pixelOffset;
    vec2 maxPixel = pixelOffset + currentPixelDimensions;
    vec2 samplePoint = mix( minPixel, maxPixel, uv );
    samplePoint /= atlasSize;

    vec2 halfPixelSize = 1.0 / ( 2.0 * atlasSize );
    samplePoint = min( samplePoint, maxPixel / atlasSize - halfPixelSize );
    samplePoint = max( samplePoint, minPixel / atlasSize + halfPixelSize );

    return texture2D( tex, samplePoint );

}

#define SAMPLES 9

vec4 sampleAt( vec2 uv ) {
    return packedTexture2DLOD( map, uv, parentLevel, originalMapSize );
}

void main() {

    vec2 childMapSize = parentMapSize / 2.0;
    vec2 childPixelPos = floor( vUv * childMapSize );

    vec2 parentPixelSize = 1.0 / parentMapSize;
    vec2 halfParentPixelSize = parentPixelSize / 2.0;
    vec2 parentPixelPos = childPixelPos * 2.0;

    vec2 baseUv = ( parentPixelPos / parentMapSize ) + halfParentPixelSize;

    vec4 samples[ SAMPLES ];
    float weights[ SAMPLES ];

    float xden = 2.0 * parentMapSize.x + 1.0;
    float wx0 = ( parentMapSize.x - parentPixelPos.x ) / xden;
    float wx1 = ( parentMapSize.x ) / xden;
    float wx2 = ( parentPixelPos.x + 1.0 ) / xden;

    float yden = 2.0 * parentMapSize.y + 1.0;
    float wy0 = ( parentMapSize.y - parentPixelPos.y ) / yden;
    float wy1 = ( parentMapSize.y ) / yden;
    float wy2 = ( parentPixelPos.y + 1.0 ) / yden;

    samples[ 0 ] = sampleAt( baseUv );
    samples[ 1 ] = sampleAt( baseUv + vec2( parentPixelSize.x, 0.0 ) );
    samples[ 2 ] = sampleAt( baseUv + vec2( 2.0 * parentPixelSize.x, 0.0 ) );

    samples[ 3 ] = sampleAt( baseUv + vec2( 0.0, parentPixelSize.y ) );
    samples[ 4 ] = sampleAt( baseUv + vec2( parentPixelSize.x, parentPixelSize.y ) );
    samples[ 5 ] = sampleAt( baseUv + vec2( 2.0 * parentPixelSize.x, parentPixelSize.y ) );

    samples[ 6 ] = sampleAt( baseUv + vec2( 0.0, 2.0 * parentPixelSize.y ) );
    samples[ 7 ] = sampleAt( baseUv + vec2( parentPixelSize.x, 2.0 * parentPixelSize.y ) );
    samples[ 8 ] = sampleAt( baseUv + vec2( 2.0 * parentPixelSize.x, 2.0 * parentPixelSize.y ) );

    weights[ 0 ] = wx0 * wy0;
    weights[ 1 ] = wx1 * wy0;
    weights[ 2 ] = wx2 * wy0;

    weights[ 3 ] = wx0 * wy1;
    weights[ 4 ] = wx1 * wy1;
    weights[ 5 ] = wx2 * wy1;

    weights[ 6 ] = wx0 * wy2;
    weights[ 7 ] = wx1 * wy2;
    weights[ 8 ] = wx2 * wy2;

    #pragma unroll_loop
    for ( int i = 0; i < SAMPLES; i ++ ) {
        gl_FragColor += samples[ i ] * weights[ i ];
    }
}`;
