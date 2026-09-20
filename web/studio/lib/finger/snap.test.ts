import { expect, test } from "bun:test";
import { CAPTURE_PX, RELEASE_PX, TRAVEL_SPEED, chooseTarget, edgeDistance, snapPoint, type SnapRect } from "./snap";

const button: SnapRect = { id: 1, left: 500, top: 400, width: 90, height: 36 };
const neighbour: SnapRect = { id: 2, left: 620, top: 400, width: 90, height: 36 };
const panel: SnapRect = { id: 3, left: 0, top: 0, width: 800, height: 700 };

test("a near miss still lands on the button, and the click goes to its center", () => {
  const state = { id: null };
  const target = chooseTarget(button.left - 40, button.top + 60, [button], state, 0.1)!;
  expect(target.id).toBe(1);
  expect(snapPoint(0, 0, target)).toEqual({ x: 545, y: 418 });
  expect(chooseTarget(button.left - CAPTURE_PX - 30, button.top, [button], { id: null }, 0.1)).toBeNull();
});

test("a captured target survives tremor but lets go of a deliberate move", () => {
  const state = { id: null };
  chooseTarget(545, 418, [button, neighbour], state, 0.1);
  // Hand wobbles toward the neighbour: closer to it than to the current edge, but not by enough to steal.
  expect(chooseTarget(608, 418, [button, neighbour], state, 0.1)!.id).toBe(1);
  // A real move onto the neighbour takes it.
  expect(chooseTarget(660, 418, [button, neighbour], state, 0.1)!.id).toBe(2);
  // Walking far away releases everything.
  expect(chooseTarget(660 + RELEASE_PX + 200, 418, [button, neighbour], state, 0.1)).toBeNull();
  expect(state.id).toBeNull();
});

test("travelling fast never captures, but does not drop what is already held", () => {
  expect(chooseTarget(545, 418, [button], { id: null }, TRAVEL_SPEED + 0.5)).toBeNull();
  const state = { id: 1 };
  expect(chooseTarget(560, 430, [button], state, TRAVEL_SPEED + 0.5)!.id).toBe(1);
});

test("small targets beat the large area behind them, and heading breaks ties", () => {
  expect(chooseTarget(545, 418, [panel, button], { id: null }, 0.1)!.id).toBe(1);
  const between = { x: 605, y: 418 };
  expect(chooseTarget(between.x, between.y, [button, neighbour], { id: null }, 0.2, { x: 1, y: 0 })!.id).toBe(2);
  expect(chooseTarget(between.x, between.y, [button, neighbour], { id: null }, 0.2, { x: -1, y: 0 })!.id).toBe(1);
});

test("large and wide targets keep the hand's position instead of yanking to the middle", () => {
  expect(snapPoint(100, 100, panel)).toEqual({ x: 100, y: 100 });
  expect(snapPoint(-50, 100, panel)).toEqual({ x: 10, y: 100 });
  const field: SnapRect = { id: 4, left: 200, top: 300, width: 600, height: 40 };
  expect(snapPoint(430, 360, field)).toEqual({ x: 430, y: 320 });
  expect(edgeDistance(430, 360, field)).toBe(20);
});
