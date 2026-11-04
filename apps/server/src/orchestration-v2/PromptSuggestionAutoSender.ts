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

// The server owns the delay and streak so disconnected clients cannot duplicate auto-sends.

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
      const settings = yield* serverSettings.getSettings;
      if (streak >= settings.promptSuggestionMaxAutoSends || !(yield* autoSendEnabled)) return;
      const source = yield* threads.getThreadShell(change.threadId);
      if (source === null || source.latestRunId === null) return;
      yield* Effect.sleep(Duration.seconds(settings.promptSuggestionDelaySeconds));
      const currentSettings = yield* serverSettings.getSettings;
      if (!(yield* autoSendEnabled) || streak >= currentSettings.promptSuggestionMaxAutoSends)
        return;
      if ((yield* hub.epoch(change.threadId)) !== change.epoch) return;
      const thread = yield* threads.getThreadShell(change.threadId);
      if (
        thread === null ||
        thread.archivedAt !== null ||
        thread.activeRunId !== null ||
        thread.latestRunId !== source.latestRunId ||
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
      yield* threads
        .sendToThread({
          projectId: thread.projectId,
          commandId: CommandId.make(`server:${messageId}`),
          threadId: change.threadId,
          messageId,
          suggestionForRunId: source.latestRunId,
          text: change.suggestion,
          attachments: [],
          mode: "auto",
          createdBy: "agent",
          creationSource: "server",
        })
        .pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              autoMessages.delete(messageId);
            }),
          ),
        );
      streaks.set(change.threadId, streak + 1);
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
