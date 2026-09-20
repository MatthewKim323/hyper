// Favicon swap: tab hidden -> "eyes" favicon, visible -> whatever the page declared.
// Only sizes we actually ship an "eyes" PNG for are swapped. Next generates a 256x256 link
// from app/favicon.ico, and public/favicon/ holds no PNGs at all, so matching on "any pixel
// size" and rebuilding a /favicon/favicon-<size>.png path 404s on every visibility change.
import { assetUrl } from "../core/asset-url";

const EYES_SIZES = new Set(["16x16", "32x32"]);
// The href each link had before the first swap, so restoring never has to guess a filename.
const original = new WeakMap<HTMLLinkElement, string>();

function iconLinks(): HTMLLinkElement[] {
  return Array.prototype.slice
    .call(document.querySelectorAll("link[rel*='icon']"))
    .filter((e: HTMLLinkElement) => EYES_SIZES.has(String(e.sizes)));
}

export class Favicon {
  static toEyes() {
    iconLinks().forEach((e) => {
      if (!original.has(e)) original.set(e, e.href);
      e.href = assetUrl("images/eyes-" + e.sizes + ".png") + "?=" + Math.random();
    });
  }

  static toDefault() {
    iconLinks().forEach((e) => {
      const href = original.get(e);
      if (href) e.href = href;
    });
  }

  /** Update the favicon to reflect tab visibility. */
  static handleFavicon() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) Favicon.toEyes();
      else Favicon.toDefault();
    });
  }
}

export default Favicon;
