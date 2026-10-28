import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { SendHorizontalIcon } from "lucide-react";
import { useState } from "react";

import { newMessageId } from "~/lib/utils";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { usePromptSuggestion } from "./chat/usePromptSuggestion";
import { Button } from "./ui/button";

/**
 * The thread's suggested next prompt inside its completion toast, sendable
 * without opening the thread. Suggestions are written a few seconds after the
 * run completes, so this fills in while the toast is up.
 */
export function ThreadNotificationSuggestion({
  environmentId,
  thread,
  onSent,
}: {
  environmentId: EnvironmentId;
  thread: Pick<OrchestrationV2ThreadShell, "id" | "runtimeMode" | "interactionMode">;
  onSent: () => void;
}) {
  const suggestion = usePromptSuggestion(environmentId, thread.id);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (suggestion === null) return null;

  const send = async () => {
    setSending(true);
    setError(null);
    const result = await startTurn({
      environmentId,
      input: {
        threadId: thread.id,
        message: { messageId: newMessageId(), role: "user", text: suggestion, attachments: [] },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        dispatchMode: "queue",
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not send the prompt.");
      return;
    }
    onSent();
  };

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 py-1 pr-1 pl-2">
        <span className="line-clamp-2 min-w-0 flex-1 text-muted-foreground text-xs">
          {suggestion}
        </span>
        <Button
          size="xs"
          type="button"
          disabled={sending}
          onClick={() => void send()}
          aria-label={`Send: ${suggestion}`}
        >
          <SendHorizontalIcon aria-hidden className="size-3" />
          Send
        </Button>
      </div>
      {error ? <span className="text-destructive-foreground text-xs">{error}</span> : null}
    </div>
  );
}
