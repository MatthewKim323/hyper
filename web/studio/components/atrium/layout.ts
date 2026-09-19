import type { AtriumStation } from "./configuration";

export type StationPlacement = { station: AtriumStation; x: number; y: number; scale: number };

/** Blender XY ground coordinates. The central pool and hero remain unobstructed. */
export function layoutAtriumStations(stations: readonly AtriumStation[]): StationPlacement[] {
  if (stations.length === 5 || stations.length === 6) {
    const original = [[-7.8627, -1.6559], [-8.3371, 18.5455], [7.4286, 20.0948], [7.5748, 3.39], [7.374, -3.648], [-7.5748, 3.39]];
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
