/* eslint-disable @typescript-eslint/no-explicit-any */
// gsap "glProps" plugin (registered by ScrollAnimations).
// Tweens `target._glProps[key]`, or nested `target._glProps[group][key]` for object values (e.g. uniforms).
import gsap from "gsap";

export const GlPropsPlugin: any = {
  name: "glProps",
  init(this: any, target: any, values: any) {
    for (const key in values)
      if (typeof values[key] !== "object") this.add(target._glProps, key, target._glProps[key], values[key]);
      else
        for (const sub in values[key]) {
          this.add(target._glProps[key], sub, target._glProps[key][sub], values[key][sub]);
          this._props.push(sub);
        }
  },
};

export function registerGlProps() {
  gsap.registerPlugin(GlPropsPlugin);
}

export default GlPropsPlugin;
