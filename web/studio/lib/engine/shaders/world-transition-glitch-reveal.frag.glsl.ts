export const worldTransitionGlitchRevealFrag = /* glsl */ `#define GLSLIFY 1
varying vec2 vUv;

uniform sampler2D u_fromScene;
uniform sampler2D u_toScene;
uniform float u_progress;
uniform float u_time;
uniform sampler2D u_noise;

float circle(in vec2 _st, in float _scale, in float _radius, in float _fade){
    vec2 dist = (_st-vec2(0.5)) / _scale;
    return 1.-smoothstep(_radius-(_radius*_fade),
                         _radius+(_radius*_fade),
                         dot(dist,dist)*4.0);
}

vec4 mod289(vec4 x){return x - floor(x * (1.0 / 289.0)) * 289.0;}
vec4 perm(vec4 x){return mod289(((x * 34.0) + 1.0) * x);}

float noise(vec3 p){
    vec3 a = floor(p);
    vec3 d = p - a;
    d = d * d * (3.0 - 2.0 * d);

    vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
    vec4 k1 = perm(b.xyxy);
    vec4 k2 = perm(k1.xyxy + b.zzww);

    vec4 c = k2 + a.zzzz;
    vec4 k3 = perm(c);
    vec4 k4 = perm(c + 1.0);

    vec4 o1 = fract(k3 * (1.0 / 41.0));
    vec4 o2 = fract(k4 * (1.0 / 41.0));

    vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);
    vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);

    return o4.y * d.y + o4.x * (1.0 - d.y);
}

//2D (returns 0 - 1)
float random2d(vec2 n) {
    return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

float randomRange (in vec2 seed, in float min, in float max) {
        return min + random2d(seed) * (max - min);
}

// return 1 if v inside 1d range
float insideRange(float v, float bottom, float top) {
   return step(bottom, v) - step(top, v);
}

//inputs
float SPEED = 0.3; //0 - 1 speed

void main() {
    vec2 uv = vUv;

    float time = floor(u_time * SPEED * 60.0);

    //copy orig
    vec3 outCol = texture2D(u_toScene, uv).rgb;

    float AMT = u_progress * 0.7;

    //randomly offset slices horizontally
    float maxOffset = AMT/2.0;
    vec2 uvOff;
    for (int i = 0; i < 2; i += 1) {
        float sliceY = random2d(vec2(time , 2345.0 + float(i)));
        float sliceH = random2d(vec2(time , 9035.0 + float(i))) * 0.25;
        float hOffset = randomRange(vec2(time , 9625.0 + float(i)), -maxOffset, maxOffset);
        uvOff = uv;
        uvOff.x += hOffset;
        if (insideRange(uv.y, sliceY, fract(sliceY+sliceH)) == 1.0 ){
            outCol = texture2D(u_toScene, uvOff).rgb;
        }
    }

    //do slight offset on one entire channel
    float maxColOffset = AMT/50.0;
    float rnd = random2d(vec2(time , 9545.0));
    vec2 colOffset = vec2(randomRange(vec2(time , 9545.0),-maxColOffset,maxColOffset),
                       randomRange(vec2(time , 7205.0),-maxColOffset,maxColOffset));
    if (rnd < 0.33){
        outCol.r = texture2D(u_toScene, uv + colOffset).r;

    }else if (rnd < 0.66){
        outCol.g = texture2D(u_toScene, uv + colOffset).g;

    } else{
        outCol.b = texture2D(u_toScene, uv + colOffset).b;
    }

    float n1 = noise(vec3(vUv * (16.2412), 0.5));
    float n2 = noise(vec3(vUv * 7.633, u_time * 0.35 + n1));

    vec2 circleUv = vec2(vec2(vUv - vec2(0.5)) / 1.5 + vec2(0.5));
    vec2 circleUv2 = vec2(vec2(vUv - vec2(0.5)) / 1.8 + vec2(0.5));
    float noiseReveal = circle(circleUv, u_progress + 0.001, u_progress + n2, 0.1);
    float noiseEdge = circle(circleUv2, u_progress + 0.001, u_progress + n2, 0.5);

    vec4 worldCol = texture2D(u_fromScene, vUv);

    // vec4 origCol = texture2D( u_toScene, vUv );
    vec4 origCol = vec4(outCol, 1.);
    vec3 baseColor = origCol.rgb * clamp(noiseEdge * 2., 1., 1.5);
    vec3 revealColor = worldCol.rgb;

    gl_FragColor = mix(vec4(baseColor, origCol.a), vec4(revealColor, 1.), noiseReveal);
}
`;
