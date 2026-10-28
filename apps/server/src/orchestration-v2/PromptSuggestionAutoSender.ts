import { CommandId, MessageId, type ThreadId } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import * as EventSink from "./EventSink.ts";
import * as PromptSuggestionHub from "./PromptSuggestionHub.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

/**
 * Sends a thread's suggested next prompt on its own when
 * `promptSuggestionAutoSend` is on.
 *
 * Each send waits a moment first, so a prompt the user sends wins: it starts a
 * run, which bumps the thread's suggestion epoch and drops the pending send.
 * A streak of auto-sends stops at a cap until the user writes one themselves,
 * so an idle thread never loops on its own suggestions.
 */

export const AUTO_SEND_DELAY = Duration.seconds(10);
export const MAX_AUTO_SENDS_IN_A_ROW = 3;
/** Auto-sent message ids awaiting their run; bounded in case a send never starts one. */
const MAX_PENDING_MESSAGES = 256;

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const hub = yield* PromptSuggestionHub.PromptSuggestionHub;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const autoMessages = new Set<MessageId>();
    const streaks = new Map<ThreadId, number>();
    const timers = yield* FiberMap.make<ThreadId>();

    const autoSendEnabled = serverSettings.getSettings.pipe(
      Effect.map(
        (settings) => settings.promptSuggestionAutoSend && settings.promptSuggestionMode !== "off",
      ),
      Effect.orElseSucceed(() => false),
    );

    const sendLater = Effect.fn("PromptSuggestionAutoSender.sendLater")(function* (
      change: PromptSuggestionHub.PromptSuggestionChange,
    ) {
      const streak = streaks.get(change.threadId) ?? 0;
      if (streak >= MAX_AUTO_SENDS_IN_A_ROW || !(yield* autoSendEnabled)) return;
      yield* Effect.sleep(AUTO_SEND_DELAY);
      if (!(yield* autoSendEnabled)) return;
      if ((yield* hub.epoch(change.threadId)) !== change.epoch) return;
      const thread = yield* threads.getThreadShell(change.threadId);
      if (
        thread === null ||
        thread.archivedAt !== null ||
        thread.activeRunId !== null ||
        thread.lineage.relationshipToParent === "subagent"
      )
        return;
      const messageId = MessageId.make(
        `auto-prompt:${change.threadId}:${change.epoch}:${thread.latestRunId ?? "none"}`,
      );
      autoMessages.add(messageId);
      if (autoMessages.size > MAX_PENDING_MESSAGES) {
        autoMessages.delete(autoMessages.values().next().value!);
      }
      streaks.set(change.threadId, streak + 1);
      yield* threads.sendToThread({
        projectId: thread.projectId,
        commandId: CommandId.make(`server:${messageId}`),
        threadId: change.threadId,
        messageId,
        text: change.suggestion,
        attachments: [],
        mode: "auto",
        createdBy: "agent",
        creationSource: "server",
      });
    });

    // A run started by anything but an auto-send means the user is back: reset the streak.
    const afterSequence = yield* eventSink.latestSequence();
    yield* eventSink.stream({ afterSequence }).pipe(
      Stream.runForEach((stored) =>
        Effect.sync(() => {
          const event = stored.event;
          if (event.type !== "run.created") return;
          if (autoMessages.delete(event.payload.userMessageId)) return;
          streaks.delete(event.payload.threadId);
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Prompt suggestion auto-send streak tracking stopped", { cause }),
      ),
      Effect.forkScoped,
    );

    // Keyed by thread: a newer suggestion replaces the one still waiting.
    yield* hub.changes.pipe(
      Stream.runForEach((change) =>
        FiberMap.run(
          timers,
          change.threadId,
          sendLater(change).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Prompt suggestion auto-send failed", {
                threadId: change.threadId,
                cause,
              }),
            ),
          ),
        ),
      ),
      Effect.forkScoped,
    );
  }),
);
