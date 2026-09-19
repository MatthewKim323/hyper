import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { DEFAULT_STATIONS, parseAtriumConfiguration } from "./configuration";
import { layoutAtriumStations } from "./layout";

describe("onboarding station configuration", () => {
  test("keeps the five reference positions and exposes Benchmarks through a sixth crystal", () => {
    const layout = layoutAtriumStations(DEFAULT_STATIONS);
    assert.equal(layout.length, 6);
    assert.deepEqual(layout.slice(0, 5).map(({ x, y }) => [x, y]), [[-8, -2], [-4.7, 2.5], [4.7, 2.5], [6.7, -0.1], [8.1, -2]]);
    assert.equal(layout[5].station.section, "benchmarks");
    assert.deepEqual([layout[5].x, layout[5].y], [-6.7, -0.1]);
  });
  test("accepts real station names and preserves their workspace destination", () => {
    assert.deepEqual(parseAtriumConfiguration({ stations: [{ id: "invoices", label: "Invoice Review", template: "accounts-payable", section: "cases" }] }), [{ id: "invoices", label: "Invoice Review", template: "accounts-payable", section: "cases" }]);
  });
  test("rejects invalid counts, duplicate identities, and unknown destinations", () => {
    for (const count of [0, 13, 2.5, "8", NaN]) assert.equal(parseAtriumConfiguration({ count }), null);
    assert.equal(parseAtriumConfiguration({ stations: [DEFAULT_STATIONS[0], DEFAULT_STATIONS[0]] }), null);
    assert.equal(parseAtriumConfiguration({ stations: [{ ...DEFAULT_STATIONS[0], section: "invented" }] }), null);
  });
  test("renders every requested count using valid extra crystal templates", () => {
    for (let count = 1; count <= 12; count++) {
      const stations = parseAtriumConfiguration({ count });
      assert.equal(stations?.length, count);
      const layout = layoutAtriumStations(stations!);
      assert.equal(layout.length, count);
      assert.ok(layout.every(slot => Math.abs(slot.x) >= 4.5 && slot.scale > 0 && slot.scale <= 1));
      assert.equal(new Set(layout.map(slot => `${slot.x}:${slot.y}`)).size, count);
      assert.ok(stations!.slice(5).every(station => station.template.startsWith("crystal-")));
    }
  });
});
