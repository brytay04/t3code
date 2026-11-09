import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { resolveAccountRouting, threadAccountChoices } from "./threadAccount";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const MODEL = "claude-opus-5-5";

function entry(input: {
  id: string;
  driver?: string;
  ready?: boolean;
  models?: string[];
  usedPercent?: number;
}): ProviderInstanceEntry {
  const ready = input.ready ?? true;
  return {
    instanceId: ProviderInstanceId.make(input.id),
    driverKind: ProviderDriverKind.make(input.driver ?? "claudeAgent"),
    displayName: input.id,
    enabled: ready,
    installed: true,
    status: ready ? "ready" : "error",
    isDefault: false,
    isAvailable: ready,
    models: (input.models ?? [MODEL]).map((slug) => ({ slug, name: slug, isCustom: false })),
    snapshot: {
      usageLimits:
        input.usedPercent === undefined
          ? undefined
          : {
              checkedAt: new Date(NOW - 60_000).toISOString(),
              windows: [{ id: "five_hour", usedPercent: input.usedPercent, resetsAt: null }],
            },
    },
  } as unknown as ProviderInstanceEntry;
}

const choose = (entries: ProviderInstanceEntry[], active: string, model = MODEL) =>
  threadAccountChoices({
    entries,
    activeInstanceId: ProviderInstanceId.make(active),
    model,
    now: NOW,
  });

describe("threadAccountChoices", () => {
  it("lists every ready account that offers the model, with what is left", () => {
    const choices = choose(
      [entry({ id: "personal", usedPercent: 30 }), entry({ id: "work" })],
      "personal",
    );
    expect(choices.map((choice) => [choice.label, choice.percentLeft])).toEqual([
      ["personal", 70],
      ["work", null],
    ]);
  });

  it("leaves out other providers, unready accounts, and accounts without the model", () => {
    const choices = choose(
      [
        entry({ id: "personal" }),
        entry({ id: "codex", driver: "codex" }),
        entry({ id: "signed-out", ready: false }),
        entry({ id: "no-model", models: ["claude-haiku-5-5"] }),
      ],
      "personal",
    );
    expect(choices.map((choice) => choice.label)).toEqual(["personal"]);
  });

  it("keeps the current account visible even if it stopped being ready", () => {
    const choices = choose(
      [entry({ id: "personal", ready: false }), entry({ id: "work" })],
      "personal",
    );
    expect(choices.map((choice) => choice.label)).toEqual(["personal", "work"]);
  });

  it("has no choices for an unknown account", () => {
    expect(choose([entry({ id: "work" })], "gone")).toEqual([]);
  });
});

describe("resolveAccountRouting", () => {
  it("prefers the composer's pending choice, then the thread, then auto", () => {
    expect(resolveAccountRouting("auto", "pinned")).toBe("auto");
    expect(resolveAccountRouting(undefined, "pinned")).toBe("pinned");
    expect(resolveAccountRouting(undefined, undefined)).toBe("auto");
  });
});
