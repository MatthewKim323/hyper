/* eslint-disable @typescript-eslint/no-explicit-any */
// VideoPlayer: `.js-video` play/pause via cursor indicator (desktop) or inline icons (touch).
import gsap from "gsap";
import { store } from "../core/store";
import { E } from "../core/event-bus";

export class VideoPlayer {
  static get selector() {
    return ".js-video";
  }

  dom: {
    el: HTMLVideoElement;
    soundToggle: Element | null;
    videoProgress: HTMLElement | null;
    play: Element | null;
    pause: Element | null;
  };
  hovered = false;
  playScale = 1;
  pauseScale = 0;
  progress = 0;
  video: HTMLVideoElement;
  playIcon: any;
  pauseIcon: any;

  onTimeUpdate = () => {
    if (!this.video) return;
    this.progress = this.video.currentTime / this.video.duration;
    if (!store.isTouch && this.hovered) E.emit("cursor:progress", this.progress);
    if (this.progress === 0) {
      this.playScale = 1;
      this.pauseScale = 0;
      this.iconToggle();
    }
  };

  constructor(e: HTMLVideoElement) {
    E.bindAll(this);
    const r = e.closest(".js-video-wrapper") as HTMLElement;
    this.dom = {
      el: e,
      soundToggle: r.querySelector(".js-mute"),
      videoProgress: r.querySelector(".js-mobile-video-progress"),
      play: r.querySelector(".js-video-play"),
      pause: r.querySelector(".js-video-pause"),
    };
    store.targetVideo = null;
    if (store.isTouch) {
      this.video = this.dom.el;
      this.playIcon = this.dom.play;
      this.pauseIcon = this.dom.pause;
    } else {
      this.video = store.targetVideo ? store.targetVideo : this.dom.el;
      this.playIcon = ".js-cursor-video-play";
      this.pauseIcon = ".js-cursor-video-pause";
    }
    this.addEvents();
    this.isTouch();
    this.iconToggle();
  }

  addEvents() {
    E.on("click", this.dom.el, this.clickVideo);
    if (this.dom.soundToggle) E.on("click", this.dom.soundToggle, this.toggleSound);
    if (!store.isTouch) {
      E.on("timeupdate", this.dom.el, this.onTimeUpdate);
      E.on("mouseenter", this.dom.el, this.getTargetVideo);
      E.on("mouseleave", this.dom.el, this.removeTargetVideo);
    }
  }

  isTouch() {
    if (!this.dom.videoProgress) return;
    this.dom.videoProgress.style.display = store.isTouch ? "block" : "none";
  }

  getTargetVideo(e: Event) {
    if (this.dom.el !== e.target) return;
    this.hovered = true;
    store.targetVideo = this.dom.el;
    if (store.targetVideo.paused) {
      this.playScale = 1;
      this.pauseScale = 0;
    } else {
      this.playScale = 0;
      this.pauseScale = 1;
    }
    this.video = store.targetVideo ? store.targetVideo : this.dom.el;
    this.playIcon = ".js-cursor-video-play";
    this.pauseIcon = ".js-cursor-video-pause";
    this.iconToggle();
    this.onTimeUpdate();
  }

  removeTargetVideo() {
    this.hovered = false;
    store.targetVideo = null;
    this.playScale = 0;
    this.pauseScale = 0;
    this.iconToggle();
  }

  clickVideo() {
    if (store.isTouch) {
      this.video = this.dom.el;
      this.playIcon = this.dom.play;
      this.pauseIcon = this.dom.pause;
    }
    if (this.video.paused) this.video.play();
    else this.video.pause();
    this.playScale = this.playScale === 1 ? 0 : 1;
    this.pauseScale = this.pauseScale === 1 ? 0 : 1;
    this.iconToggle();
  }

  iconToggle() {
    gsap.to(this.playIcon, { scale: this.playScale, ease: "power1.out", duration: 0.1 });
    gsap.to(this.pauseIcon, { scale: this.pauseScale, ease: "power1.out", duration: 0.1 });
  }

  toggleSound() {
    this.dom.el.muted = !this.dom.el.muted;
  }

  destroy() {
    E.off("mouseenter", this.dom.el, this.getTargetVideo);
    E.off("mouseleave", this.dom.el, this.removeTargetVideo);
    E.off("timeupdate", this.dom.el, this.onTimeUpdate);
    E.off("click", this.dom.el, this.clickVideo);
    if (this.dom.soundToggle) E.off("click", this.dom.soundToggle, this.toggleSound);
    store.targetVideo = null;
  }
}

export default VideoPlayer;
