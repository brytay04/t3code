export type ChatWorkflow = "focus" | "team" | "council";

const common = `Use T3's app-owned delegate_task tools so child work appears in this chat. Check orchestrator_capabilities before delegating. If required tools are unavailable, report that and stop. Match effort to the task: if it is small enough to do well alone, skip delegates and say so. Give each child a bounded task: the objective, the output format, what is out of scope, the evidence required, and instructions not to delegate further and to reply only in that format, skipping any personal reply style. Specialists change nothing: no edits to tracked files, no commits, no external actions, and no plan files. Use plan interaction mode only for pure analysis. Reviewers and test designers stay in default interaction mode so they can run tests and read-only commands, and they label anything they did not run as untested. Leave runtimeMode unset: narrower modes pause for human approval and do not make a child read-only. Stay on this chat's account: never point a child at another account of this chat's provider. A child on another provider uses an instance from orchestrator_capabilities that this project has not disabled. Report which account each child used. Follow each task's returned next instruction; do not poll. Cancel outstanding delegates if this workflow is stopped or replaced. Preserve this chat's permissions. Do not create top-level threads.`;

export const CHAT_WORKFLOW_BRIEFS = {
  team: `[Team workflow]\n${common}\nInherit the selected model and options unless I named other models; never substitute silently. Use at most two simultaneous delegates. First define the task and its acceptance checks. Delegate independent analysis and test design in parallel. After both finish, the lead integrates their evidence and performs the authorized implementation. Then delegate an independent read-only review of the actual result. Run relevant checks. Allow at most one repair pass; report any remaining failed checks instead of looping. Finish with the outcome, evidence, unresolved objections, and next actions.\n[/Team workflow]`,
  council: `[Council workflow]\n${common}\nKeep the entire workflow read-only and go easy on usage: start no member you cannot run, and never start a replacement. Define decision criteria first. Stage 1: ask two members, Claude and Codex, the same question in plan interaction mode without showing either the other's answer, unless I named other models. Target them with driverKind claudeAgent and codex so T3 keeps this chat's account, pick each one's strongest listed model, and set high effort through that model's option: effort for Claude, reasoningEffort for Codex. If one is unavailable, report it and stop. Stage 2: only if the answers materially disagree and sources cannot settle it, start one new read-only delegate per member, show the answers anonymized as Answer A and Answer B, and ask each to critique them against the criteria, on the disputed point only. Stage 3: as chair, write one recommendation. Judge by evidence rather than length or agreement. Preserve material dissent and uncertainty. Report which model gave which answer only after the decision. Return the recommendation and its tradeoffs; do not implement it without a subsequent request.\n[/Council workflow]`,
} as const;

/** Remove only intact generated briefs; edits to the user's draft always survive. */
export function applyChatWorkflow(prompt: string, workflow: ChatWorkflow): string {
  let task = prompt;
  for (const brief of Object.values(CHAT_WORKFLOW_BRIEFS)) task = task.replaceAll(brief, "");
  task = task.trimEnd();
  return workflow === "focus"
    ? task
    : `${task}${task ? "\n\n" : ""}${CHAT_WORKFLOW_BRIEFS[workflow]}`;
}

export function selectedChatWorkflow(prompt: string): ChatWorkflow {
  return prompt.includes(CHAT_WORKFLOW_BRIEFS.team)
    ? "team"
    : prompt.includes(CHAT_WORKFLOW_BRIEFS.council)
      ? "council"
      : "focus";
}
