// Contextual route table.
// Patterns use trailing slashes. Next paths have no
// trailing slash, so every pathname goes through `normalizePath` before matching.

export type TransitionName =
  | "default"
  | "toHome"
  | "toContact"
  | "toProjectMenu";

/** Voice onboarding. Hands off to WORLD_PATH when it completes. */
export const ONBOARDING_PATH = "/onboarding";
/** The 3D atrium. Previously shared the gallery route, which is now removed. */
export const WORLD_PATH = "/world";

export interface ContextualRoute {
  toPattern: string;
  transition: TransitionName;
}

// Insertion order matters: the first `from` key
// that matches wins, and the lookup stops there even when no `to` pattern matched.
// Onboarding and the world both use the project-menu scene, so they share its transition.
// Every ordered pair between the four real routes is listed: an unmatched pair falls back to
// the default transition, which does not drive the WebGL scenes and leaves a blank canvas.
export const CONTEXTUAL_ROUTES: [from: string, to: string, transition: TransitionName][] = [
  ["/", "/contact/", "toContact"],
  ["/", "/onboarding/", "toProjectMenu"],
  ["/", "/world/", "toProjectMenu"],
  ["/contact/", "/", "toHome"],
  ["/contact/", "/onboarding/", "toProjectMenu"],
  ["/contact/", "/world/", "toProjectMenu"],
  ["/onboarding/", "/", "toHome"],
  ["/onboarding/", "/contact/", "toContact"],
  ["/onboarding/", "/world/", "toProjectMenu"],
  ["/world/", "/", "toHome"],
  ["/world/", "/contact/", "toContact"],
  ["/world/", "/onboarding/", "toProjectMenu"],
];

/**
 * The first `from` key matching the current path decides; within it
 * the first matching `to` pattern wins; the lookup stops at that key even when no `to` matched.
 */
export function matchContextualRoute(
  table: Record<string, ContextualRoute[]>,
  fromPath: string,
  toPath: string,
): TransitionName | null {
  const from = normalizePath(fromPath);
  const to = normalizePath(toPath);
  if (from === to) return null;
  for (const key in table) {
    if (from.match(new RegExp(`^${key}$`))) {
      for (let i = 0; i < table[key].length; i++)
        if (to.match(new RegExp(`^${table[key][i].toPattern}$`))) return table[key][i].transition;
      return null;
    }
  }
  return null;
}

/** "/contact" -> "/contact/", "/" stays "/". */
export function normalizePath(pathname: string): string {
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

// Body classes per route. Keep these aligned with
// the pre-paint script in app/layout.tsx so first load and client navigation agree. A view can
// override with `data-body-class` on its <main>.
export function bodyClassFor(pathname: string, view?: Element | null): string {
  const override = view?.getAttribute("data-body-class");
  if (override !== null && override !== undefined) return override;
  if (view?.getAttribute("data-router-view") === "notFound") return "error404 dark";
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return "home page-template-home-contact";
  if (p === "/contact") return "page-template-home-contact";
  // Both run the project-menu scene, so they keep its archive body classes.
  if (p === ONBOARDING_PATH || p === WORLD_PATH) return "archive post-type-archive post-type-archive-project";
  return "error404 dark";
}
