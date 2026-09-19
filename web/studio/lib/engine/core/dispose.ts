/* eslint-disable @typescript-eslint/no-explicit-any */
// ResourceTracker + disposeDeep.
import { Material, Object3D, Texture } from "three";
import { CSS3DObject } from "./css3d";

export class ResourceTracker {
  resources = new Set<any>();

  track = <T>(resource: T): T => {
    const e: any = resource;
    if (!e || this.resources.has(e)) return resource;
    if (Array.isArray(e)) {
      e.forEach((r) => this.track(r));
      return resource;
    }
    if (e.dispose || e instanceof Object3D || e instanceof CSS3DObject) this.resources.add(e);
    if (e instanceof Object3D) {
      this.track((e as any).geometry);
      this.track((e as any).material);
      this.track(e.children);
    } else if (e instanceof Material) {
      for (const v of Object.values(e)) if (v instanceof Texture) this.track(v);
      const uniforms = (e as any).uniforms;
      if (uniforms)
        for (const u of Object.values<any>(uniforms))
          if (u) {
            const val = u.value;
            if (val instanceof Texture || Array.isArray(val)) this.track(val);
          }
    }
    return resource;
  };

  untrack(resource: any): any {
    const e = resource;
    if (!e) return e;
    if (Array.isArray(e)) {
      e.forEach((r) => this.untrack(r));
      return e;
    }
    if (e instanceof Object3D) {
      this.untrack((e as any).geometry);
      this.untrack((e as any).material);
      this.untrack(e.children);
    } else if (e instanceof Material) {
      for (const v of Object.values(e)) if (v instanceof Texture) this.untrack(v);
      const uniforms = (e as any).uniforms;
      if (uniforms)
        for (const u of Object.values<any>(uniforms))
          if (u) {
            const val = u.value;
            if (val instanceof Texture || Array.isArray(val)) this.untrack(val);
          }
    }
    if (this.resources.has(e)) this.resources.delete(e);
  }

  dispose() {
    for (const e of this.resources) {
      if ((e instanceof Object3D || e instanceof CSS3DObject) && e.parent) e.parent.remove(e);
      if (e.dispose) e.dispose();
    }
    this.resources.clear();
  }
}

export function disposeDeep(resource: any): any {
  const e = resource;
  if (!e) return;
  if (Array.isArray(e)) {
    e.forEach((r) => disposeDeep(r));
    return e;
  }
  if (e instanceof Object3D) {
    disposeDeep((e as any).geometry);
    disposeDeep((e as any).material);
    disposeDeep(e.children);
  } else if (e instanceof Material) {
    for (const v of Object.values(e)) if (v instanceof Texture) disposeDeep(v);
    const uniforms = (e as any).uniforms;
    if (uniforms)
      for (const u of Object.values<any>(uniforms))
        if (u) {
          const val = u.value;
          if (val instanceof Texture || Array.isArray(val)) disposeDeep(val);
        }
  }
  if ((e instanceof Object3D || e instanceof CSS3DObject) && e.parent) e.parent.remove(e);
  if (e.dispose) e.dispose();
}

export default ResourceTracker;
