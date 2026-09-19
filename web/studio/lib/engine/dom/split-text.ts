// SplitText-compatible text segmentation for character and line animations.
// gsap/SplitText wraps each char/word in <div style="position:relative;display:inline-block">, same as the clone.
// aria "none" keeps the DOM identical to the clone (no aria-label/aria-hidden injection).
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";

let registered = false;

export function splitText(target: gsap.DOMTarget, vars: SplitText.Vars): SplitText {
  if (!registered) {
    gsap.registerPlugin(SplitText);
    registered = true;
  }
  return new SplitText(target, { aria: "none", ...vars });
}
