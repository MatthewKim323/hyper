import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { CustomEase } from "gsap/CustomEase";
import barba from "@barba/core";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import textWrapper from "canvas-text-wrapper";
import { detectDevice } from "./device.js";

window.URLS = {
  ja: {
    home: "/",
    projects: "/projects/",
    about: "/about/",
    archives: "/archives/",
  },
  en: {
    home: "/en/",
    projects: "/en/projects/",
    about: "/en/about/",
    archives: "/en/archives/",
  },
};
Object.assign(window, {
  ENV: "prod",
  UNIQ_ID: "local",
  CDN_URL: "https://d38o5po68a0yh9.cloudfront.net",
  CDN_ASSETS_URL: "/assets/v4",
  LOCAL_ASSETS_URL: "/assets/v4",
  $app: document.querySelector("#app"),
  gsap,
  CustomEase,
  barba,
  FontLoader,
  TextGeometry,
  CanvasTextWrapper: textWrapper.CanvasTextWrapper ?? textWrapper,
  NormalVert:
    "varying vec2 vUv; void main(){vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }",
});
gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, CustomEase);
gsap.config({ nullTargetWarn: false });
window.DETECT = detectDevice();
window.styleImage = null;
const initialize = (
  window.DETECT.device.any
    ? await import("./mobile.js")
    : await import("./desktop.js")
).default;
initialize();

const start = () => {
  LOADER.once();
  onLoadedBefore();
  onResize1();
};
if (document.readyState === "complete") start();
else window.addEventListener("load", start, { once: true });
