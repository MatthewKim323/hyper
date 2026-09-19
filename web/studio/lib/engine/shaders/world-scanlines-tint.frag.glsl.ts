export const worldScanlinesTintFrag = /* glsl */ `precision highp float;
#define GLSLIFY 1

uniform sampler2D tDiffuse;
uniform float time;
uniform float u_strength;
uniform vec3 u_color;
varying vec2 vUv;

void main() {

	vec2 pos = vUv;

	vec4 origcol = texture2D(tDiffuse, pos);
    vec3 col;

    col.r = texture2D(tDiffuse, vec2(pos.x+0.001,pos.y)).x;
    col.g = texture2D(tDiffuse, vec2(pos.x+0.000,pos.y)).y;
    col.b = texture2D(tDiffuse, vec2(pos.x-0.001,pos.y)).z;

	float c = 1.;

	c += 2. * sin(time * 4. + pos.y * 1000.);
	c += 1. * sin(time * 4. + pos.y * 999.);

	//vignetting
	c *= sin(pos.x*3.15);
	c *= sin(pos.y*3.);
	c *= 1.;

	gl_FragColor = mix(origcol, vec4(col.x * c * u_color.r, col.y * c * u_color.g, col.z * c * u_color.b, origcol.a), u_strength);
}
`;
