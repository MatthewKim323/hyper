import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import manifest from "../../public/assets/hyper-atrium/scene.json";
import reference from "../../assets/blender/hyper-atrium/composition-verification.json";
import { DEFAULT_STATIONS, parseAtriumConfiguration } from "./configuration";
import { layoutAtriumStations } from "./layout";

describe("onboarding station configuration", () => {
  test("keeps the five reference positions and exposes Benchmarks through a sixth crystal", () => {
    const layout = layoutAtriumStations(DEFAULT_STATIONS);
    assert.equal(layout.length, 6);
    const aspect = 1672 / 941;
    const camera = new PerspectiveCamera(2 * Math.atan(manifest.camera.sensorWidth / aspect / (2 * manifest.camera.lens)) * 180 / Math.PI, aspect, .1, 250);
    const convert = ([x,y,z]: number[]) => new Vector3(x,z,-y);
    camera.position.copy(convert(manifest.camera.position));
    camera.lookAt(convert(manifest.camera.target));
    camera.updateMatrixWorld();
    for (const placement of layout.slice(0,5)) {
      const template = manifest.templates.find(entry => entry.id === placement.station.template)!;
      const radius = template.width / 2;
      const height = template.height - .48;
      const points = [new Vector3(placement.x-radius,.48,-placement.y+.095),new Vector3(placement.x+radius,.48,-placement.y+.095)];
      for (let step=0; step<=160; step++) {
        const angle=step/160*Math.PI;
        points.push(new Vector3(placement.x+radius*Math.cos(angle),.48+height-radius+radius*Math.sin(angle),-placement.y+.095));
      }
      points.forEach(point => point.project(camera));
      const actual=[Math.min(...points.map(p=>(p.x+1)*836)),Math.min(...points.map(p=>(1-p.y)*470.5)),Math.max(...points.map(p=>(p.x+1)*836)),Math.max(...points.map(p=>(1-p.y)*470.5))];
      const target=reference.stations.find(entry=>entry.station===placement.station.id)!.targetPixels;
      assert.ok(actual.every((value,index)=>Math.abs(value-target[index])<8), `${placement.station.id} no longer matches the measured reference aperture`);
    }
    assert.equal(layout[5].station.section, "benchmarks");
    assert.equal(layout[5].x, -layout[3].x);
    assert.equal(layout[5].y, layout[3].y);
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
