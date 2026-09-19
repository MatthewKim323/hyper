/* eslint-disable @typescript-eslint/no-explicit-any */
// ObserverRegistry wraps IntersectionObserver and forwards observe/unobserve/disconnect.
// Creating the browser observer lazily keeps this module import-safe on the server.
// Instance: store.Dom2WebglObserver = new ObserverRegistry({ rootMargin: "0% 0% 0% 0%" }, "dom2webgl", true)
// Consumers push `{ el, enter?, leave?, params?, ... }` into `els` and call `observe(el)`.
import E from "./event-bus";

export interface ObservedEntry {
  el: Element;
  bcr?: DOMRectReadOnly;
  enter?: (el: Element, params: any) => void;
  leave?: (el: Element, params: any) => void;
  params?: any;
  [key: string]: any;
}

export class ObserverRegistry {
  eventName?: string;
  fireFirstObservation?: boolean;
  firstObservationFired = false;
  els: ObservedEntry[] = [];
  visibleEls: (ObservedEntry | false)[] = [];
  observer: IntersectionObserver;

  constructor(options: IntersectionObserverInit = {}, eventName?: string, fireFirstObservation?: boolean) {
    this.observer = new IntersectionObserver((entries, obs) => this.handler(entries, obs), options);
    this.eventName = eventName;
    this.fireFirstObservation = fireFirstObservation;
  }

  handler = (entries: IntersectionObserverEntry[], _observer?: IntersectionObserver) => {
    for (let t = 0; t < entries.length; t++)
      for (let i = 0; i < this.els.length; i++)
        if (this.els[i].el === entries[t].target) {
          this.els[i].bcr = entries[t].boundingClientRect;
          if (this.eventName) E.emit(this.eventName, this.els[i]);
          if (entries[t].isIntersecting) {
            if (this.els[i].enter) this.els[i].enter!(this.els[i].el, this.els[i].params || null);
            this.visibleEls[i] = this.els[i];
          } else {
            if (this.els[i].leave) this.els[i].leave!(this.els[i].el, this.els[i].params || null);
            this.visibleEls[i] = false;
          }
        }
    if (this.fireFirstObservation) {
      this.firstObservationFired = true;
      E.emit("firstObservation", this.els);
    }
  };

  reset = () => {
    this.disconnect();
    this.els = [];
    this.visibleEls = [];
    this.firstObservationFired = false;
  };

  observe(el: Element) {
    this.observer.observe(el);
  }

  unobserve(el: Element) {
    this.observer.unobserve(el);
  }

  disconnect() {
    this.observer.disconnect();
  }

  takeRecords() {
    return this.observer.takeRecords();
  }
}

export default ObserverRegistry;
