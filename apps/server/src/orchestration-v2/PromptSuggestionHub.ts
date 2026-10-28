import type {
  OrchestrationV2PromptSuggestion,
  OrchestrationV2SubscribePromptSuggestionInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

/**
 * The latest next-prompt suggestion per thread.
 *
 * Suggestions never become orchestration events: they are a composer hint that
 * is stale as soon as the user acts, so the hub keeps one in memory per thread
 * and pushes changes to clients watching that thread.
 */

/** Threads whose suggestion is remembered; the least recently set is dropped beyond this. */
const MAX_THREADS = 256;

const EMPTY: OrchestrationV2PromptSuggestion = { providerTurnId: null, suggestion: null };

export interface PromptSuggestionHubShape {
  /**
   * `ifEpoch` drops a suggestion generated for a turn the thread has since
   * moved past; read it with `epoch` when the turn completes.
   */
  readonly set: (
    input: {
      readonly threadId: ThreadId;
      readonly ifEpoch?: number;
    } & OrchestrationV2PromptSuggestion,
  ) => Effect.Effect<void>;
  /** A new turn started: drop the suggestion and any still being generated. */
  readonly clear: (threadId: ThreadId) => Effect.Effect<void>;
  readonly epoch: (threadId: ThreadId) => Effect.Effect<number>;
  /** The current suggestion, then every change. */
  readonly subscribe: (
    input: OrchestrationV2SubscribePromptSuggestionInput,
  ) => Stream.Stream<OrchestrationV2PromptSuggestion>;
  /** Every suggestion set on any thread from now on; blank ones are skipped. */
  readonly changes: Stream.Stream<PromptSuggestionChange>;
}

export interface PromptSuggestionChange {
  readonly threadId: ThreadId;
  readonly suggestion: string;
  /** The thread's epoch when the suggestion was set. */
  readonly epoch: number;
}

export class PromptSuggestionHub extends Context.Service<
  PromptSuggestionHub,
  PromptSuggestionHubShape
>()("t3/orchestration-v2/PromptSuggestionHub") {}

export const make = Effect.gen(function* () {
  const changes = yield* PubSub.unbounded<PromptSuggestionChange>();
  // Insertion order doubles as recency: every write re-inserts its entry.
  const latest = new Map<ThreadId, OrchestrationV2PromptSuggestion>();
  const epochs = new Map<ThreadId, number>();
  const subscribers = new Map<ThreadId, Set<Queue.Queue<OrchestrationV2PromptSuggestion>>>();

  const publish = (threadId: ThreadId, value: OrchestrationV2PromptSuggestion) =>
    Effect.suspend(() => {
      latest.delete(threadId);
      if (value.suggestion !== null) {
        latest.set(threadId, value);
        if (latest.size > MAX_THREADS) latest.delete(latest.keys().next().value!);
      }
      return Effect.forEach(subscribers.get(threadId) ?? [], (queue) => Queue.offer(queue, value), {
        discard: true,
      });
    });

  const set: PromptSuggestionHubShape["set"] = ({ threadId, ifEpoch, ...value }) =>
    Effect.suspend(() => {
      if (ifEpoch !== undefined && ifEpoch !== (epochs.get(threadId) ?? 0)) return Effect.void;
      const suggestion = value.suggestion?.trim() ?? "";
      if (suggestion.length === 0) return publish(threadId, EMPTY);
      return publish(threadId, { ...value, suggestion }).pipe(
        Effect.andThen(
          PubSub.publish(changes, { threadId, suggestion, epoch: epochs.get(threadId) ?? 0 }),
        ),
      );
    });

  const clear: PromptSuggestionHubShape["clear"] = (threadId) =>
    Effect.suspend(() => {
      const next = (epochs.get(threadId) ?? 0) + 1;
      epochs.delete(threadId);
      epochs.set(threadId, next);
      if (epochs.size > MAX_THREADS) epochs.delete(epochs.keys().next().value!);
      return latest.has(threadId) ? publish(threadId, EMPTY) : Effect.void;
    });

  const epoch: PromptSuggestionHubShape["epoch"] = (threadId) =>
    Effect.sync(() => epochs.get(threadId) ?? 0);

  const subscribe: PromptSuggestionHubShape["subscribe"] = ({ threadId }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Only the newest value matters to a composer.
        const queue = yield* Queue.sliding<OrchestrationV2PromptSuggestion>(1);
        const threadSubscribers = subscribers.get(threadId) ?? new Set();
        threadSubscribers.add(queue);
        subscribers.set(threadId, threadSubscribers);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            threadSubscribers.delete(queue);
            if (threadSubscribers.size === 0 && subscribers.get(threadId) === threadSubscribers) {
              subscribers.delete(threadId);
            }
          }),
        );
        yield* Queue.offer(queue, latest.get(threadId) ?? EMPTY);
        return Stream.fromQueue(queue);
      }),
    );

  return PromptSuggestionHub.of({
    set,
    clear,
    epoch,
    subscribe,
    changes: Stream.fromPubSub(changes),
  });
});

export const layer: Layer.Layer<PromptSuggestionHub> = Layer.effect(PromptSuggestionHub, make);
