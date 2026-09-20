// Focus rig: the atrium camera either rests at home or flies in on one relic. Opening a workspace is a
// camera move, never a page: the relic settles into the left of the frame and its panel takes the right.
import { PerspectiveCamera, Vector3 } from "three";

export type FocusSubject = { center: Vector3; height: number; width?: number; fill?: number; x?: number; y?: number; orbit?: number };

// Critically damped spring: eases out of rest and into the goal with no overshoot, and a new goal
// mid-flight just bends the path.
const STIFFNESS = 14;
const DAMPING = 2 * Math.sqrt(STIFFNESS);
// Share of the frame height the relic fills once focused.
const FILL = 0.5;
// Where the relic sits horizontally once focused, in NDC of the visible frame (negative is left).
const RELIC_X = -0.46;
const LIFT = 0.12;

export function createFocusRig(camera: PerspectiveCamera, homePosition: Vector3, homeTarget: Vector3) {
  const position = homePosition.clone();
  const target = homeTarget.clone();
  const positionVelocity = new Vector3();
  const targetVelocity = new Vector3();
  const goalPosition = homePosition.clone();
  const goalTarget = homeTarget.clone();
  const scratch = new Vector3();
  let focused = false;
  // 0 at home, 1 settled on the relic. Drives the panel reveal so it lands with the camera.
  let progress = 0;
  let flightLength = 1;

  function aim(subject: FocusSubject | null, visibleShare = 1) {
    focused = !!subject;
    if (!subject) {
      goalPosition.copy(homePosition);
      goalTarget.copy(homeTarget);
    } else {
      const halfV = Math.tan((camera.fov * Math.PI) / 360);
      const halfH = halfV * camera.aspect;
      const distance = Math.max(subject.height / (subject.fill ?? FILL) / (2 * halfV), (subject.width ?? 0) / (2 * halfH * Math.max(.15, visibleShare) * .72));
      // Approach along the line from the relic back to the home camera, flattened so it stays a walk-up, not a dive.
      const back = scratch.copy(homePosition).sub(subject.center);
      back.y *= 0.35;
      back.normalize();
      if (subject.orbit) back.applyAxisAngle(new Vector3(0, 1, 0), subject.orbit);
      goalPosition.copy(subject.center).addScaledVector(back, distance);
      goalPosition.y = subject.center.y + subject.height * LIFT;
      // Look to the right of the relic so it lands left of center. Only the visible share of a
      // wider-than-viewport frame counts.
      const right = new Vector3().crossVectors(new Vector3(0, 1, 0), back).normalize();
      goalTarget.copy(subject.center).addScaledVector(right, -(subject.x ?? RELIC_X) * visibleShare * distance * halfH);
      goalTarget.y -= (subject.y ?? 0) * distance * halfV;
    }
    flightLength = Math.max(position.distanceTo(goalPosition), 1e-3);
  }

  function spring(value: Vector3, velocity: Vector3, goal: Vector3, dt: number) {
    // Semi-implicit Euler in small steps stays stable through frame drops.
    let remaining = Math.min(dt, 0.1);
    while (remaining > 0) {
      const step = Math.min(remaining, 1 / 120);
      scratch.copy(goal).sub(value).multiplyScalar(STIFFNESS).addScaledVector(velocity, -DAMPING);
      velocity.addScaledVector(scratch, step);
      value.addScaledVector(velocity, step);
      remaining -= step;
    }
  }

  return {
    aim,
    get focused() { return focused; },
    get progress() { return progress; },
    /** `sway` is the idle pointer parallax; it fades out as the camera commits to a relic. */
    update(dt: number, sway: { x: number; y: number }, still: boolean) {
      if (still) {
        position.copy(goalPosition);
        target.copy(goalTarget);
        positionVelocity.set(0, 0, 0);
        targetVelocity.set(0, 0, 0);
      } else {
        spring(position, positionVelocity, goalPosition, dt);
        spring(target, targetVelocity, goalTarget, dt);
      }
      const remaining = position.distanceTo(goalPosition) / flightLength;
      const arrived = Math.max(0, Math.min(1, 1 - remaining));
      progress = focused ? arrived : 1 - arrived;
      if (!focused && remaining < 1e-3) progress = 0;
      const calm = still ? 0 : 1 - progress * 0.75;
      camera.position.set(position.x + sway.x * 0.28 * calm, position.y - sway.y * 0.08 * calm, position.z);
      camera.lookAt(target);
      camera.updateMatrixWorld();
    },
  };
}
