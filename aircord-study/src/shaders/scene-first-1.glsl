#define GLSLIFY 1
varying vec2 vUv;
uniform vec2 uv_resolution;
uniform sampler2D tDiffuse;
uniform float tvNoizePower;
uniform float zoomPower;

void main() {

	vec2 rad = radians( vUv * 180. );
	vec2 _sin = vec2( sin( rad ) );
	float c = clamp( 0.33 - min( _sin.x, _sin.y ), 0.0, 1.0 );
	vec4 iDiffuse = texture2D( tDiffuse, vUv );
	gl_FragColor = iDiffuse - c * 0.1;

}