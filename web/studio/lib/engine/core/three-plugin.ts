/* eslint-disable @typescript-eslint/no-explicit-any */
// gsap "three" plugin v3.0.0.
// Tween x/y/z, rotationX/Y/Z (degrees, "+=" supported), scaleX/Y/Z, scale, opacity, visible on an Object3D.
import gsap from "gsap";

let _gsap: any, _coreInitted: any, PropTween: any;

const _getGSAP = () =>
  _gsap || (typeof window !== "undefined" && (_gsap = (window as any).gsap) && _gsap.registerPlugin && _gsap);

const _xyzContexts: Record<string, string> = { x: "position", y: "position", z: "position" };
const _DEG2RAD = Math.PI / 180;

const _visibleSetter = (target: any, _prop: string, value: any) => {
  value = !!value;
  if (target.visible !== value) {
    target.visible = value;
    target.traverse((child: any) => {
      child.visible = value;
    });
  }
};

const _degreesToRadians = (value: any) =>
  (typeof value === "string" && value.charAt(1) === "="
    ? ((value.substr(0, 2) + parseFloat(value.substr(2))) as any)
    : value) * _DEG2RAD;

const _initCore = (core?: any) => {
  _gsap = core || _getGSAP();
  if (_gsap) {
    PropTween = _gsap.core.PropTween;
    _coreInitted = 1;
  }
};

"position,scale,rotation".split(",").forEach((p) => {
  _xyzContexts[p + "X"] = _xyzContexts[p + "Y"] = _xyzContexts[p + "Z"] = p;
});

export const ThreePlugin: any = {
  version: "3.0.0",
  name: "three",
  register: _initCore,
  init(this: any, target: any, values: any) {
    let context: string, axis: string, value: any, p: string, i: number, m: any;
    if (!_coreInitted) _initCore(gsap);
    for (p in values) {
      context = _xyzContexts[p];
      value = values[p];
      if (context) {
        const last = p.charAt(p.length - 1).toLowerCase();
        axis = ~last.indexOf("x") ? "x" : ~last.indexOf("z") ? "z" : "y";
        this.add(target[context], axis, target[context][axis], ~p.indexOf("rotation") ? _degreesToRadians(value) : value);
      } else if (p === "scale") {
        this.add(target[p], "x", target[p].x, value);
        this.add(target[p], "y", target[p].y, value);
        this.add(target[p], "z", target[p].z, value);
      } else if (p === "opacity") {
        m = target.material.length ? target.material : [target.material];
        i = m.length;
        while (--i > -1) {
          m[i].transparent = true;
          this.add(m[i], p, m[i][p], value);
        }
      } else if (p === "visible") {
        if (target.visible !== value) {
          this._pt = new PropTween(this._pt, target, p, value ? 0 : 1, value ? 1 : -1, 0, 0, _visibleSetter);
        }
      } else {
        this.add(target, p, target[p], value);
      }
      this._props.push(p);
    }
  },
};

export function registerThreePlugin() {
  gsap.registerPlugin(ThreePlugin);
}

export default ThreePlugin;
