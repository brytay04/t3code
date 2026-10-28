import type { OrchestrationV2Run } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { CLAUDE_PROVIDER } from "./Adapters/ClaudeAdapterV2.ts";
import * as EventSink from "./EventSink.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as PromptSuggestionHub from "./PromptSuggestionHub.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

/**
 * Writes a next-prompt suggestion after every completed run, for providers
 * without a native one, using the prompt suggestion model.
 *
 * Runs are read from the event stream so every provider is covered the same
 * way. A run created later bumps the thread's epoch first, so a slow
 * generation never lands after the user has moved on.
 */

/** Generations in flight at once; extra completions wait. */
const MAX_CONCURRENT_GENERATIONS = 2;
/** Run ids already handled; `run.updated` repeats for a completed run. */
const MAX_SEEN_RUNS = 512;

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const hub = yield* PromptSuggestionHub.PromptSuggestionHub;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const textGeneration = yield* TextGeneration.TextGeneration;
    const seenRuns = new Set<OrchestrationV2Run["id"]>();

    const generate = Effect.fn("PromptSuggestionGenerator.generate")(function* (
      run: OrchestrationV2Run,
      epoch: number,
    ) {
      const settings = yield* serverSettings.getSettings;
      if (settings.promptSuggestionMode === "off") return;
      if (settings.promptSuggestionMode === "native-first") {
        const instance = yield* registry.getInstance(run.providerInstanceId);
        if (instance?.driverKind === CLAUDE_PROVIDER) return;
      }
      const records = yield* threads.getThreadRecords(run.threadId, ["messages"], {
        messageRunIds: [run.id],
        messageRoles: ["user", "assistant"],
      });
      const settled = records.messages.filter((message) => !message.streaming);
      const userMessage = settled.findLast((message) => message.role === "user")?.text ?? "";
      const assistantMessage =
        settled.findLast((message) => message.role === "assistant")?.text ?? "";
      if (assistantMessage.trim().length === 0) return;
      const project = yield* projects.get(records.thread.projectId);
      if (Option.isNone(project)) return;
      const projectSettings = resolveProjectSettings(settings, records.thread.projectId).settings;
      const { suggestion } = yield* textGeneration.generatePromptSuggestion({
        cwd: records.thread.worktreePath ?? project.value.workspaceRoot,
        userMessage,
        assistantMessage,
        modelSelection:
          settings.promptSuggestionModelSelection ?? projectSettings.textGenerationModelSelection,
      });
      yield* hub.set({
        threadId: run.threadId,
        ifEpoch: epoch,
        providerTurnId: null,
        suggestion,
      });
    });

    // Only runs that finish from now on; history has nobody waiting on it.
    const afterSequence = yield* eventSink.latestSequence();
    yield* eventSink.stream({ afterSequence }).pipe(
      Stream.mapEffect(
        (stored) =>
          Effect.gen(function* () {
            const event = stored.event;
            if (event.type === "run.created") {
              yield* hub.clear(event.threadId);
              return null;
            }
            if (event.type !== "run.updated" || event.payload.status !== "completed") return null;
            const run = event.payload;
            if (seenRuns.has(run.id)) return null;
            seenRuns.add(run.id);
            if (seenRuns.size > MAX_SEEN_RUNS) seenRuns.delete(seenRuns.values().next().value!);
            return { run, epoch: yield* hub.epoch(run.threadId) };
          }),
        { concurrency: 1 },
      ),
      Stream.filter((pending) => pending !== null),
      Stream.mapEffect(
        ({ run, epoch }) =>
          generate(run, epoch).pipe(
            Effect.catchCause((cause) =>
              Effect.logDebug("Prompt suggestion generation failed", {
                threadId: run.threadId,
                runId: run.id,
                cause,
              }),
            ),
          ),
        { concurrency: MAX_CONCURRENT_GENERATIONS, unordered: true },
      ),
      Stream.runDrain,
      Effect.catchCause((cause) =>
        Effect.logWarning("Prompt suggestion generator stopped", { cause }),
      ),
      Effect.forkScoped,
    );
  }),
);
