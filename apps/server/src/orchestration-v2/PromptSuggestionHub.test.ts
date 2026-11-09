import { assert, it } from "@effect/vitest";
import { RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import * as PromptSuggestionHub from "./PromptSuggestionHub.ts";

const THREAD_ID = ThreadId.make("thread:suggestions");
const OTHER_THREAD_ID = ThreadId.make("thread:other");
const RUN_ID = RunId.make("run:1");

const layer = it.layer(PromptSuggestionHub.layer);

layer("PromptSuggestionHub", (it) => {
  it.effect("a viewer that subscribes later still sees the last suggestion", () =>
    Effect.gen(function* () {
      const hub = yield* PromptSuggestionHub.PromptSuggestionHub;
      yield* hub.set({
        threadId: THREAD_ID,
        runId: RUN_ID,
        text: "  run the tests ",
      });
      const [first] = yield* hub
        .subscribe({ threadId: THREAD_ID })
        .pipe(Stream.take(1), Stream.runCollect);
      assert.deepStrictEqual(first, { runId: RUN_ID, text: "run the tests" });
      yield* hub.clear(THREAD_ID);
    }),
  );

  it.effect("a new turn clears the suggestion for viewers of that thread only", () =>
    Effect.gen(function* () {
      const hub = yield* PromptSuggestionHub.PromptSuggestionHub;
      yield* hub.set({ threadId: THREAD_ID, runId: RUN_ID, text: "commit it" });
      yield* hub.set({ threadId: OTHER_THREAD_ID, runId: RUN_ID, text: "keep me" });
      const viewer = yield* hub
        .subscribe({ threadId: THREAD_ID })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
      yield* Effect.yieldNow;
      yield* hub.clear(THREAD_ID);
      const frames = yield* Fiber.join(viewer);
      assert.deepStrictEqual(
        frames.map((frame) => frame?.text ?? null),
        ["commit it", null],
      );
      const [other] = yield* hub
        .subscribe({ threadId: OTHER_THREAD_ID })
        .pipe(Stream.take(1), Stream.runCollect);
      assert.equal(other?.text, "keep me");
    }),
  );

  it.effect("a suggestion generated for a turn the thread has moved past is dropped", () =>
    Effect.gen(function* () {
      const hub = yield* PromptSuggestionHub.PromptSuggestionHub;
      const threadId = ThreadId.make("thread:stale");
      const epoch = yield* hub.epoch(threadId);
      yield* hub.clear(threadId);
      yield* hub.set({ threadId, ifEpoch: epoch, runId: RUN_ID, text: "too late" });
      const [first] = yield* hub.subscribe({ threadId }).pipe(Stream.take(1), Stream.runCollect);
      assert.equal(first?.text ?? null, null);
      const current = yield* hub.epoch(threadId);
      yield* hub.set({ threadId, ifEpoch: current, runId: RUN_ID, text: "on time" });
      const [second] = yield* hub.subscribe({ threadId }).pipe(Stream.take(1), Stream.runCollect);
      assert.equal(second?.text, "on time");
    }),
  );

  it.effect("a blank suggestion is treated as none", () =>
    Effect.gen(function* () {
      const hub = yield* PromptSuggestionHub.PromptSuggestionHub;
      yield* hub.set({ threadId: THREAD_ID, runId: RUN_ID, text: "   " });
      const [first] = yield* hub
        .subscribe({ threadId: THREAD_ID })
        .pipe(Stream.take(1), Stream.runCollect);
      assert.equal(first, null);
    }),
  );
});
