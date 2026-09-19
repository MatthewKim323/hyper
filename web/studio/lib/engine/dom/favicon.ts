// Favicon swap: tab hidden -> "eyes" favicon, visible -> default.
// Only links with pixel sizes ("32x32", "16x16") are swapped, when sizes are explicitly declared.
import { assetUrl } from "../core/asset-url";

function iconLinks(): HTMLLinkElement[] {
  return Array.prototype.slice
    .call(document.querySelectorAll("link[rel*='icon']"))
    .filter((e: HTMLLinkElement) => /^\d+x\d+$/.test(String(e.sizes)));
}

export class Favicon {
  static toEyes() {
    iconLinks().forEach((e) => {
      e.href = assetUrl("images/eyes-" + e.sizes + ".png") + "?=" + Math.random();
    });
  }

  static toDefault() {
    iconLinks().forEach((e) => {
      e.href = "/favicon/favicon-" + e.sizes + ".png?=" + Math.random();
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
