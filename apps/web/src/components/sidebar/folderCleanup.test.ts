import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { folderCleanupThreads } from "./folderCleanup";

it("scopes cleanup to physical project members and prioritizes user activity over background updates", () => {
  const environmentId = EnvironmentId.make("local");
  const projectId = ProjectId.make("same-project-id");
  const older = {
    environmentId,
    projectId,
    id: ThreadId.make("older"),
    archivedAt: null,
    deletedAt: null,
    latestUserAuthoredMessageAt: "2026-01-01T00:00:00Z",
    latestUserMessageAt: "2026-01-10T00:00:00Z",
    updatedAt: "2026-01-10T00:00:00Z",
  };
  const recent = {
    ...older,
    id: ThreadId.make("recent"),
    latestUserAuthoredMessageAt: "2026-01-02T00:00:00Z",
  };
  const otherMachine = { ...recent, environmentId: EnvironmentId.make("remote") };
  expect(
    folderCleanupThreads(
      [
        older,
        otherMachine,
        recent,
        { ...recent, archivedAt: recent.updatedAt },
        { ...recent, deletedAt: recent.updatedAt },
      ],
      [{ environmentId, projectId }],
    ),
  ).toEqual([recent, older]);
  expect(
    folderCleanupThreads(
      [otherMachine],
      [{ environmentId: otherMachine.environmentId, projectId }],
    ),
  ).toEqual([otherMachine]);
});
