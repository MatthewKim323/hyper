/* eslint-disable @typescript-eslint/no-explicit-any */
// Module registry: how non-core engine pieces get constructed by bootEngine() in dependency order.
// A factory returns the instance; boot stores it on `store[key]`.

export const MODULE_ORDER = {
  // constructed before TaskScheduler / Gl
  early: ["PageLoader", "NakedLoader", "ScrollAnimations"],
  // constructed right after Audio
  afterAudio: ["Dom2Webgl"],
  // constructed after CustomEase registration
  scenes: ["HomeContact", "ProjectMenu", "ProjectFilters", "Navigation", "Menu", "Cursor"],
  // constructed last; owns the first view (BaseRenderer.onEnter + onFirstAssetsLoad). Stored as store.Highway.
  router: ["Router"],
} as const;

export type ModuleKey =
  | (typeof MODULE_ORDER.early)[number]
  | (typeof MODULE_ORDER.afterAudio)[number]
  | (typeof MODULE_ORDER.scenes)[number]
  | (typeof MODULE_ORDER.router)[number];

export type ModuleFactory = () => any;

const factories: Partial<Record<ModuleKey, ModuleFactory>> = {};
const bootHooks: (() => void)[] = [];

/** Register a constructor for a store slot. Call before bootEngine() runs (i.e. at import time from modules.ts). */
export function registerModule(key: ModuleKey, factory: ModuleFactory) {
  factories[key] = factory;
}

/** Alias for scenes. */
export const registerScene = registerModule;

export function getFactory(key: ModuleKey): ModuleFactory | undefined {
  return factories[key];
}

export function hasModule(key: ModuleKey) {
  return !!factories[key];
}

/** Run a callback once boot has constructed everything (before the first view enters when no Router is registered). */
export function onBoot(cb: () => void) {
  bootHooks.push(cb);
}

export function runBootHooks() {
  for (const cb of bootHooks) cb();
}
