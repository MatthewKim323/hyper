// Virtual pointer: turns a screen position plus press state into the same DOM events a mouse produces,
// so the engine (window mousemove / mousedown / mouseup), delegated hover states and React handlers all respond.
const chain = (el: Element | null) => {
  const out: Element[] = [];
  for (let n = el; n; n = n.parentElement) out.push(n);
  return out;
};

export class VirtualPointer {
  x = 0;
  y = 0;
  private over: Element | null = null;
  private downTarget: Element | null = null;
  private pressed = false;

  /** Elements the pointer must never hit (its own overlay). */
  constructor(private ignore: (el: Element) => boolean = () => false) {}

  private hit(x: number, y: number): Element | null {
    for (const el of document.elementsFromPoint(x, y)) if (!this.ignore(el)) return el;
    return null;
  }

  private init(extra: MouseEventInit = {}): MouseEventInit {
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: this.x,
      clientY: this.y,
      screenX: this.x + window.screenX,
      screenY: this.y + window.screenY,
      button: 0,
      buttons: this.pressed ? 1 : 0,
      ...extra,
    };
  }

  private fire(target: Element, type: string, extra: MouseEventInit = {}) {
    const pointerType = type.replace("mouse", "pointer");
    if (pointerType !== type)
      target.dispatchEvent(new PointerEvent(pointerType, { ...this.init(extra), pointerId: 1, pointerType: "mouse", isPrimary: true }));
    target.dispatchEvent(new MouseEvent(type, this.init(extra)));
  }

  move(x: number, y: number) {
    const dx = x - this.x;
    const dy = y - this.y;
    this.x = x;
    this.y = y;
    const next = this.hit(x, y);
    if (next !== this.over) {
      const before = chain(this.over);
      const after = chain(next);
      if (this.over) this.fire(this.over, "mouseout", { relatedTarget: next });
      // Enter and leave do not bubble: one event per element joining or leaving the hover chain.
      for (const el of before) if (!after.includes(el)) this.fire(el, "mouseleave", { bubbles: false, relatedTarget: next });
      if (next) this.fire(next, "mouseover", { relatedTarget: this.over });
      for (const el of after.reverse()) if (!before.includes(el)) this.fire(el, "mouseenter", { bubbles: false, relatedTarget: this.over });
      this.over = next;
    }
    this.fire(next ?? document.documentElement, "mousemove", { movementX: dx, movementY: dy });
  }

  down() {
    if (this.pressed) return;
    this.pressed = true;
    this.downTarget = this.hit(this.x, this.y);
    const target = this.downTarget ?? document.documentElement;
    this.fire(target, "mousedown", { detail: 1 });
    const focusable = target.closest<HTMLElement>("input, textarea, select, button, a[href], [tabindex]");
    if (focusable) focusable.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  up() {
    if (!this.pressed) return;
    this.pressed = false;
    const target = this.hit(this.x, this.y) ?? document.documentElement;
    this.fire(target, "mouseup", { detail: 1 });
    // A click lands on the nearest common ancestor of the press and release targets.
    const down = this.downTarget;
    this.downTarget = null;
    if (!down) return;
    const common = chain(down).find((el) => el.contains(target));
    if (common) common.dispatchEvent(new MouseEvent("click", this.init({ detail: 1 })));
  }

  scroll(dx: number, dy: number) {
    const target = this.hit(this.x, this.y) ?? document.documentElement;
    target.dispatchEvent(new WheelEvent("wheel", { ...this.init(), deltaX: dx, deltaY: dy, deltaMode: 0 }));
  }

  /**
   * Release everything, for when the hand leaves the frame or the mode turns off. Leaving the hovered
   * element matters as much as releasing the button: hover states (the site's own cursor hides itself
   * over buttons) would otherwise stay stuck with nothing left to undo them.
   */
  cancel() {
    if (this.pressed) {
      this.pressed = false;
      this.downTarget = null;
      this.fire(document.documentElement, "mouseup");
    }
    if (this.over) {
      const left = this.over;
      this.over = null;
      this.fire(left, "mouseout", { relatedTarget: null });
      for (const el of chain(left)) this.fire(el, "mouseleave", { bubbles: false, relatedTarget: null });
    }
  }

  /** Hand the pointer back to the hardware mouse at its last real position. */
  handBack(x: number, y: number) {
    this.cancel();
    this.move(x, y);
    this.over = null;
  }
}
