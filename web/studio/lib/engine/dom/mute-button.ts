// MuteButton: `.js-mute`, 5-bar equalizer icon.
import gsap from "gsap";
import { store } from "../core/store";
import { E } from "../core/event-bus";

export class MuteButton {
  static get selector() {
    return ".js-mute";
  }

  dom: {
    el: HTMLElement;
    bg: Element | null;
    icon: NodeListOf<Element>;
    lines: NodeListOf<Element>;
    fill: NodeListOf<Element>;
  };
  scales = [0.4, 0.3, 1, 0.8, 0.6];
  mutedOnLoad = false;
  toggleTL: gsap.core.Timeline | null = null;
  animateLinesTL!: gsap.core.Timeline;
  resetLinesTL!: gsap.core.Timeline;
  muteAnimationTL!: gsap.core.Timeline;
  unmuteAnimationTL!: gsap.core.Timeline;

  onAudioMuteChange = (e: boolean) => {
    if (e) {
      store.audioMuted = true;
      this.unmuteAnimationTL.pause();
      this.muteAnimationTL.restart();
    } else {
      store.audioMuted = false;
      this.muteAnimationTL.pause();
      this.unmuteAnimationTL.restart();
    }
  };

  constructor(e: HTMLElement) {
    E.bindAll(this);
    this.dom = {
      el: e,
      bg: e.querySelector(".js-mute-bg"),
      icon: e.querySelectorAll(".js-mute-icon"),
      lines: e.querySelectorAll(".js-sound-line"),
      fill: e.querySelectorAll(".js-mute-fill"),
    };
    store.audioMuted = false;
    this.build();
  }

  build() {
    this.animateLines();
    this.resetLines();
    this.muteAnimation();
    this.unmuteAnimation();
    if (store.audioMuted) this.mutedOnLoad = true;
    this.resetLinesTL.play();
    this.addEvents();
  }

  addEvents() {
    E.on("mouseenter", this.dom.el, this.onMouseEnter);
    E.on("mouseleave", this.dom.el, this.onMouseLeave);
    E.on("click", this.dom.el, this.handleToggle);
    E.on("AudioMute", this.onAudioMuteChange);
  }

  onMouseEnter() {
    if (store.audioMuted) return;
    this.animateLines();
    this.animateLinesTL.play();
    gsap
      .timeline()
      .to(this.dom.bg, { scale: 1.15, duration: 0.25, ease: "none" })
      .to(this.dom.bg, { scale: 1, duration: 0.25, ease: "none" }, "<0.15");
  }

  onMouseLeave() {
    if (store.audioMuted) return;
    this.animateLinesTL.pause();
    this.resetLinesTL.invalidate().restart();
    this.animateLinesTL.clear();
  }

  handleToggle() {
    this.toggleTL?.kill();
    this.toggleTL = gsap.timeline({ defaults: { ease: "none", duration: 0.1 } });
    if (store.audioMuted)
      this.toggleTL.to([this.dom.fill, this.dom.bg], { scale: 0.9 }).to([this.dom.fill, this.dom.bg], {
        scale: 1.05,
        onComplete: () => {
          this.unmute();
        },
      });
    else {
      this.mute();
      this.toggleTL.to(this.dom.bg, { scale: 0.9 }).to(this.dom.bg, { scale: 1 });
    }
  }

  mute() {
    store.audioMuted = true;
    store.Audio?.muteAll(true);
  }

  unmute() {
    store.audioMuted = false;
    store.Audio?.muteAll(false);
  }

  animateLines() {
    gsap.set(this.dom.lines, { transformOrigin: "50% 100%" });
    this.animateLinesTL = gsap.timeline({ repeat: -1, repeatRefresh: true, yoyo: true, paused: true });
    for (let e = 0; e < this.dom.lines.length; e++)
      this.animateLinesTL.to(
        this.dom.lines[e],
        { scaleY: "random(0.1, 0.95, 0.05)", duration: 0.45, ease: "none" },
        "<",
      );
  }

  resetLines() {
    this.resetLinesTL = gsap.timeline({
      paused: true,
      onComplete: () => {
        if (this.mutedOnLoad) {
          this.muteAnimationTL.play();
          this.mutedOnLoad = false;
        }
      },
    });
    for (let e = 0; e < this.dom.lines.length; e++)
      this.resetLinesTL.to(this.dom.lines[e], { scaleY: this.scales[e], duration: 0.5, ease: "none" }, "<");
  }

  muteAnimation() {
    this.muteAnimationTL = gsap
      .timeline({
        paused: true,
        defaults: { ease: "expo.inOut", duration: 0.3 },
        onStart: () => {
          this.animateLinesTL.pause();
        },
      })
      .to(this.dom.icon, { scaleY: 0.15 })
      .to(this.dom.fill, { scale: 1.05, duration: 0.7 }, "<")
      .to(this.dom.lines, { scaleY: 1, stroke: "#fff" }, "<0.05");
  }

  unmuteAnimation() {
    this.unmuteAnimationTL = gsap.timeline({
      paused: true,
      defaults: { ease: "expo.inOut", duration: 0.5 },
      onComplete: () => {
        this.animateLinesTL.invalidate().restart();
      },
    });
    this.unmuteAnimationTL
      .to(this.dom.fill, { scale: 0 })
      .to(this.dom.lines, { stroke: "#000" }, "<")
      .to(
        this.dom.icon,
        {
          scaleY: 1,
          onStart: () => {
            this.resetLinesTL.invalidate().restart();
          },
        },
        "<",
      );
  }

  destroy() {
    E.off("mouseenter", this.dom.el, this.onMouseEnter);
    E.off("mouseleave", this.dom.el, this.onMouseLeave);
    E.off("click", this.dom.el, this.handleToggle);
    E.off("AudioMute", this.onAudioMuteChange);
  }
}

export default MuteButton;
