import { expect, it } from "vite-plus/test";
import { applyChatWorkflow, CHAT_WORKFLOW_BRIEFS, selectedChatWorkflow } from "./chatWorkflows.ts";

it("keeps children on this chat's account and able to run checks", () => {
  for (const brief of Object.values(CHAT_WORKFLOW_BRIEFS)) {
    expect(brief).toContain("Stay on this chat's account");
    expect(brief).toContain("Leave runtimeMode unset");
    expect(brief).not.toContain("approval-required");
  }
  expect(CHAT_WORKFLOW_BRIEFS.council).toContain("driverKind claudeAgent and codex");
  expect(CHAT_WORKFLOW_BRIEFS.council).toContain("reasoningEffort for Codex");
});

it("switches workflow briefs without dropping task text or accumulating delegates", () => {
  const task = "Fix [the selection](t3-context://selection/123).\nKeep my exact task.";
  const team = applyChatWorkflow(task, "team");
  expect(selectedChatWorkflow(team)).toBe("team");
  expect(applyChatWorkflow(team, "team")).toBe(team);
  const council = applyChatWorkflow(team, "council");
  expect(council).not.toContain(CHAT_WORKFLOW_BRIEFS.team);
  expect(selectedChatWorkflow(council)).toBe("council");
  expect(applyChatWorkflow(council, "focus")).toBe(task);
  const edited = team.replace("at most two", "at most one");
  expect(applyChatWorkflow(edited, "focus")).toBe(edited);
});
