/* eslint-disable @typescript-eslint/no-explicit-any */
// `E` event bus.
// Custom events: E.on(name, cb) / E.off(name, cb) / E.emit(name, ...args) / E.once(name, cb).
// DOM events:    E.on("click mouseenter", elOrSelectorOrList, cb, opts) / E.off(...same).
// Delegation:    E.delegate("click", ".selector", cb)  -> e.currentTarget is the matched element.
// bindAll:       E.bindAll(this, ["method", ...])  (all prototype methods when list omitted).

type Handler = (...args: any[]) => void;
type Target = Element | Window | Document | string | NodeListOf<Element> | Element[];

interface DelegateEntry {
  id: number;
  selector: string;
  data: Handler;
}

// Minimal SelectorSet equivalent (the vendor lib indexes by id/class/tag; matching result is identical).
class DelegateSet {
  size = 0;
  private uid = 0;
  private entries: DelegateEntry[] = [];

  add(selector: string, data: Handler) {
    if (typeof selector !== "string") return;
    this.entries.push({ id: this.uid++, selector, data });
    this.size++;
  }

  remove(selector: any, data?: Handler, all = false) {
    if (typeof selector !== "string") return;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.selector === selector && (all || e.data === data)) {
        this.entries.splice(i, 1);
        this.size--;
      }
    }
  }

  matches(el: Element): DelegateEntry[] {
    const out: DelegateEntry[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      try {
        if (el.matches(e.selector)) out.push(e);
      } catch {
        /* invalid selector: ignored like the vendor lib */
      }
    }
    return out.sort((a, b) => a.id - b.id);
  }
}

const delegated: Record<string, DelegateSet> = {};
const bus: Record<string, Handler[]> = {};
const hoverEvents = ["mouseenter", "mouseleave"];

function ensureBus(name: string) {
  if (bus[name] === undefined) bus[name] = [];
}

function resolve(t: any): ArrayLike<Element> {
  return typeof t === "string" ? document.querySelectorAll(t) : t;
}

function setCurrentTarget(ev: Event, el: Element) {
  Object.defineProperty(ev, "currentTarget", {
    configurable: true,
    enumerable: true,
    get: () => el,
  });
}

function delegatedHandler(ev: Event) {
  const set = delegated[ev.type];
  if (!set) return;
  const matched: { delegatedTarget: Element; stack: DelegateEntry[] }[] = [];
  let node = ev.target as Element | null;
  do {
    if (!node || node.nodeType !== 1) break;
    const stack = set.matches(node);
    if (stack.length) matched.push({ delegatedTarget: node, stack });
  } while ((node = node.parentElement));

  if (!matched.length) return;
  for (let i = 0; i < matched.length; i++) {
    for (let j = 0; j < matched[i].stack.length; j++) {
      if (hoverEvents.indexOf(ev.type) !== -1) {
        setCurrentTarget(ev, matched[i].delegatedTarget);
        if (ev.target === matched[i].delegatedTarget) matched[i].stack[j].data(ev);
      } else {
        setCurrentTarget(ev, matched[i].delegatedTarget);
        matched[i].stack[j].data(ev);
      }
    }
  }
}

export class EventBus {
  bindAll(ctx: any, methods?: string[]) {
    if (methods === undefined) methods = Object.getOwnPropertyNames(Object.getPrototypeOf(ctx));
    for (let i = 0; i < methods.length; i++) ctx[methods[i]] = ctx[methods[i]].bind(ctx);
  }

  on(event: string, cb: Handler): void;
  on(event: string, target: Target, cb: Handler, opts?: boolean | AddEventListenerOptions): void;
  on(event: string, target: any, cb?: any, opts?: any) {
    if (typeof target === "function" && cb === undefined) {
      ensureBus(event);
      bus[event].push(target);
      return;
    }
    const names = event.split(" ");
    for (let i = 0; i < names.length; i++) {
      if ((target.nodeType && target.nodeType === 1) || target === window || target === document) {
        target.addEventListener(names[i], cb, opts);
      } else {
        const els = resolve(target);
        for (let k = 0; k < els.length; k++) els[k].addEventListener(names[i], cb, opts);
      }
    }
  }

  once(event: string, cb: Handler): void;
  once(event: string, target: Target, cb: Handler, opts?: boolean | AddEventListenerOptions): void;
  once(event: string, target: any, cb?: any, opts?: any) {
    if (typeof target === "function" && cb === undefined) {
      const wrapped: Handler = (...args) => {
        this.off(event, wrapped);
        target(...args);
      };
      this.on(event, wrapped);
      return;
    }
    const o = typeof opts === "object" ? { ...opts, once: true } : { capture: !!opts, once: true };
    this.on(event, target, cb, o);
  }

  delegate(event: string, selector: string, cb: Handler) {
    const names = event.split(" ");
    for (let i = 0; i < names.length; i++) {
      let set = delegated[names[i]];
      if (set === undefined) {
        set = new DelegateSet();
        delegated[names[i]] = set;
        if (hoverEvents.indexOf(names[i]) !== -1) document.addEventListener(names[i], delegatedHandler, true);
        else document.addEventListener(names[i], delegatedHandler);
      }
      set.add(selector, cb);
    }
  }

  off(event: string, cb?: Handler): void;
  off(event: string, target: Target, cb?: Handler, opts?: boolean | EventListenerOptions): void;
  off(event: string, target?: any, cb?: any, opts?: any) {
    if (target === undefined) {
      bus[event] = [];
      return;
    }
    if (typeof target === "function") {
      ensureBus(event);
      for (let i = 0; i < bus[event].length; i++) if (bus[event][i] === target) bus[event].splice(i, 1);
      return;
    }
    const names = event.split(" ");
    for (let i = 0; i < names.length; i++) {
      const set = delegated[names[i]];
      if (set !== undefined) {
        set.remove(target, cb);
        if (set.size === 0) {
          delete delegated[names[i]];
          document.removeEventListener(names[i], delegatedHandler);
          continue;
        }
      }
      if (target.removeEventListener === undefined) {
        const els = resolve(target);
        for (let k = 0; k < els.length; k++) els[k].removeEventListener(names[i], cb, opts);
      } else {
        target.removeEventListener(names[i], cb, opts);
      }
    }
  }

  emit(event: string, ...args: any[]) {
    const list = bus[event];
    if (list) for (let i = 0; i < list.length; i++) list[i](...args);
  }
}

export const E = new EventBus();
export default E;
