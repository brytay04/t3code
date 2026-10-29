import type { SidebarView } from "@t3tools/contracts/settings";

import type { SidebarProjectSnapshot } from "./sidebarProjectGrouping";

/**
 * Sidebar views: named sets of projects the sidebar filter can switch between,
 * such as Work or a side project. "Everything else" holds the projects no view
 * names, so each project is always reachable from some view.
 */

const VIEW_SCOPE_PREFIX = "view:";
export const OTHER_VIEW_SCOPE_KEY = `${VIEW_SCOPE_PREFIX}*other`;

export function sidebarViewScopeKey(view: Pick<SidebarView, "id">): string {
  return `${VIEW_SCOPE_PREFIX}${view.id}`;
}

export function isSidebarViewScopeKey(key: string | null): key is string {
  return key !== null && key.startsWith(VIEW_SCOPE_PREFIX);
}

export interface SidebarViewScopeItem {
  readonly value: string;
  readonly label: string;
  readonly kind: "view";
}

/** Filter menu entries: each view, then "Everything else" once any view exists. */
export function sidebarViewScopeItems(
  views: ReadonlyArray<SidebarView>,
): readonly SidebarViewScopeItem[] {
  if (views.length === 0) return [];
  return [
    ...views.map((view) => ({
      value: sidebarViewScopeKey(view),
      label: view.name,
      kind: "view" as const,
    })),
    { value: OTHER_VIEW_SCOPE_KEY, label: "Everything else", kind: "view" as const },
  ];
}

/**
 * The `environmentId:projectId` keys a view shows, or null when `key` names no
 * current view (a deleted view reads as all projects).
 */
export function resolveSidebarViewProjectKeys(input: {
  readonly key: string;
  readonly views: ReadonlyArray<SidebarView>;
  readonly groups: ReadonlyArray<Pick<SidebarProjectSnapshot, "projectKey" | "memberProjectRefs">>;
}): ReadonlySet<string> | null {
  const included =
    input.key === OTHER_VIEW_SCOPE_KEY
      ? input.views.length === 0
        ? null
        : (groupKey: string) => !input.views.some((view) => view.projectKeys.includes(groupKey))
      : (() => {
          const view = input.views.find(
            (candidate) => sidebarViewScopeKey(candidate) === input.key,
          );
          return view === undefined
            ? null
            : (groupKey: string) => view.projectKeys.includes(groupKey);
        })();
  if (included === null) return null;
  const keys = new Set<string>();
  for (const group of input.groups) {
    if (!included(group.projectKey)) continue;
    for (const ref of group.memberProjectRefs) keys.add(`${ref.environmentId}:${ref.projectId}`);
  }
  return keys;
}
