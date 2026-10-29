import { describe, expect, it } from "vite-plus/test";

import {
  OTHER_VIEW_SCOPE_KEY,
  resolveSidebarViewProjectKeys,
  sidebarViewScopeItems,
  sidebarViewScopeKey,
} from "./sidebarViews";

const group = (projectKey: string, ...projectIds: string[]) => ({
  projectKey,
  memberProjectRefs: projectIds.map((projectId) => ({ environmentId: "env", projectId })) as never,
});

const groups = [
  group("work-a", "p1", "p2"),
  group("work-b", "p3"),
  group("fractal", "p4"),
  group("misc", "p5"),
];
const views = [
  { id: "work", name: "Work", projectKeys: ["work-a", "work-b"] },
  { id: "fractal", name: "Fractal", projectKeys: ["fractal"] },
];

describe("sidebar views", () => {
  it("shows a view's member projects", () => {
    expect(
      resolveSidebarViewProjectKeys({ key: sidebarViewScopeKey(views[0]!), views, groups }),
    ).toEqual(new Set(["env:p1", "env:p2", "env:p3"]));
  });

  it("puts projects no view names under everything else", () => {
    expect(resolveSidebarViewProjectKeys({ key: OTHER_VIEW_SCOPE_KEY, views, groups })).toEqual(
      new Set(["env:p5"]),
    );
  });

  it("reads a deleted view as no filter", () => {
    expect(resolveSidebarViewProjectKeys({ key: "view:gone", views, groups })).toBeNull();
    expect(
      resolveSidebarViewProjectKeys({ key: OTHER_VIEW_SCOPE_KEY, views: [], groups }),
    ).toBeNull();
  });

  it("lists everything else only once a view exists", () => {
    expect(sidebarViewScopeItems([])).toEqual([]);
    expect(sidebarViewScopeItems(views).map((item) => item.label)).toEqual([
      "Work",
      "Fractal",
      "Everything else",
    ]);
  });
});
