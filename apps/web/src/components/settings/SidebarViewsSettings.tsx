import type { SidebarView } from "@t3tools/contracts/settings";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Named sets of projects (Work, a side project, ...) the sidebar filter switches between. */
export function SidebarViewsSettings() {
  const views = useScopedSettings().sidebarViews;
  const updateSettings = useUpdateScopedSettings();
  const projectGroups = useSidebarProjectGroups();
  const [newName, setNewName] = useState("");

  const save = (next: ReadonlyArray<SidebarView>) => updateSettings({ sidebarViews: [...next] });
  const updateView = (id: string, change: (view: SidebarView) => SidebarView) =>
    save(views.map((view) => (view.id === id ? change(view) : view)));
  const addView = () => {
    const name = newName.trim();
    if (name.length === 0) return;
    save([...views, { id: randomUUID(), name, projectKeys: [] }]);
    setNewName("");
  };

  return (
    <SettingsRow
      {...searchableSetting("sidebar-views")}
      description="Name a set of projects, such as Work, then pick it from the sidebar filter to see only those threads. Everything else holds the projects no view includes."
    >
      <div className="mt-3 flex flex-col gap-3">
        {views.map((view) => (
          <div key={view.id} className="rounded-lg border border-border/70 p-3">
            <div className="flex items-center gap-2">
              <Input
                size="sm"
                defaultValue={view.name}
                aria-label="View name"
                className="max-w-56"
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (name.length > 0 && name !== view.name) {
                    updateView(view.id, (current) => ({ ...current, name }));
                  }
                }}
              />
              <span className="text-muted-foreground text-xs">
                {view.projectKeys.length} {view.projectKeys.length === 1 ? "project" : "projects"}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                className="ml-auto"
                aria-label={`Delete ${view.name}`}
                onClick={() => save(views.filter((candidate) => candidate.id !== view.id))}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {projectGroups.map((group) => {
                const checked = view.projectKeys.includes(group.projectKey);
                return (
                  <label
                    key={group.projectKey}
                    className="flex min-w-0 cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) =>
                        updateView(view.id, (current) => ({
                          ...current,
                          projectKeys: next
                            ? [...current.projectKeys, group.projectKey]
                            : current.projectKeys.filter((key) => key !== group.projectKey),
                        }))
                      }
                    />
                    <span className="truncate">{group.displayName}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            addView();
          }}
        >
          <Input
            size="sm"
            value={newName}
            placeholder="New view, e.g. Work"
            aria-label="New view name"
            className="max-w-56"
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button size="sm" variant="outline" type="submit" disabled={newName.trim().length === 0}>
            <PlusIcon className="size-3.5" />
            Add view
          </Button>
        </form>
      </div>
    </SettingsRow>
  );
}
