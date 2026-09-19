/* eslint-disable @typescript-eslint/no-explicit-any */
// ContentToggle: contact "New Business / General" sections.
import gsap from "gsap";
import { E } from "../core/event-bus";
import { splitText } from "./split-text";

export class ContentToggle {
  dom?: { el: HTMLElement; buttons: NodeListOf<HTMLElement>; section: NodeListOf<HTMLElement> };
  activeButton: any = false;
  sections: HTMLElement[] = [];
  sectionTl: gsap.core.Timeline[] = [];
  splitContent: any;

  constructor() {
    E.bindAll(this);
    const e = document.querySelector(".js-content-toggle") as HTMLElement | null;
    if (!e) return;
    this.dom = {
      el: e,
      buttons: e.querySelectorAll(".js-content-toggle-btn"),
      section: e.querySelectorAll(".js-content-toggle-section"),
    };
    this.activeButton = false;
    this.sections = [...document.querySelectorAll<HTMLElement>(".js-content-toggle-section")];
    this.sectionTl = [];
    this.splitText();
    this.buildSectionTimelines();
  }

  splitText() {
    this.splitContent = splitText(this.dom!.section, {
      type: "chars, words",
      wordsClass: "js-content-toggle-words",
      charsClass: "js-content-toggle-chars",
    });
    gsap.set(this.splitContent.chars, { yPercent: 120 });
    gsap.set(this.splitContent.words, { overflow: "hidden" });
  }

  updateContent(e?: Event) {
    const t = e ? 400 : 0,
      i = this.activeButton.dom.el.dataset.togglecontent;
    const section = this.dom!.section;
    for (let k = 0; k < section.length; k++) {
      if (i === section[k].dataset.content) {
        const tl = this.sectionTl[this.sections.indexOf(section[k])];
        setTimeout(() => {
          tl.play();
          section[k].style.zIndex = "10";
        }, t);
      } else {
        this.sectionTl[this.sections.indexOf(section[k])].reverse();
        section[k].style.zIndex = "-1";
      }
    }
  }

  buildSectionTimelines() {
    for (let e = 0; e < this.sections.length; e++) {
      const t = this.sections[e].querySelectorAll(".js-content-toggle-words"),
        i = gsap.timeline({ paused: true, defaults: { ease: "expo.inOut", duration: 0.9 } });
      for (let k = 0; k < t.length; k++) {
        const s = t[k].querySelectorAll(".js-content-toggle-chars");
        i.to(s, { yPercent: 0, stagger: { each: 0.014 } }, "<");
      }
      this.sectionTl.push(i);
    }
  }
}

export default ContentToggle;
