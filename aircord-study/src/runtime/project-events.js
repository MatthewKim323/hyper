// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  ((PAGE_TRANSITION.anim = {
    ratio: { delay: 1, duration: 1 },
    ptZoomIn: 0,
    ptZoomInSkew: 0,
    ptZoomInProjects: 0,
    ptZoomInScreen: 0,
    ptLogoOpacity: 0,
    ptSingleScale: 0,
    ptSingleToSingleFromFooter: 0,
    ptHoverViewButton: 0,
    ptFadeTitle: 1,
    tl: {
      zoomIn: [],
      zoomOutToHome: [],
      zoomInAbout: [],
      transition: [],
    },
    tlKeys: [],
    ease: { zoom: null },
    once() {
      (DETECT.reduced && ((this.ratio.delay = 0), (this.ratio.duration = 0)),
        (this.ease.zoom = CustomEase.create(
          "custom",
          "M0,0 C0.2,0 0.282,0.455 0.371,0.683 0.468,0.932 0.501,1 1,1 ",
        )),
        Object.keys(this.tl).forEach((t) => {
          this.tlKeys.push(t);
        }));
    },
    onReset() {
      for (let t = 0; t < this.tlKeys.length; t++) {
        const e = this.tlKeys[t];
        (this.tl[e].forEach((t) => {
          (t && t.kill(), (t = null));
        }),
          (this.tl[e] = []));
      }
    },
    onZoomInSkew() {
      let t = gsap.timeline();
      (t.to(this, {
        ptZoomInSkew: 1,
        duration: 1 * this.ratio.duration,
        ease: "power1.inOut",
      }),
        t.to(this, {
          ptZoomInSkew: 0,
          duration: 2 * this.ratio.duration,
          ease: "power2.out",
        }));
    },
    onZoomIn() {
      let t = null;
      (1 != this.ptZoomIn &&
        ((t = gsap.to(this, {
          ptZoomIn: 1,
          duration: 2 * this.ratio.duration,
          ease: this.ease.zoom,
        })),
        this.tl.zoomIn.push(t)),
        1 != this.ptZoomInProjects &&
          ((t = gsap.to(this, {
            delay: 1 * this.ratio.delay,
            ptZoomInProjects: 1,
            duration: 5 * this.ratio.duration,
            ease: "power4.out",
          })),
          this.tl.zoomIn.push(t)),
        1 != this.ptLogoOpacity &&
          ((t = gsap.to(this, {
            ptLogoOpacity: 1,
            duration: 2.5 * this.ratio.duration,
            ease: this.ease.zoom,
          })),
          this.tl.zoomIn.push(t)),
        0 != this.ptHoverViewButton &&
          ((t = gsap.to(this, {
            ptHoverViewButton: 0,
            duration: 2.5 * this.ratio.duration,
            ease: this.ease.zoom,
          })),
          this.tl.zoomIn.push(t)));
    },
    onZoomOutToHome() {
      const t = PAGE_TRANSITION;
      let e = null;
      ((e = gsap.to(this, {
        ptZoomIn: 0,
        duration: 3 * this.ratio.duration,
        ease: "power2.out",
      })),
        this.tl.zoomOutToHome.push(e),
        (e = gsap.to(this, {
          delay: 1 * this.ratio.delay,
          ptZoomInProjects: 0,
          duration: 5 * this.ratio.duration,
          ease: "power2.out",
        })),
        this.tl.zoomOutToHome.push(e),
        (e = gsap.to(this, {
          ptLogoOpacity: 0,
          duration: 0.2 * this.ratio.duration,
          ease: "power2.out",
        })),
        this.tl.zoomOutToHome.push(e));
      for (let i = 0; i < t.pageKeys.length; i++) {
        const n = t.pageKeys[i],
          r = t.page[n];
        switch (n) {
          case "home":
            ((e = gsap.to(r, {
              ptWebGl: 1,
              duration: 2.5 * this.ratio.duration,
              ease: "power2.out",
            })),
              this.tl.zoomOutToHome.push(e));
            break;
          case "archives":
            ((e = gsap.to(r, {
              ptWebGl: 0,
              duration: 0.5 * this.ratio.duration,
              ease: "power1.out",
            })),
              this.tl.zoomOutToHome.push(e));
            break;
          default:
            ((e = gsap.to(r, {
              ptWebGl: 0,
              duration: 2.5 * this.ratio.duration,
              ease: "power2.out",
            })),
              this.tl.zoomOutToHome.push(e));
        }
      }
    },
    onZoomInToArchive() {
      const t = PAGE_TRANSITION;
      let e = null;
      for (let i = 0; i < t.pageKeys.length; i++) {
        const n = t.pageKeys[i],
          r = t.page[n];
        if ("archives" === n)
          ((r.ptWebGl = 0),
            (e = gsap.to(r, {
              ptWebGl: 1,
              delay: 1 * this.ratio.delay,
              duration: 5 * this.ratio.duration,
              ease: "expo.out",
            })),
            this.tl.zoomInAbout.push(e));
        else
          ((e = gsap.to(r, {
            ptWebGl: 0,
            duration: 2.5 * this.ratio.duration,
            ease: "power2.inOut",
          })),
            this.tl.zoomInAbout.push(e));
      }
    },
    onZoomInToAbout() {
      const t = PAGE_TRANSITION;
      let e = null;
      for (let i = 0; i < t.pageKeys.length; i++) {
        const n = t.pageKeys[i],
          r = t.page[n];
        if ("about" === n)
          ((r.ptWebGl = 0),
            (e = gsap.to(r, {
              ptWebGl: 1,
              delay: 1 * this.ratio.delay,
              duration: 5 * this.ratio.duration,
              ease: "expo.out",
            })),
            this.tl.zoomInAbout.push(e));
        else
          ((e = gsap.to(r, {
            ptWebGl: 0,
            duration: 2.5 * this.ratio.duration,
            ease: "power2.inOut",
          })),
            this.tl.zoomInAbout.push(e));
      }
    },
    onSingleToAbout() {
      const t = PAGE_TRANSITION;
      let e = null;
      for (let i = 0; i < t.pageKeys.length; i++) {
        const n = t.pageKeys[i],
          r = t.page[n];
        if ("about" === n)
          ((r.ptWebGl = 0),
            (e = gsap.to(r, {
              ptWebGl: 1,
              delay: 1 * this.ratio.delay,
              duration: 5 * this.ratio.duration,
              ease: "expo.out",
            })),
            this.tl.zoomInAbout.push(e));
        else
          ((e = gsap.to(r, {
            ptWebGl: 0,
            duration: 2.5 * this.ratio.duration,
            ease: "power2.inOut",
          })),
            this.tl.zoomInAbout.push(e));
      }
    },
    onNormal(t) {
      const e = PAGE_TRANSITION;
      let i = null;
      ((i = gsap.to(this, {
        ptSingleScale: 0,
        duration: 3 * this.ratio.duration,
        ease: this.ease.zoom,
      })),
        this.tl.transition.push(i));
      for (let t = 0; t < e.pageKeys.length; t++) {
        const n = e.pageKeys[t],
          r = e.page[n];
        n === e.current.name
          ? "about" === n
            ? ((i = gsap.to(r, {
                ptWebGl: 1,
                duration: 5 * this.ratio.duration,
                ease: "expo.out",
              })),
              this.tl.transition.push(i))
            : "archives" === n
              ? ((i = gsap.to(r, {
                  ptWebGl: 1,
                  duration: 1 * this.ratio.duration,
                  ease: "power1.inOut",
                })),
                this.tl.transition.push(i))
              : ((i = gsap.to(r, {
                  ptWebGl: 1,
                  duration: 4 * this.ratio.duration,
                  ease: "expo.out",
                })),
                this.tl.transition.push(i))
          : "archives" === n
            ? ((i = gsap.to(r, {
                ptWebGl: 0,
                duration: 1 * this.ratio.duration,
                ease: "power1.inOut",
              })),
              this.tl.transition.push(i))
            : ((i = gsap.to(r, {
                ptWebGl: 0,
                duration: 3 * this.ratio.duration,
                ease: "power1.out",
              })),
              this.tl.transition.push(i));
      }
    },
    onPageToSingle() {
      const t = PAGE_TRANSITION;
      let e = null;
      WEBGL.screen.onMouseLeaveRay();
      for (let i = 0; i < t.pageKeys.length; i++) {
        const n = t.pageKeys[i],
          r = t.page[n];
        if ("single" === n)
          ((e = gsap.to(r, {
            ptWebGl: 1,
            duration: 3 * this.ratio.duration,
            ease: this.ease.zoom,
          })),
            this.tl.transition.push(e));
        else
          ((e = gsap.to(r, {
            ptWebGl: 0,
            duration: 3 * this.ratio.duration,
            ease: this.ease.zoom,
          })),
            this.tl.transition.push(e));
      }
    },
    onFadeInTitle() {
      let t = this.ease.zoom;
      gsap.to(this, {
        ptFadeTitle: 1,
        ease: t,
        duration: 1.5 * this.ratio.duration,
      });
    },
    onFadeOutTitle() {
      gsap.to(this, {
        ptFadeTitle: 0,
        ease: "power2.out",
        duration: 0.6 * this.ratio.duration,
      });
    },
    onSingleToSingleFromFooter(t) {
      let e = this.ease.zoom;
      (PAGE_SCROLL_NORMAL.body.scrollTo("bottom", {
        duration: 1.5,
        easing: (t) => getEase(t, "power4_inOut"),
      }),
        (this.ptSingleToSingleFromFooter = 1),
        gsap.to(this, {
          ptSingleToSingleFromFooter: 0,
          ease: e,
          duration: 1.5 * this.ratio.duration,
        }),
        gsap.to(".c-sg-ft-move", {
          y: 0,
          ease: e,
          duration: 1.5 * this.ratio.duration,
          onComplete: () => {
            t();
          },
        }));
    },
    onLeaveFadeOut(t) {
      gsap.to(".c-mn", {
        duration: 0.3 * this.ratio.duration,
        ease: "power2.out",
        opacity: 0,
        onComplete: () => {
          t();
        },
      });
    },
    onSingleToProject() {
      const t = PAGE_TRANSITION;
      let e = null,
        i = this.ease.zoom;
      ((e = gsap.to(this, {
        ptSingleScale: 0,
        duration: 3 * this.ratio.duration,
        ease: i,
      })),
        this.tl.transition.push(e));
      for (let n = 0; n < t.pageKeys.length; n++) {
        const r = t.pageKeys[n],
          s = t.page[r];
        "projects" === r
          ? ((e = gsap.to(s, {
              ptWebGl: 1,
              duration: 3 * this.ratio.duration,
              ease: i,
            })),
            this.tl.transition.push(e))
          : ((e = gsap.to(s, {
              ptWebGl: 0,
              duration: 3 * this.ratio.duration,
              ease: i,
            })),
            this.tl.transition.push(e));
      }
    },
  }),
    PAGE_TRANSITION.once());
}
