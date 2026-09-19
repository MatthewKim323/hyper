// Contextual route table.
// Patterns use trailing slashes. Next paths have no
// trailing slash, so every pathname goes through `normalizePath` before matching.

export type TransitionName =
  | "default"
  | "toHome"
  | "toContact"
  | "toProjectMenu";

export interface ContextualRoute {
  toPattern: string;
  transition: TransitionName;
}

// Insertion order matters: the first `from` key
// that matches wins, and the lookup stops there even when no `to` pattern matched.
export const CONTEXTUAL_ROUTES: [from: string, to: string, transition: TransitionName][] = [
  ["/", "/contact/", "toContact"],
  ["/", "/projects/", "toProjectMenu"],
  ["/contact/", "/", "toHome"],
  ["/contact/", "/projects/", "toProjectMenu"],
  ["/projects/", "/", "toHome"],
  ["/projects/", "/contact/", "toContact"],
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
  if (p === "/projects") return "archive post-type-archive post-type-archive-project";
  return "error404 dark";
}
