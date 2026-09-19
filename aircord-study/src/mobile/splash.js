// Recovered responsive implementation. See PROVENANCE.md.
export default function initialize() {
  ((window.$progress_bar = document.querySelector(".c-pgs-b")),
    (window.SPLASH = {
      skip: !1,
      isLoaded: !1,
      isComplete: !1,
      ratio: { delay: 1, duration: 1 },
      params: {
        progress: 0,
        ptBarScaleX: 0,
        ptBarScaleZ: 0.125,
        ptCameraAngle: 0,
        ptIconScale: 0,
        ptNoiseAlpha: 0,
        ptNoisePower: 0,
        ptMouseTrailsSize: 0,
      },
      onInit() {
        (DETECT.reduced && ((this.ratio.delay = 0), (this.ratio.duration = 0)),
          onLoaded(),
          onResize(),
          "single" === PAGE_TRANSITION.current.name &&
            (this.params.ptCameraAngle = 1));
        (gsap.to(this.params, {
          duration: 2,
          ease: "power4.inOut",
          ptBarScaleX: 1,
        }),
          this.skip
            ? this.onSplash()
            : setTimeout(() => {
                this.onSplash();
              }, 2500),
          PAGE_TRANSITION.onPreFetch(),
          ARCHIVES && ARCHIVES.onPreLoadTextures(),
          $html.classList.remove("is-l-a"),
          $html.classList.add("is-l-s"));
      },
      tl: { sceneTo: null },
      onSplash() {
        ((this.isLoaded = !0),
          this.skip && ((this.ratio.delay = 0), (this.ratio.duration = 0)),
          $html.classList.remove("is-l-b"),
          $html.classList.add("is-l-c"),
          setTimeout(() => {
            ($html.classList.add("is-l-e"), $html.classList.remove("is-l-c"));
          }, 1200 * this.ratio.delay),
          setTimeout(() => {
            $html.classList.add("is-l-d");
          }, 1800 * this.ratio.delay));
        let t = CustomEase.create(
            "custom",
            "M0,0 C0.082,0 0.143,0.014 0.222,0.09 0.298,0.164 0.356,0.356 0.398,0.504 0.447,0.68 0.49,0.816 0.55,0.882 0.622,0.961 0.734,1 1,1 ",
          ),
          e = 4,
          i = 0;
        (gsap.to(this.params, {
          duration: e * this.ratio.duration,
          delay: i * this.ratio.delay,
          ease: t,
          ptIconScale: 1,
          onComplete: () => {
            this.onComplete();
          },
        }),
          gsap.to(this.params, {
            duration: e * this.ratio.duration,
            delay: i * this.ratio.delay,
            ease: t,
            ptMouseTrailsSize: 1,
          }),
          gsap.to(this.params, {
            duration: e * this.ratio.duration,
            delay: i * this.ratio.delay,
            ease: t,
            ptCameraAngle: 1,
          }),
          (this.tl.sceneTo = gsap.to(COLOR.table.scene.three, {
            duration: e * this.ratio.duration,
            delay: i * this.ratio.delay,
            ease: t,
            r: COLOR.table.sceneTo.three.r,
            g: COLOR.table.sceneTo.three.g,
            b: COLOR.table.sceneTo.three.b,
          })),
          gsap.to(this.params, {
            duration: e * this.ratio.duration,
            delay: i * this.ratio.delay,
            ease: t,
            ptNoisePower: 1,
          }),
          gsap.to(this.params, {
            duration: e * this.ratio.duration,
            delay: i * this.ratio.delay,
            ease: t,
            ptNoiseAlpha: 1,
          }),
          (e = 4),
          (i = 2),
          gsap.to(this.params, {
            duration: e * this.ratio.duration,
            delay: i * this.ratio.delay,
            ease: t,
            ptBarScaleZ: 1,
          }));
      },
      onComplete() {
        this.isComplete = !0;
      },
      raf() {},
    }));
}
