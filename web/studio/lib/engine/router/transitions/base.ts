/* eslint-disable @typescript-eslint/no-explicit-any */
// Highway 2.2.0 `Transition` base (vendor.js module, `l`). `show` runs `in` on the new view
// (wrap.lastElementChild), `hide` runs `out` on the old one (wrap.firstElementChild). When a
// contextual transition is active its (shared) instance is used instead of the renderer's own.

export type Trigger = Element | "script" | "popstate" | null;

export interface TransitionInArgs {
  from: HTMLElement;
  to: HTMLElement;
  trigger: Trigger;
  done: () => void;
}

export interface TransitionOutArgs {
  from: HTMLElement;
  trigger: Trigger;
  done: () => void;
}

export interface ShowHideArgs {
  trigger: Trigger;
  contextual: Transition | false;
}

export class Transition {
  wrap: HTMLElement | null;
  name: string;
  [key: string]: any;

  constructor(wrap: HTMLElement | null, name: string) {
    this.wrap = wrap;
    this.name = name;
  }

  in?(args: TransitionInArgs): void;
  out?(args: TransitionOutArgs): void;

  show({ trigger, contextual }: ShowHideArgs): Promise<void> {
    const wrap = this.wrap as HTMLElement;
    const to = wrap.lastElementChild as HTMLElement;
    const from = wrap.firstElementChild as HTMLElement;
    return new Promise((done) => {
      const t = contextual || this;
      to.setAttribute("data-transition-in", t.name);
      to.removeAttribute("data-transition-out");
      t.in && t.in({ to, from, trigger, done });
    });
  }

  hide({ trigger, contextual }: ShowHideArgs): Promise<void> {
    const wrap = this.wrap as HTMLElement;
    const from = wrap.firstElementChild as HTMLElement;
    return new Promise((done) => {
      const t = contextual || this;
      from.setAttribute("data-transition-out", t.name);
      from.removeAttribute("data-transition-in");
      t.out && t.out({ from, trigger, done });
    });
  }
}

/**
 * Hide the old view immediately and let React remove it on the next route commit.
 * Removing the node directly would conflict with React's own DOM reconciliation.
 */
export function removeView(el: HTMLElement | null | undefined) {
  if (!el) return;
  el.style.display = "none";
  el.setAttribute("data-router-removed", "");
}
