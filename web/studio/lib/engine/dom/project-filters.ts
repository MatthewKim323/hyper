/* eslint-disable @typescript-eslint/no-explicit-any */
// Workspace section pills retain the scene transition hooks and mobile dropdown.
import gsap from "gsap";
import { store as storeRaw } from "../core/store";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store: any = storeRaw;
import { E } from "../core/event-bus";
import { ensureProjects } from "../scenes/project-menu/projects-data";

const $ = (sel: string, ctx: ParentNode = document) => ctx.querySelector(sel) as HTMLElement;
const $$ = (sel: string, ctx: ParentNode = document) => Array.from(ctx.querySelectorAll(sel)) as HTMLElement[];

type SectionKey = "overview" | "cases" | "evidence" | "activity" | "review";

export class ProjectFilters {
  static get selector() {
    return ".js-project-filters";
  }

  isAnimating = false;
  toggleOpen = false;
  dom: {
    filterBtn: HTMLElement[];
    filter: HTMLElement;
    toggle: HTMLElement;
    filterBg: HTMLElement;
    filterList: HTMLElement;
    overlay: HTMLElement;
    chevron: HTMLElement[];
  };
  items: Record<SectionKey, string[]>;
  hasProjects = false;
  originalHeight = 0;
  expandedHeight = 0;
  tl!: gsap.core.Timeline;

  handleFilterClick = (e: Event) => {
    if (this.hasProjects && store.ProjectMenu?.animatingFilter) return;
    const target = e.currentTarget as HTMLElement;
    if (target.classList.contains("is-active")) {
      if (this.toggleOpen) {
        this.closeFilterDropdown();
        this.dom.toggle.focus();
      }
      return;
    }
    this.dom.filterBtn.forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-pressed", "false");
    });
    target.classList.add("is-active");
    target.setAttribute("aria-pressed", "true");
    this.dom.toggle.setAttribute("aria-label", `Workspace sections, selected: ${target.dataset.label}`);
    if (store.window.w < 768) {
      this.closeFilterDropdown();
      this.dom.toggle.focus();
    }
    const t = target.dataset.filter as SectionKey;
    if (this.hasProjects) E.emit("ProjectFilters:change", this.items[t]);
  };

  handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !this.toggleOpen) return;
    this.closeFilterDropdown();
    this.dom.toggle.focus();
  };

  onResize = () => {
    if (this.toggleOpen) store.ProjectMenu.allowControl = true;
    this.reset();
    this.toggleOpen = false;
  };

  manageDropdownState = () => {
    this.isAnimating || (this.toggleOpen ? this.closeFilterDropdown() : this.openFilterDropdown());
  };

  constructor(_el?: unknown) {
    this.hasProjects = ensureProjects().length > 0;
    this.dom = {
      filterBtn: $$(".js-project-filters\\:filterBtn"),
      filter: $(".js-project-filters\\:filter"),
      toggle: $(".js-project-filters\\:toggle"),
      filterBg: $(".js-project-filters\\:filterBg"),
      filterList: $(".js-project-filters\\:filterList"),
      overlay: $(".js-project-filters\\:overlay"),
      chevron: $$(".js-project-filters\\:chevron"),
    };
    // These sections only select a shell state until workspace views are connected.
    this.items = { overview: [], cases: [], evidence: [], activity: [], review: [] };
    E.on("click", this.dom.filterBtn, this.handleFilterClick);
    E.on("click", this.dom.toggle, this.manageDropdownState);
    E.on("click", this.dom.overlay, this.manageDropdownState);
    E.on("keydown", this.dom.filter, this.handleKeyDown);
    E.on(store.events.RESIZE, this.onResize);
    this.setInitialStyles();
    this.buildDropdownTL();
  }

  setInitialStyles() {
    this.originalHeight = this.dom.filter.offsetHeight;
    this.expandedHeight = this.originalHeight + this.dom.filterList.offsetHeight;
    store.window.w < 768 && gsap.set(this.dom.filterList, { display: "none", autoAlpha: 0 });
    gsap.set(this.dom.overlay, { display: "none", autoAlpha: 0 });
    this.dom.toggle.setAttribute("aria-expanded", "false");
  }

  buildDropdownTL() {
    this.tl = gsap.timeline({
      defaults: { ease: "expo.inOut", duration: 0.8 },
      paused: true,
      onStart: () => {
        this.isAnimating = true;
      },
      onComplete: () => {
        this.isAnimating = false;
      },
      onReverseComplete: () => {
        this.isAnimating = false;
      },
    });
    store.window.w < 768 &&
      this.tl
        .set(this.dom.overlay, { display: "block", pointerEvents: "auto" }, 0)
        .set(this.dom.filterList, { display: "flex" }, 0)
        .to(this.dom.filterBg, { height: this.expandedHeight, width: "15.8125rem" })
        .to(this.dom.overlay, { autoAlpha: 1 }, "<")
        .to(this.dom.filterList, { autoAlpha: 1 }, 0.2)
        .fromTo(this.dom.filterBtn, { autoAlpha: 0 }, { autoAlpha: 1, stagger: 0.05, duration: 0.4, ease: "linear" }, 0)
        .set(this.dom.chevron, { rotate: 180 }, 0.4);
  }

  openFilterDropdown() {
    this.tl.restart();
    this.toggleOpen = true;
    this.dom.toggle.setAttribute("aria-expanded", "true");
    store.ProjectMenu.allowControl = false;
  }

  closeFilterDropdown() {
    this.tl.reverse();
    this.toggleOpen = false;
    this.dom.toggle.setAttribute("aria-expanded", "false");
    store.ProjectMenu.allowControl = true;
  }

  reset() {
    gsap.set([this.dom.filterList, ...this.dom.filterBtn, this.dom.filterBg, ...this.dom.chevron], { clearProps: "all" });
    this.tl.kill();
    this.isAnimating = false;
    this.setInitialStyles();
    store.window.w < 768 && this.buildDropdownTL();
  }

  destroy() {
    E.off("click", this.dom.filterBtn, this.handleFilterClick);
    E.off("click", this.dom.toggle, this.manageDropdownState);
    E.off("click", this.dom.overlay, this.manageDropdownState);
    E.off("keydown", this.dom.filter, this.handleKeyDown);
    E.off(store.events.RESIZE, this.onResize);
    this.tl.kill();
  }
}
