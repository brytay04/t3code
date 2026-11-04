import { GaugeIcon, UsersIcon } from "lucide-react";
import { type ChatWorkflow } from "@t3tools/shared/chatWorkflows";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";

const workflows = [
  { id: "focus", label: "Focus", detail: "One lead handles the task" },
  {
    id: "team",
    label: "Team",
    detail: "Analysis + test design → lead builds → independent review",
  },
  {
    id: "council",
    label: "Council",
    detail: "Two independent approaches → evidence-based decision; read-only",
  },
] as const;

export function ComposerWorkTools(props: {
  workflow: ChatWorkflow;
  disabled: boolean;
  onWorkflow: (workflow: ChatWorkflow) => void;
  onUsage?: (() => void) | undefined;
}) {
  const floating = useComposerMenuProps();
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {props.onUsage ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <ComposerControl size="xs" aria-label="Check account usage" onClick={props.onUsage} />
            }
          >
            <ComposerControlIcon icon={GaugeIcon} size="xs" />
          </TooltipTrigger>
          <TooltipPopup>Check account usage</TooltipPopup>
        </Tooltip>
      ) : null}
      <Menu>
        <MenuTrigger
          render={
            <ComposerControl
              size="xs"
              disabled={props.disabled}
              aria-label={`Workflow: ${props.workflow}`}
            />
          }
        >
          <ComposerControlIcon icon={UsersIcon} size="xs" />
          {props.workflow !== "focus" ? (
            <span>{props.workflow === "team" ? "Team" : "Council"}</span>
          ) : null}
        </MenuTrigger>
        <MenuPopup align="start" {...floating}>
          <div className="max-w-72 px-2 py-1.5 text-xs text-muted-foreground">
            Adds an editable workflow brief. Review it, add your task, then send. Delegates use the
            lead's model unless you name others.
          </div>
          {workflows.map((workflow) => (
            <MenuItem key={workflow.id} onClick={() => props.onWorkflow(workflow.id)}>
              <div className="flex max-w-72 flex-col gap-0.5">
                <span>
                  {workflow.label}
                  {props.workflow === workflow.id ? " ✓" : ""}
                </span>
                <span className="text-xs text-muted-foreground">{workflow.detail}</span>
              </div>
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}
