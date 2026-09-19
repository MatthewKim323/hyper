/* eslint-disable @typescript-eslint/no-explicit-any */
// ComponentManager + `$$` / `$` helpers.

export function $$<T extends Element = HTMLElement>(selector: string, parent: ParentNode = document): T[] {
  const list = parent.querySelectorAll(selector);
  return Array.prototype.slice.call(list) as T[];
}

export function $<T extends Element = HTMLElement>(selector: string, parent: ParentNode = document): T | null {
  return parent.querySelector(selector) as T | null;
}

export interface ComponentClass<T = any> {
  new (el: any): T;
  selector: string;
  name: string;
}

export class ComponentManager<T = any> {
  components: T[] = [];
  Component: ComponentClass<T>;
  parentEl: ParentNode;

  constructor(Component: ComponentClass<T>, parentEl?: ParentNode | null) {
    this.Component = Component;
    this.parentEl = parentEl || document.body;
    if (Component.selector === undefined)
      throw new Error(
        `The component "${Component.name}" does not implement the selector property, or it is nto available statically`,
      );
    const els = $$(Component.selector, this.parentEl);
    for (let i = 0; i < els.length; i++) this.components.push(new this.Component(els[i]));
  }

  make(el: Element) {
    this.components.push(new this.Component(el));
  }

  forEach(cb: (c: T) => void) {
    for (let i = 0; i < this.components.length; i++) cb(this.components[i]);
  }

  callAll(method: string, ...args: any[]) {
    for (let i = 0; i < this.components.length; i++) (this.components[i] as any)[method](...args);
  }

  destroy() {
    this.callAll("destroy");
  }
}
