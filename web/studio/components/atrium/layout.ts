import type { AtriumStation } from "./configuration";

export type StationPlacement = { station: AtriumStation; x: number; y: number; scale: number };

/** Blender XY ground coordinates. The central pool and hero remain unobstructed. */
export function layoutAtriumStations(stations: readonly AtriumStation[]): StationPlacement[] {
  if (stations.length === 5 || stations.length === 6) {
    const original = [[-8, -2], [-4.7, 2.5], [4.7, 2.5], [6.7, -0.1], [8.1, -2], [-6.7, -0.1]];
    return stations.map((station, index) => ({ station, x: original[index][0], y: original[index][1], scale: 1 }));
  }
  const leftCount = Math.ceil(stations.length / 2);
  const rightCount = stations.length - leftCount;
  const scale = Math.min(1, 6 / stations.length);
  return stations.map((station, index) => {
    const left = index < leftCount;
    const sideCount = left ? leftCount : rightCount;
    const sideIndex = left ? index : index - leftCount;
    const t = sideCount === 1 ? 0.5 : sideIndex / (sideCount - 1);
    const angle = t * 1.25;
    return {
      station,
      x: (left ? -1 : 1) * (4.5 + 4.4 * Math.sin(angle)),
      y: 3.2 - 5.8 * (1 - Math.cos(angle)) / (1 - Math.cos(1.25)),
      scale,
    };
  });
}
