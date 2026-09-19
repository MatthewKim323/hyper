/* eslint-disable @typescript-eslint/no-explicit-any */
// gsap effects registry, used by `animate-from="preset: '...'"`.
import gsap from "gsap";
import { MathUtils } from "three";
import { $, $$ } from "../core/component-manager";
import { store } from "../core/store";

export const webglTextReveal = {
  name: "webglTextReveal",
  extendTimeline: true,
  effect: (e: any, t: any) => {
    if (t.glProps) delete t.glProps;
    e[0]._glProps.uniforms.u_progress = 0;
    return gsap.to(e[0], {
      glProps: { uniforms: { u_progress: 1 } },
      onComplete() {
        e[0]._webGLItem.visible = false;
      },
      ...t,
    });
  },
  defaults: { duration: 3.5, ease: "power2.out" },
};

export const webglPeelEffect = {
  name: "webglPeelEffect",
  extendTimeline: true,
  effect: (e: any, t: any) => {
    if (t.glProps) delete t.glProps;
    if (store.mq.sm.matches) e[0]._glProps.uniforms.u_enableBend = true;
    e[0]._glProps.uniforms.u_progress = 0;
    return (gsap.to as any)(e[0], { glProps: { uniforms: { u_progress: 1.5 } }, ...t }, 0);
  },
  defaults: {
    ease: "sine.out",
    scrollTrigger: { scrub: true, once: false, start: "top bottom", end: "bottom 70%" },
  },
};

export const webglParallaxEffect = {
  name: "webglParallaxEffect",
  extendTimeline: true,
  effect: (e: any, t: any) => {
    if (t.glProps) delete t.glProps;
    e[0]._glProps.uniforms.u_innerY = -0.2;
    e[0]._glProps.uniforms.u_innerScale = 1.2;
    return (gsap.to as any)(e[0], { glProps: { uniforms: { u_innerY: 0.1, u_innerScale: 1 } }, ...t }, 0);
  },
  defaults: {
    ease: "none",
    scrollTrigger: { scrub: true, once: false, start: "top bottom", end: "bottom top" },
  },
};

export const effects: Record<string, any> = {
  fade: {
    name: "fade",
    extendTimeline: true,
    effect: (e: any, t: any) => gsap.from(e, t),
    defaults: { autoAlpha: 0, duration: 1.5, ease: "expo.out", clearProps: "all" },
  },
  fadeUp: {
    name: "fadeUp",
    extendTimeline: true,
    effect: (e: any, t: any) => gsap.from(e, t),
    defaults: { autoAlpha: 0, y: 30, duration: 1.5, ease: "expo.out", clearProps: "all", force3D: true },
  },
  webglTextReveal,
  webglPeelEffect,
  webglParallaxEffect,
  mobileWithText: {
    name: "mobileWithText",
    effect: (e: any) => {
      const i = e[0];
      const ph: any = $('[dom2webgl="c:PhoneModel"]', i);
      const n: any[] = $$('[dom2webgl="c:TextReveal"]', i);
      const r = ph.getBoundingClientRect();
      const a = n[n.length - 1].getBoundingClientRect();
      n[0]._glProps = { uniforms: { u_progress: 0 } };
      n[1]._glProps = { uniforms: { u_progress: 0 } };
      gsap
        .timeline({
          scrollTrigger: { trigger: n[0], scrub: 0.5, start: "top bottom", end: "bottom top" },
          defaults: { ease: "none" },
        })
        .to(n[0], { glProps: { uniforms: { u_progress: 1 } } } as any)
        .to(n[0], { glProps: { uniforms: { u_progress: 0 } } } as any);
      gsap
        .timeline({
          scrollTrigger: { trigger: n[1], scrub: 0.5, start: "top bottom", end: "bottom top" },
          defaults: { ease: "none" },
        })
        .to(n[1], { glProps: { uniforms: { u_progress: 1 } } } as any)
        .to(n[1], { glProps: { uniforms: { u_progress: 0 } } } as any);
      ph._glProps = {
        "position.x": 0,
        "position.y": 0,
        "rotation.y": MathUtils.degToRad(30),
        "rotation.z": MathUtils.degToRad(10),
      };
      const c: any = gsap
        .timeline({
          scrollTrigger: {
            scrub: 0.5,
            trigger: ph,
            endTrigger: n[n.length - 1],
            start: "center center-=15%",
            end: "center center",
          },
        })
        .to(
          ph,
          {
            duration: 1,
            glProps: {
              "position.x": a.right - r.left,
              "position.y": a.top - r.top - r.height / 2 + a.height / 2,
              "rotation.y": MathUtils.degToRad(-390),
              "rotation.z": MathUtils.degToRad(-10),
            },
          } as any,
          0,
        )
        .call(
          () => {
            const w = ph._webGLItem;
            if (w.textures.length > 1) {
              if (w.screen.material.map.image instanceof HTMLVideoElement) w.screen.material.map.image.pause();
              if (c.scrollTrigger.direction > 0) w.screen.material.map = w.textures[1].texture;
              else w.screen.material.map = w.textures[0].texture;
              if (w.screen.material.map.image instanceof HTMLVideoElement) w.screen.material.map.image.play();
            }
          },
          undefined,
          0.4,
        );
      return c;
    },
    defaults: { ease: "none" },
  },
};

export default effects;
