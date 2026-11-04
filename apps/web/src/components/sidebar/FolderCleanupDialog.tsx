import { useRef, useState } from "react";
import { useEnvironmentScope } from "../../state/session";
import { type EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  isListedThreadLineage,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { readThreadShell, useQuietThreadShells } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { folderCleanupThreads, folderSummaryPrompt, folderThreadNextAction } from "./folderCleanup";

function CleanupThread(props: {
  thread: EnvironmentThreadShell;
  onOpen: (ref: ScopedThreadRef) => void;
}) {
  const { thread } = props;
  const canEdit = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const update = useOrchestrationCommand(threadEnvironment.updateMetadata);
  const [originalTitle, setOriginalTitle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const rename = async (undo: boolean) => {
    if (inFlight.current || !canEdit) return;
    const current = readThreadShell(scopeThreadRef(thread.environmentId, thread.id));
    if (
      !current ||
      current.deletedAt ||
      (!undo && (current.runtime?.activeRunId || current.titleRegeneration))
    )
      return;
    if (undo && originalTitle === null) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await update({
        environmentId: thread.environmentId,
        input: {
          threadId: thread.id,
          ...(undo && originalTitle !== null
            ? { title: originalTitle }
            : { regenerateTitle: true }),
        },
      });
      if (result._tag === "Success") setOriginalTitle(undo ? null : current.title);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not clean up folder",
        description: String(error),
      });
    }
    inFlight.current = false;
    setSaving(false);
  };
  const pending = thread.titleRegeneration !== null && thread.titleRegeneration !== undefined;
  return (
    <article className="space-y-2 rounded-lg border p-3">
      <button
        type="button"
        className="w-full cursor-pointer text-left text-sm font-medium hover:underline"
        onClick={() => props.onOpen(scopeThreadRef(thread.environmentId, thread.id))}
      >
        {thread.title}
      </button>
      <p className="text-xs text-muted-foreground">
        {folderThreadNextAction(thread)} ·{" "}
        {new Date(
          thread.latestUserAuthoredMessageAt ?? thread.latestUserMessageAt ?? thread.updatedAt,
        ).toLocaleString()}
      </p>
      <p className="line-clamp-4 whitespace-pre-wrap break-words text-xs">
        {thread.source.latestVisibleMessage?.text ||
          "No message preview available. Open the conversation for details."}
      </p>
      {originalTitle !== null ? (
        <p className="text-xs text-muted-foreground">Previous title: {originalTitle}</p>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={!canEdit || saving || pending || !!thread.runtime?.activeRunId}
          onClick={() => void rename(false)}
        >
          {pending ? "Generating title…" : "Refresh title"}
        </Button>
        {originalTitle !== null ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={!canEdit || saving}
            onClick={() => void rename(true)}
          >
            Undo title
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function FolderCleanupDialog(props: {
  group: SidebarProjectSnapshot;
  onClose: () => void;
  onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  const allThreads = useQuietThreadShells();
  const threads = folderCleanupThreads(allThreads, props.group.memberProjectRefs).filter((thread) =>
    isListedThreadLineage(thread.lineage),
  );
  const [shown, setShown] = useState(20);
  const recent = threads.slice(0, shown);
  const newThread = useNewThreadHandler();
  const canSummarize = useEnvironmentScope(
    props.group.environmentId,
    AuthOrchestrationOperateScope,
  );
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const summarize = async () => {
    if (openingRef.current || !canSummarize) return;
    openingRef.current = true;
    setOpening(true);
    try {
      const result = await newThread(
        { environmentId: props.group.environmentId, projectId: props.group.id },
        { prompt: folderSummaryPrompt(recent) },
      );
      if (result) props.onClose();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not clean up folder",
        description: String(error),
      });
    }
    openingRef.current = false;
    setOpening(false);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Clean up · {props.group.displayName}</DialogTitle>
          <DialogDescription>
            Recent work, latest updates, and next actions. Source conversations stay intact. Refresh
            title uses your configured title model.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <p className="text-xs text-muted-foreground">
            Showing {recent.length} of {threads.length} loaded conversations, newest user activity
            first. Older unloaded and archived chats are not included.
          </p>
          {recent.map((thread) => (
            <CleanupThread
              key={scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))}
              thread={thread}
              onOpen={(ref) => {
                props.onClose();
                props.onOpenThread(ref);
              }}
            />
          ))}
          {threads.length === 0 ? <p>No conversations to clean up.</p> : null}
          {shown < threads.length ? (
            <Button variant="outline" size="sm" onClick={() => setShown(shown + 20)}>
              Show 20 more
            </Button>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose}>
            Close
          </Button>
          <Button
            disabled={!canSummarize || recent.length === 0 || opening}
            onClick={() => void summarize()}
          >
            {opening ? "Opening…" : `Draft overview of ${recent.length} chats`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
