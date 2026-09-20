import { describe, expect, test } from "bun:test";
import { ZoomGesture } from "./zoom";

type Pose = "open" | "fist" | "point";
/** Runs poses at 30 fps and returns every zoom that fired, with its time. */
function run(gesture: ZoomGesture, script: [Pose, number][], start = 0) {
  const fired: [string, number][] = [];
  let t = start;
  for (const [pose, ms] of script) {
    for (const end = t + ms; t < end; t += 33) {
      const result = gesture.update(pose === "open", pose === "fist", t);
      if (result) fired.push([result, t]);
    }
  }
  return { fired, t };
}

describe("zoom gesture", () => {
  test("closing an open hand zooms in, once", () => {
    const { fired } = run(new ZoomGesture(), [["open", 400], ["point", 100], ["fist", 1500]]);
    expect(fired.map(f => f[0])).toEqual(["in"]);
  });

  test("a fist with no open hand before it is only a hold", () => {
    const { fired } = run(new ZoomGesture(), [["point", 1500], ["fist", 1500]]);
    expect(fired).toEqual([]);
  });

  test("an open hand with no fist before it does nothing", () => {
    const { fired } = run(new ZoomGesture(), [["point", 1000], ["open", 1500]]);
    expect(fired).toEqual([]);
  });

  test("relaxing the hand right after a grab does not undo it", () => {
    const { fired } = run(new ZoomGesture(), [["open", 400], ["fist", 500], ["open", 800]]);
    expect(fired.map(f => f[0])).toEqual(["in"]);
  });

  test("opening a held fist zooms out", () => {
    const { fired } = run(new ZoomGesture(), [["open", 400], ["fist", 1600], ["open", 500]]);
    expect(fired.map(f => f[0])).toEqual(["in", "out"]);
  });

  test("fist to pointing is not a zoom out", () => {
    const { fired } = run(new ZoomGesture(), [["point", 1500], ["fist", 1600], ["point", 1200], ["open", 600]]);
    expect(fired).toEqual([]);
  });

  test("a one frame misread of a fist is ignored", () => {
    const { fired } = run(new ZoomGesture(), [["open", 400], ["fist", 33], ["open", 600]]);
    expect(fired).toEqual([]);
  });

  test("in and out can alternate", () => {
    const { fired } = run(new ZoomGesture(), [["open", 400], ["fist", 1500], ["open", 600], ["fist", 1500], ["open", 600]]);
    expect(fired.map(f => f[0])).toEqual(["in", "out", "in", "out"]);
  });
});
