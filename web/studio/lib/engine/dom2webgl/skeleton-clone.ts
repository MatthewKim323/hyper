/* eslint-disable @typescript-eslint/no-explicit-any */
// SkeletonUtils.clone equivalent: clones a GLTF scene and rebinds skinned meshes.
import { Skeleton } from "three";

export function cloneGltf(e: any): { animations: any[]; scene: any } {
  const t = { animations: e.animations, scene: e.scene.clone(true) };
  const i: Record<string, any> = {};
  e.scene.traverse((m: any) => {
    if (m.isSkinnedMesh) i[m.name] = m;
  });
  const bones: Record<string, any> = {};
  const skinned: Record<string, any> = {};
  t.scene.traverse((m: any) => {
    if (m.isBone) bones[m.name] = m;
    if (m.isSkinnedMesh) skinned[m.name] = m;
  });
  for (const k in i) {
    const sk = i[k].skeleton;
    const r = skinned[k];
    const a: any[] = [];
    for (let b = 0; b < sk.bones.length; ++b) a.push(bones[sk.bones[b].name]);
    r.bind(new Skeleton(a, sk.boneInverses), r.matrixWorld);
  }
  return t;
}

export default cloneGltf;
