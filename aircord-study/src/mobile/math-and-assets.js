// Recovered responsive implementation. See PROVENANCE.md.
export default function initialize() {
  ((window.getSrcContent = (t = !1, e = !1, i = !1, n = !1) => {
    let r = t;
    return (
      DETECT.retina && e && (r = e),
      DETECT.device.tablet && !n && e && (r = e),
      DETECT.device.mobile && i && (r = i),
      DETECT.device.tablet && n && (r = n),
      r + ".webp?v=" + UNIQ_ID
    );
  }),
    (window.getEase = (t = 0, e = "power2_inOut") => {
      const i = {
        power2_inOut: (t) =>
          t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
        power3_inOut: (t) =>
          t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
        power4_inOut: (t) =>
          t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2,
        expo_inOut: (t) =>
          0 === t
            ? 0
            : 1 === t
              ? 1
              : t < 0.5
                ? Math.pow(2, 20 * t - 10) / 2
                : (2 - Math.pow(2, -20 * t + 10)) / 2,
      };
      if (i[e]) return i[e](t);
    }),
    (window.htmlDecode = (t) =>
      new DOMParser().parseFromString(t, "text/html").documentElement
        .textContent),
    (window.isFiniteAndNotNaN = (t) =>
      !(t === 1 / 0 || t === -1 / 0 || Number.isNaN(t))),
    (window.getSrc = (t = !1, e = !1, i = !1, n = !1, r = !0) => {
      let s = t;
      return (
        DETECT.retina && e && (s = e),
        DETECT.device.tablet && !n && e && (s = e),
        DETECT.device.mobile && i && (s = i),
        DETECT.device.tablet && n && (s = n),
        s && (s += r ? ".webp?v=" + UNIQ_ID : "?v=" + UNIQ_ID),
        s
      );
    }),
    (window.getVideoSrc = (t = !1, e = !1, i = !1, n = !1) => {
      let r = t;
      return (
        DETECT.retina && e && (r = e),
        DETECT.device.tablet && !n && e && (r = e),
        DETECT.device.mobile && i && (r = i),
        DETECT.device.tablet && n && (r = n),
        r
      );
    }),
    (window.isNumber = (t) => "number" == typeof t && !isNaN(t)),
    (window.isNaN = (t) => {
      const e = Number(t);
      return e != e;
    }),
    (window.clamp = (t, e, i) => Math.min(Math.max(t, e), i)),
    (window.hexToRgb = (t) => {
      const e = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(t);
      return e
        ? {
            r: parseInt(e[1], 16),
            g: parseInt(e[2], 16),
            b: parseInt(e[3], 16),
          }
        : null;
    }),
    (window.rgbToHex = (t) =>
      "#" +
      t
        .match(/\d+/g)
        .map(Number)
        .map(function (t) {
          return t.toString(16).padStart(2, "0");
        })
        .join("")),
    (window.degToRad = (t) => t * (Math.PI / 180)),
    (window.radToDeg = (t) => t * (180 / Math.PI)),
    (window.getVwThree = (t, e, i, n, r) =>
      (((e / 100) * t) / i) * (2 * Math.tan((r * Math.PI) / 180 / 2) * n)),
    (window.getPxByVw = (t = 0, e = window.innerWidth) =>
      (1 / VW) * 100 * t * (e / 100)),
    (window.getPxByVh = (t = 0, e = window.innerHeight) =>
      (1 / VH) * 100 * t * (e / 100)),
    (window.getPxByVwThree = (t = 0, e = 0, i = 0) => getPxByVw(t, e) / i),
    (window.toUpperCase = (t) => t.toUpperCase()),
    (window.onPlayVideo = (t) => {
      t.play()
        .then(() => {})
        .catch((t) => {
          t.name;
        });
    }),
    (window.getParam = (t, e = window.location.href) => {
      t = t.replace(/[\[\]]/g, "\\$&");
      var i = new RegExp("[?&]" + t + "(=([^&#]*)|&|#|$)").exec(e);
      return i
        ? i[2]
          ? decodeURIComponent(i[2].replace(/\+/g, " "))
          : ""
        : null;
    }),
    (window.toZero = (t, e = 1e-10) => (Math.abs(t) < e ? 0 : t)),
    (window.replaceHead = (t) => {
      const e = document.head,
        i = t.next.html.match(/]*>([\s\S.]*)<\/head>/i)[0],
        n = document.createElement("head");
      n.innerHTML = i;
      const r = [
          "meta[name='description']",
          "meta[property^='og']",
          "meta[name^='twitter']",
        ].join(","),
        s = e.querySelectorAll(r);
      for (let t = 0; t < s.length; t++) e.removeChild(s[t]);
      const o = n.querySelectorAll(r);
      for (let t = 0; t < o.length; t++) e.appendChild(o[t]);
    }));
}
