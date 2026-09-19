// Device capabilities shared by responsive layouts and the 3D renderer.
export function detectDevice() {
  const ua = navigator.userAgent.toLowerCase();
  const classify = () => {
    const mobile = innerWidth < 640 || /iphone|ipod|android.+mobile/.test(ua);
    const ipad =
      /ipad/.test(ua) || (/macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const tablet = !mobile && (innerWidth < 1024 || ipad || /android/.test(ua));
    return {
      mobile,
      tablet,
      desktop: !mobile && !tablet,
      any: mobile || tablet,
      ipadpro: tablet && innerWidth > 1024,
    };
  };
  const { mobile, tablet } = classify();
  const any = mobile || tablet;
  const browser = /chrome/.test(ua)
    ? "chrome"
    : /safari/.test(ua)
      ? "safari"
      : /firefox/.test(ua)
        ? "firefox"
        : "unknown";
  const os = {
    win: /win/i.test(navigator.platform),
    mac: /mac/i.test(navigator.platform),
    ios: /iphone|ipad/.test(ua),
    android: /android/.test(ua),
  };
  const result = {
    browser,
    os,
    ua,
    device: classify(),
    retina: devicePixelRatio > 1,
    touch: navigator.maxTouchPoints > 0,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    webp: true,
    webgl: true,
    legacy: browser === "safari" && !any,
    mode: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    spec: { str: "Desktop", score: 8 },
  };
  document.documentElement.classList.add(any ? "is-any" : "is-not-any");
  if (mobile) document.documentElement.classList.add("is-mobile");
  if (tablet) document.documentElement.classList.add("is-tablet");
  if (result.device.ipadpro)
    document.documentElement.classList.add("is-large-tablet");
  if (result.legacy) document.documentElement.classList.add("is-legacy");
  document.documentElement.dataset.os = os.mac
    ? "mac"
    : os.win
      ? "win"
      : "other";
  document.documentElement.dataset.browser = browser;
  // Desktop and touch use separate scene implementations, as on the reference.
  window.addEventListener("resize", () => {
    const next = classify();
    if (next.any !== result.device.any) {
      location.reload();
      return;
    }
    result.device = next;
    for (const [name, enabled] of Object.entries({
      "is-mobile": next.mobile,
      "is-tablet": next.tablet,
      "is-large-tablet": next.ipadpro,
    })) {
      document.documentElement.classList.toggle(name, enabled);
    }
  });
  return result;
}
