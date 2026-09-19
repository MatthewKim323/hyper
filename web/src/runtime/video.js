// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  ((window.styleAppendVideo = {
    array: [],
    onInit(t) {
      const e = new Set();
      (t
        ? t.querySelectorAll(".js-append-video").forEach((t) => {
            e.add(t);
          })
        : document.querySelectorAll(".js-append-video").forEach((t) => {
            e.add(t);
          }),
        document
          .querySelectorAll(".c-bnr-modal .js-append-video")
          .forEach((t) => {
            e.add(t);
          }),
        e.forEach((t) => {
          if (t.querySelector("video")) return;
          const e = getVideoSrc(
              t.dataset.videoD1x,
              t.dataset.videoD2x,
              t.dataset.videoMob,
              t.dataset.videoD2x,
            ),
            i = document.createElement("video");
          ((i.preload = t.dataset.preload),
            (i.poster = t.dataset.poster),
            (i.src = e),
            (i.loop = "true" === t.dataset.loop),
            "true" === t.dataset.playsinline &&
              i.setAttribute("playsinline", "playsinline"),
            "true" === t.dataset.muted &&
              ((i.muted = !0), i.setAttribute("muted", "")),
            "true" === t.dataset.autoplay &&
              ((i.autoplay = !0), i.setAttribute("autoplay", "")),
            t.closest(".c-bnr-modal") && i.classList.add("js-toggle-video"),
            (i.volume = 0.5),
            t.appendChild(i),
            "true" === t.dataset.autoplay && i.play(),
            this.array.push({ el: t, video: i }));
        }));
    },
    onDestroy(t) {
      for (let e = this.array.length - 1; e >= 0; e--) {
        const i = this.array[e];
        (t && !t.contains(i.el)) ||
          (!t && i.el.closest(".c-bnr-modal")) ||
          (i.video.remove(), this.array.splice(e, 1));
      }
    },
  }),
    (window.styleModal = {
      isopen: !1,
      onInit(t) {
        ((this.local = t || document.querySelector(".c-lc")),
          (this.open = this.local.querySelector(".js-bnr-open")),
          (this.close = document.querySelectorAll(
            ".c-bnr-modal .js-bnr-close",
          )),
          (this.modal = document.querySelector(".c-bnr-modal")),
          (this.videoState = document.querySelector(
            ".c-bnr-modal .js-video-state",
          )),
          (this.modalVideo = null),
          (this.onMouseMove = null),
          (this.onToggleClick = null),
          (this.onVideoPlaying = null),
          (this.onVideoPause = null),
          (this.onVisibilityChange = null),
          (this.mouseTimer = null),
          (this.onOpenClick = (t) => {
            (t.preventDefault(), this.onOpen());
          }),
          (this.onCloseClick = (t) => {
            (t.preventDefault(), this.onClose());
          }),
          this.open && this.open.addEventListener("click", this.onOpenClick),
          this.close.forEach((t) => {
            t.addEventListener("click", this.onCloseClick);
          }),
          (this.onMouseMove = () => {
            ($html.classList.add("is-mouse-moved"),
              clearTimeout(this.mouseTimer),
              (this.mouseTimer = setTimeout(() => {
                $html.classList.remove("is-mouse-moved");
              }, 2e3)));
          }),
          this.open && window.addEventListener("mousemove", this.onMouseMove),
          styleAppendVideo.onInit(t),
          (this.modalVideo = document.querySelector(
            ".c-bnr-modal .js-toggle-video",
          )),
          (this.onToggleClick = (t) => {
            this.modalVideo.paused
              ? this.modalVideo.play()
              : this.modalVideo.pause();
          }),
          this.modalVideo &&
            this.modalVideo.addEventListener("click", this.onToggleClick),
          this.modalVideo &&
            ((this.onVideoPlaying = () => {
              this.videoState && this.videoState.classList.add("is-playing");
            }),
            (this.onVideoPause = () => {
              this.videoState && this.videoState.classList.remove("is-playing");
            }),
            this.modalVideo.addEventListener("playing", this.onVideoPlaying),
            this.modalVideo.addEventListener("pause", this.onVideoPause)),
          (this.onVisibilityChange = () => {
            this.isopen &&
              this.modalVideo &&
              (document.hidden
                ? this.modalVideo.pause()
                : this.modalVideo.play());
          }),
          document.addEventListener(
            "visibilitychange",
            this.onVisibilityChange,
          ));
      },
      onVideoStateUpdate() {
        this.isopen &&
          this.videoState &&
          MOUSE.body &&
          ((this.videoState.style.left = MOUSE.body.array[2].delta.x + "px"),
          (this.videoState.style.top = MOUSE.body.array[2].delta.y + "px"));
      },
      raf() {
        this.onVideoStateUpdate();
      },
      onOpen() {
        ((this.isopen = !0),
          $html.classList.add("is-open-bnr"),
          this.modalVideo && this.modalVideo.play(),
          this.onVideoStateUpdate());
      },
      onClose() {
        ((this.isopen = !1),
          $html.classList.remove("is-open-bnr"),
          this.modalVideo && this.modalVideo.pause());
      },
      onDestroy() {
        ((this.isopen = !1),
          $html.classList.remove("is-open-bnr"),
          $html.classList.remove("is-mouse-moved"),
          clearTimeout(this.mouseTimer),
          (this.mouseTimer = null),
          this.onMouseMove &&
            (window.removeEventListener("mousemove", this.onMouseMove),
            (this.onMouseMove = null)),
          this.modalVideo &&
            this.onToggleClick &&
            (this.modalVideo.removeEventListener("click", this.onToggleClick),
            (this.onToggleClick = null)),
          this.modalVideo &&
            (this.onVideoPlaying &&
              (this.modalVideo.removeEventListener(
                "playing",
                this.onVideoPlaying,
              ),
              (this.onVideoPlaying = null)),
            this.onVideoPause &&
              (this.modalVideo.removeEventListener("pause", this.onVideoPause),
              (this.onVideoPause = null))),
          this.onVisibilityChange &&
            (document.removeEventListener(
              "visibilitychange",
              this.onVisibilityChange,
            ),
            (this.onVisibilityChange = null)),
          this.open && this.open.removeEventListener("click", this.onOpenClick),
          this.close.forEach((t) => {
            t.removeEventListener("click", this.onCloseClick);
          }),
          styleAppendVideo.onDestroy(this.local),
          (this.modalVideo = null),
          (this.videoState = null));
      },
    }));
}
