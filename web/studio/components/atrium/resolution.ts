/** Keep fine geometry legible while adapting to the available rendering budget. */
export function atriumResolution(width: number, height: number, deviceRatio: number, coarse: boolean, quality: number) {
  const area = Math.max(1, width) * Math.max(1, height);
  const nativeRatio = Math.max(1, deviceRatio || 1);
  const ceiling = Math.min(nativeRatio, coarse ? 1.25 : 1.5, Math.sqrt(2_600_000 / area));
  // The pixel budget still wins on very large displays. On ordinary screens,
  // retain at least one sample per CSS pixel, and 1.25 on Retina desktops.
  const floor = Math.min(ceiling, coarse ? 1 : 1.25);
  const minimumQuality = floor / ceiling;
  return {
    pixelRatio: ceiling * Math.max(minimumQuality, Math.min(1, quality)),
    minimumQuality,
  };
}
