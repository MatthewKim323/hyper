// RAFCollection: sorted callbacks fired on GRAF, ascending index.
import E from "./event-bus";
import { store } from "./store";

export type RafCallback = (time: number) => void;

export class RAFCollection {
  callbacks: { index: number; cb: RafCallback }[] = [];

  fire = (time: number) => {
    let t = 0;
    const len = this.callbacks.length;
    for (; t < len; t++) {
      const c = this.callbacks[t];
      if (c) c.cb(time);
    }
  };

  constructor() {
    E.on(store.events.RAF, this.fire);
  }

  add(cb: RafCallback, index: number) {
    this.callbacks.push({ index, cb });
    this.callbacks.sort(this.sort);
  }

  remove(cb: RafCallback) {
    for (let t = 0; t < this.callbacks.length; t++) if (this.callbacks[t].cb === cb) this.callbacks.splice(t, 1);
  }

  sort(a: { index: number }, b: { index: number }) {
    return a.index > b.index ? 1 : -1;
  }
}
