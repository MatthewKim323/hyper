// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  ((window.styleLang = {
    data: {
      default: null,
      current: null,
      array: null,
      en: { el: null, url: null },
      ja: { el: null, url: null },
    },
    local: null,
    once() {
      let t =
        (window.navigator.languages && window.navigator.languages[0]) ||
        window.navigator.language ||
        window.navigator.userLanguage ||
        window.navigator.browserLanguage;
      ((this.data.default = t.split("-")[0]),
        (this.data.array =
          window.navigator.languages ||
          window.navigator.language ||
          window.navigator.userLanguage ||
          window.navigator.browserLanguage),
        (this.data.current =
          document.querySelector(".c-lc").dataset.currentLang),
        $html.setAttribute("lang", this.data.current));
    },
    kitId: "vrc5wut",
    isLoadedJpFonts: !1,
    onLoadJpFonts() {
      if (DETECT.os.win) {
        ((this.isLoadedJpFonts = !0),
          (function (t) {
            var e = { kitId: "vrc5wut", scriptTimeout: 3e3, async: !0 },
              i = t.documentElement,
              n = setTimeout(function () {
                i.className =
                  i.className.replace(/\bwf-loading\b/g, "") + " wf-inactive";
              }, e.scriptTimeout),
              r = t.createElement("script"),
              s = !1,
              a = t.getElementsByTagName("script")[0];
            ((i.className += " wf-loading"),
              (r.src = "https://use.typekit.net/" + e.kitId + ".js"),
              (r.async = !0),
              (r.id = "typekit-script"),
              (r.onload = r.onreadystatechange =
                function () {
                  var t = this.readyState;
                  if (!(s || (t && "complete" != t && "loaded" != t))) {
                    ((s = !0), clearTimeout(n));
                    try {
                      Typekit.load(e);
                    } catch (t) {}
                  }
                }),
              a.parentNode.insertBefore(r, a));
          })(document));
        const t = document.createElement("link");
        ((t.rel = "stylesheet"),
          (t.id = "yakuhanjp-css"),
          (t.href =
            "https://cdn.jsdelivr.net/npm/yakuhanjp@4.0.1/dist/css/yakuhanjp.css"),
          document.head.appendChild(t));
      }
    },
    onInit(t) {
      ((this.local = t || document.querySelector(".c-lc")),
        (this.data.current = this.local.dataset.currentLang),
        (this.data.en.el = document.querySelectorAll(".js-lang-en")),
        (this.data.ja.el = document.querySelectorAll(".js-lang-ja")),
        (this.data.en.url = this.local
          .querySelector('.js-get-translate-current-url[data-lang="ja"]')
          .getAttribute("href")),
        (this.data.ja.url = this.local
          .querySelector('.js-get-translate-current-url[data-lang="en"]')
          .getAttribute("href")),
        "ja" !== this.data.current ||
          document.querySelector("#typekit-script") ||
          this.onLoadJpFonts());
      for (let t = 0; t < this.data.en.el.length; t++) {
        this.data.en.el[t].setAttribute("href", this.data.en.url);
      }
      for (let t = 0; t < this.data.ja.el.length; t++) {
        this.data.ja.el[t].setAttribute("href", this.data.ja.url);
      }
      this.sitemap = {};
      const e = this.local.querySelectorAll(".js-get-translate-link"),
        i = document.querySelectorAll(".js-put-translate-link");
      for (let t = 0; t < e.length; t++) {
        const i = e[t],
          n = i.getAttribute("href"),
          r = i.dataset.to;
        this.sitemap[r] = n;
      }
      for (let t = 0; t < i.length; t++) {
        const e = i[t],
          n = e.dataset.to;
        this.sitemap[n] && e.setAttribute("href", this.sitemap[n]);
      }
      ($html.setAttribute("lang", this.data.current), this.onReplaceLink());
    },
    onReplaceLink() {
      const t = document.querySelectorAll(".js-r-a");
      for (let e = 0; e < t.length; e++) {
        const i = t[e],
          n = i.getAttribute("href"),
          r = i.dataset.to;
        n != URLS[this.data.current][r] &&
          i.setAttribute("href", URLS[this.data.current][r]);
      }
    },
    onDestroy() {},
  }),
    styleLang.once());
}
