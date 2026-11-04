export type ChatWorkflow = "focus" | "team" | "council";

const common = `Use T3's app-owned delegate_task tools so child work appears in this chat. Check orchestrator_capabilities before delegating. Inherit the selected model and options unless I explicitly named other models. If required tools or a named model are unavailable, report that and stop; do not silently substitute. Use at most two simultaneous delegates. Give each child a bounded task, evidence requirements, and instructions not to delegate further. Specialists must be read-only: request plan interaction mode and approval-required runtime mode, and prohibit edits or external actions. Follow each task's returned next instruction; do not poll. Cancel outstanding delegates if this workflow is stopped or replaced. Preserve this chat's permissions. Do not create top-level threads.`;

export const CHAT_WORKFLOW_BRIEFS = {
  team: `[Team workflow]\n${common}\nFirst define the task and its acceptance checks. Delegate independent analysis and test design in parallel. After both finish, the lead integrates their evidence and performs the authorized implementation. Then delegate an independent read-only review of the actual result. Run relevant checks. Allow at most one repair pass; report any remaining failed checks instead of looping. Finish with the outcome, evidence, unresolved objections, and next actions.\n[/Team workflow]`,
  council: `[Council workflow]\n${common}\nKeep the entire workflow read-only. Define decision criteria, then delegate two independent approaches to the same problem without showing either the other's answer. After both finish, compare their anonymized proposals against those criteria. Judge by evidence rather than majority vote. Preserve material dissent and uncertainty. Return one recommendation and its tradeoffs; do not implement it without a subsequent request.\n[/Council workflow]`,
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
