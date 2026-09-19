"use client";

import { useEffect, type RefObject } from "react";
import { store } from "@/lib/engine/core/store";

/** Refract the rendered scene beneath the card, keeping its text and controls crisp. */
export function useSceneGlass(element: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const card = element.current;
    const gl = store.Gl;
    if (!card || !gl) return;
    const uniforms = gl.screenFxPass.uniforms;
    if (!uniforms.u_glassRect) return;
    const transparency = matchMedia("(prefers-reduced-transparency: reduce)");
    const contrast = matchMedia("(prefers-contrast: more)");
    const entrance = card.closest(".hyper-onboarding__bottom");
    let frame = 0;

    function update() {
      const box = card!.getBoundingClientRect();
      const canvas = gl!.renderer.domElement.getBoundingClientRect();
      uniforms.u_glassRect.value.set(box.left - canvas.left, box.top - canvas.top, box.width, box.height);
      uniforms.u_glassViewport.value.set(canvas.width, canvas.height);
      uniforms.u_glassRadius.value = parseFloat(getComputedStyle(card!).borderTopLeftRadius) || 24;
      const opacity = entrance ? Number(getComputedStyle(entrance).opacity) : 1;
      uniforms.u_glassStrength.value = !document.hidden && !transparency.matches && !contrast.matches && box.width > 0 ? opacity : 0;
    }

    // Follow the short entrance transform, then only measure on layout changes.
    const entranceEnd = performance.now() + 1000;
    function followEntrance() {
      update();
      if (performance.now() < entranceEnd) frame = requestAnimationFrame(followEntrance);
    }
    frame = requestAnimationFrame(followEntrance);
    const observer = new ResizeObserver(update);
    observer.observe(card);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    document.addEventListener("visibilitychange", update);
    transparency.addEventListener("change", update);
    contrast.addEventListener("change", update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      document.removeEventListener("visibilitychange", update);
      transparency.removeEventListener("change", update);
      contrast.removeEventListener("change", update);
      uniforms.u_glassStrength.value = 0;
    };
  }, [element]);
}
