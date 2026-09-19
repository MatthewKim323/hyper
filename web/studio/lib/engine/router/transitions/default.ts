// Transition `default`.
import { store } from "../../core/store";
import { Transition, removeView, type TransitionInArgs, type TransitionOutArgs } from "./base";

export class DefaultTransition extends Transition {
  in({ done }: TransitionInArgs) {
    (store.AssetLoader!.loaded as Promise<void>).then(() => {
      store.PageLoader.hide().then(() => {
        done();
      });
    });
  }

  out({ from, done }: TransitionOutArgs) {
    store.Highway.cached = store.Highway.cache.has(store.Highway.location.href);
    store.PageLoader.show().then(() => {
      removeView(from);
      done();
    });
  }
}

export default DefaultTransition;
