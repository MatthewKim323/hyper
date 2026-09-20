// One still of the preloaded world as a texture, for the route transitions between the landing and
// the world. Uploaded once per transition: never redraw or re-upload it per frame.
import { CanvasTexture, LinearFilter, type Texture } from "three";
import { captureWarmFrame } from "@/components/atrium/warm-frame";

export const WORLD_EVENTS = { shown: "hyper:world-shown" } as const;

/** Null while onboarding still owns /projects, or when the world is not ready to draw. */
export function captureWorldStill(): Texture | null {
  // The attribute, not the saved flag: skipping onboarding opens the world for the page session only.
  if (document.documentElement.dataset.onboarding !== "complete") return null;
  const frame = captureWarmFrame();
  if (!frame) return null;
  const texture = new CanvasTexture(frame);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** Resolves once the live world is on screen (plus two frames), or after `timeout` ms. */
export function worldShown(timeout = 4000): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener(WORLD_EVENTS.shown, finish);
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    };
    window.addEventListener(WORLD_EVENTS.shown, finish);
    window.setTimeout(finish, timeout);
  });
}
