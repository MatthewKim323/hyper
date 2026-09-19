/* eslint-disable @typescript-eslint/no-explicit-any */
// ScrollAnimations: parses `animate-from` / `animate-to` attributes into
// paused ScrollTrigger tweens, mirrors x/y/z/rotation onto `_glProps` for dom2webgl elements,
// registers the `glProps` gsap plugin and the effects registry.
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MathUtils } from "three";
import { store } from "../core/store";
import { registerGlProps } from "../core/gl-props";
import { effects } from "./effects";

const o: any = store;

// Attribute strings are JS object literals and may reference the global store.
function evalAttr(e: string): any {
  return Function('"use strict";return (' + e + ")")();
}

export class ScrollAnimations {
  fromAttr = "animate-from";
  toAttr = "animate-to";
  mirrorGlProps: Record<string, string> = {
    x: "position.x",
    y: "position.y",
    z: "position.z",
    rotationX: "rotation.x",
    rotationY: "rotation.y",
    rotationZ: "rotation.z",
  };
  els: { el: Element; tween: any }[] = [];

  constructor() {
    this.registerGsapPlugins();
    this.registerGsapEffects();
  }

  build() {
    this.els = [];
    const e = document.querySelectorAll(`[${this.fromAttr}], [${this.toAttr}]`);
    const t = e.length;
    for (let i = 0; i < t; i++) {
      const el: any = e[i];
      if (
        el.attributes[this.fromAttr] &&
        "" === el.attributes[this.fromAttr].value &&
        el.attributes[this.toAttr] &&
        "" === el.attributes[this.toAttr].value
      )
        continue;
      let glProps: any = { uniforms: {} };
      const s: any = {
        ease: "none",
        duration: 1.5,
        scrollTrigger: { trigger: el, horizontal: o.ASScroll.isHorizontal, once: true },
      };
      const n = el.getBoundingClientRect();
      let r: any;
      let a: any = el;
      let c: any = false;
      let h: any = false;
      if (el.attributes[this.fromAttr]) {
        c = evalAttr(`{${el.attributes[this.fromAttr].value}}`);
        if (el.hasAttribute("dom2webgl")) {
          const p = this.parseGlPropsFrom(c, glProps, n);
          c = p.from;
          glProps = p.glProps;
        }
      }
      if (c.preset && !effects[c.preset]) continue;
      if (el.attributes[this.toAttr]) {
        h = { ...s, ...evalAttr(`{${el.attributes[this.toAttr].value}}`) };
        if (el.hasAttribute("dom2webgl")) h = this.parseGlPropsTo(h, n);
      }
      if (h.stagger || c.stagger) a = el.children;
      s.scrollTrigger = Object.assign(s.scrollTrigger, c.scrollTrigger);
      delete c.scrollTrigger;
      if (!a.length && a.hasAttribute("dom2webgl")) {
        if (!a._glProps) a._glProps = glProps;
        if (s.scrollTrigger.pin) {
          this.updateGlPropsPinPos(s, a);
          s.scrollTrigger.onUpdate = () => {
            this.updateGlPropsPinPos(s, a);
          };
        }
      }
      if (c && c.preset) {
        const p = c.preset;
        delete c.preset;
        if (effects[p].defaults.scrollTrigger)
          s.scrollTrigger = Object.assign(s.scrollTrigger, effects[p].defaults.scrollTrigger);
        c.scrollTrigger = s.scrollTrigger;
        r = (gsap.effects as any)[p](a, c);
      } else if (c && h) {
        h = Object.assign(s, h);
        r = gsap.fromTo(a, c, h);
      } else if (!h && c) {
        c = Object.assign(s, c);
        r = gsap.from(a, c);
      } else {
        h = Object.assign(s, h);
        r = gsap.to(a, h);
      }
      if (r.scrollTrigger) r.scrollTrigger.disable();
      r.pause();
      this.els.push({ el, tween: r });
    }
  }

  enable() {
    for (let e = 0; e < this.els.length; e++) {
      const tw = this.els[e].tween;
      if (tw.scrollTrigger) {
        tw.scrollTrigger.enable();
        if (tw.scrollTrigger.isActive && !tw.scrollTrigger.vars.scrub) tw.restart(true);
      }
    }
  }

  parseGlPropsFrom(e: any, t: any, i: DOMRect) {
    e.glProps = {};
    if (Object.prototype.hasOwnProperty.call(e, "uniforms")) {
      e.glProps.uniforms = { ...e.uniforms };
      t.uniforms = { ...e.uniforms };
      delete e.uniforms;
    }
    for (const s in e)
      if (Object.prototype.hasOwnProperty.call(this.mirrorGlProps, s)) {
        const v = this.parseMirroredValue(s, e[s], i);
        e.glProps[this.mirrorGlProps[s]] = v;
        t[this.mirrorGlProps[s]] = v;
      }
    return { from: e, glProps: t };
  }

  parseGlPropsTo(e: any, t: DOMRect) {
    e.glProps = {};
    if (Object.prototype.hasOwnProperty.call(e, "uniforms")) {
      e.glProps.uniforms = { ...e.uniforms };
      delete e.uniforms;
    }
    for (const i in e)
      if (Object.prototype.hasOwnProperty.call(this.mirrorGlProps, i)) {
        const s = this.parseMirroredValue(i, e[i], t);
        e.glProps[this.mirrorGlProps[i]] = s;
      }
    return e;
  }

  parseMirroredValue(e: string, t: any, i: DOMRect) {
    if ("function" == typeof t) t = t();
    if ("string" == typeof t && t.includes("%")) t = ("x" === e ? i.width : i.height) * parseFloat(t) * 0.01;
    if (e.includes("rotation")) t = MathUtils.degToRad(t);
    return t;
  }

  updateGlPropsPinPos(e: any, t: any) {
    if (e.scrollTrigger.horizontal) t._glProps["position.x"] = gsap.getProperty(t, "x");
    else t._glProps["position.y"] = gsap.getProperty(t, "y");
  }

  registerGsapEffects() {
    for (const e in effects) gsap.registerEffect(effects[e]);
  }

  registerGsapPlugins() {
    gsap.registerPlugin(ScrollTrigger);
    registerGlProps();
  }

  destroy() {
    for (let e = 0; e < this.els.length; e++) {
      if (this.els[e].tween) this.els[e].tween.kill();
      if (this.els[e].tween.scrollTrigger) this.els[e].tween.scrollTrigger.kill(false);
    }
  }
}

export default ScrollAnimations;
