// Recovered responsive implementation. See PROVENANCE.md.
export default function initialize() {
  window.styleImage = {
    local: null,
    array: [],
    onInit(t) {
      this.local = t || document.querySelector(".c-lc");
      const e = this.local.querySelectorAll(".js-img");
      for (let t = 0; t < e.length; t++) {
        const i = e[t],
          n = i.dataset.media;
        let r = getSrc(
            i.dataset.imageD1x,
            i.dataset.imageD2x,
            i.dataset.imageMob,
            i.dataset.imageD2x,
          ),
          s = getVideoSrc(
            i.dataset.videoD1x,
            i.dataset.videoD2x,
            i.dataset.videoMob,
            i.dataset.videoD2x,
          ),
          o = getSrc(
            i.dataset.imageD1x,
            i.dataset.imageD2x,
            i.dataset.imageMob,
            i.dataset.imageD2x,
          ),
          a = i.dataset.imagePre;
        this.array.push({
          el: i,
          media: n,
          pivot: i.querySelector(".js-img-pivot"),
          wrapSlider: i.closest(".c-lo-slider"),
          preload: {
            el: null,
            pivot: i.querySelector(".js-img-preload"),
            src: a + "?v=" + UNIQ_ID,
            onload: !1,
          },
          poster: {
            el: null,
            pivot: i.querySelector(".js-img-poster"),
            src: r + "?v=" + UNIQ_ID,
            onload: !1,
          },
          video: {
            el: null,
            src: s,
            canplay: null,
            playing: null,
            pause: null,
            onload: !1,
          },
          videoPlayButton: {
            el: i.querySelector(".js-play-video"),
            click: null,
          },
          image: {
            el: null,
            image: null,
            pivot: i.querySelector(".js-img-poster"),
            src: o + "?v=" + UNIQ_ID,
            onload: !1,
          },
          shown: !1,
          visible: !1,
          listerner: null,
          observer: null,
        });
      }
      (this.array.forEach((t, e) => {
        t.preload.pivot && this.onPreload(t);
      }),
        this.array.forEach((t, e) => {
          ((t.listerner = (e) => {
            e.forEach((e, i) => {
              e.isIntersecting
                ? (t.shown ||
                    ((t.shown = !0),
                    "video" === t.media
                      ? this.onLoadVideo(t)
                      : this.onLoadImage(t)),
                  (t.el.dataset.shown = 1),
                  (t.el.dataset.visible = 1),
                  (t.visible = !0))
                : ((t.el.dataset.visible = 0),
                  (t.visible = !1),
                  t.video.el && !t.video.el.paused && t.video.el.pause());
            });
          }),
            (t.observer = new IntersectionObserver(t.listerner, {
              threshold: 0,
            })),
            t.observer.observe(t.el));
        }));
    },
    onPreload(t) {
      ((t.preload.el = new Image()),
        (t.preload.onload = () => {
          (t.el.classList.add("is-preload-loaded"),
            (t.preload.pivot.style.backgroundImage =
              "url(" + t.preload.src + ")"),
            (t.preload.isloaded = !0));
        }),
        t.preload.el.addEventListener("load", t.preload.onload),
        (t.preload.el.src = t.preload.src));
    },
    onLoadVideo(t) {
      ((t.poster.el = new Image()),
        (t.poster.onload = () => {
          (t.el.classList.add("is-poster-loaded"),
            (t.poster.pivot.style.backgroundImage =
              "url(" + t.poster.src + ")"),
            (t.poster.isloaded = !0));
        }),
        t.poster.el.addEventListener("load", t.poster.onload),
        (t.poster.el.src = t.poster.src),
        (t.video.el = document.createElement("video")),
        (t.video.el.preload = "metadata"),
        (t.video.el.loop = !0),
        t.video.el.setAttribute("playsinline", "playsinline"),
        (t.video.el.src = t.video.src),
        t.pivot.appendChild(t.video.el),
        (t.video.canplay = () => {
          t.el.classList.add("is-canplay-video");
        }),
        t.video.el.addEventListener("canplay", t.video.canplay),
        (t.video.playing = () => {
          (t.el && t.el.classList.add("is-playing"),
            t.videoPlayButton.el &&
              t.videoPlayButton.el.classList.add("is-playing"),
            t.wrapSlider && t.wrapSlider.classList.add("is-playing"));
        }),
        t.video.el.addEventListener("playing", t.video.playing),
        (t.video.pause = () => {
          (t.el && t.el.classList.add("is-playing"),
            t.videoPlayButton.el &&
              t.videoPlayButton.el.classList.remove("is-playing"),
            t.wrapSlider && t.wrapSlider.classList.remove("is-playing"));
        }),
        t.video.el.addEventListener("pause", t.video.pause),
        t.videoPlayButton.el &&
          ((t.videoPlayButton.click = (e) => {
            (e.preventDefault(),
              t.video.el &&
                (t.video.el.paused ? t.video.el.play() : t.video.el.pause()));
          }),
          t.videoPlayButton.el.addEventListener(
            "click",
            t.videoPlayButton.click,
          )));
    },
    onLoadImage(t) {
      ((t.image.el = new Image()),
        (t.image.onload = () => {
          (t.el.classList.add("is-image-loaded"),
            (t.image.pivot.style.backgroundImage = "url(" + t.image.src + ")"),
            (t.image.isloaded = !0));
        }),
        t.image.el.addEventListener("load", t.image.onload),
        (t.image.el.src = t.image.src));
    },
    onDestroy() {
      (this.array.forEach((t, e) => {
        (t.image.onload &&
          (t.image.el.removeEventListener("load", t.image.onload),
          (t.image.onload = !1),
          (t.image.el = null)),
          t.poster.onload &&
            (t.poster.el.removeEventListener("load", t.poster.onload),
            (t.poster.onload = !1),
            (t.poster.el = null)),
          t.video.canplay &&
            (t.video.el.removeEventListener("canplay", t.video.canplay),
            (t.video.canplay = !1),
            t.video.playing &&
              (t.video.el.removeEventListener("playing", t.video.playing),
              (t.video.playing = !1)),
            t.video.pause &&
              (t.video.el.removeEventListener("pause", t.video.pause),
              (t.video.pause = !1)),
            (t.video.el = null)),
          t.videoPlayButton.click &&
            (t.videoPlayButton.el.removeEventListener(
              "click",
              t.videoPlayButton.click,
            ),
            (t.videoPlayButton.click = null),
            (t.videoPlayButton.el = null)),
          t.observer &&
            (t.observer.disconnect(t.el),
            (t.observer = null),
            (t.listerner = null)));
      }),
        (this.array = []));
    },
  };
}
