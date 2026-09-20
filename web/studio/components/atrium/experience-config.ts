import type { Vector3 } from "three";
import type { WorkspaceSection } from "./configuration";
import type { FocusSubject } from "./focus";

export const RELIC_EXPERIENCES = {
  cases: { eyebrow: "SOURCE RECORDS", layout: "folio" },
  identity: { eyebrow: "YOUR WORKSPACE", layout: "side" },
  benchmarks: { eyebrow: "FRAMEWORK PERFORMANCE", layout: "landscape" },
  evidence: { eyebrow: "AUDIT & SOURCES", layout: "side" },
  timeline: { eyebrow: "FRAMEWORK HISTORY", layout: "landscape" },
  review: { eyebrow: "YOUR DECISIONS", layout: "side" },
} as const;

export type RelicExperienceSection = keyof typeof RELIC_EXPERIENCES;
export const EXPERIENCE_SECTIONS = new Set<string>(Object.keys(RELIC_EXPERIENCES));
export const isRelicExperience = (section: WorkspaceSection | undefined): section is RelicExperienceSection => !!section && section in RELIC_EXPERIENCES;

/** Keep every popup in the existing room with a stable reading area beside its relic. */
export function relicExperienceFocus(section: RelicExperienceSection, center: Vector3, size: Vector3, compact: boolean, visibleHeight = 1): FocusSubject {
  const landscape = RELIC_EXPERIENCES[section].layout === "landscape";
  const folio = section === "cases";
  return {
    center, height: size.y, width: size.x * (landscape ? 2.25 : 1.5),
    fill: compact ? .14 : landscape ? .18 : .34,
    x: compact || landscape ? 0 : folio ? -.61 : -.52,
    y: (compact ? .74 : landscape ? .56 : .08) * visibleHeight,
    orbit: landscape ? .12 : section === "identity" ? -.04 : .035,
  };
}
