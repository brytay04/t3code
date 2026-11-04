import { expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
  type ModelSelection,
} from "@t3tools/contracts";
import { createModelCapabilities } from "./model.ts";
import { routeModelSelection } from "./modelRouting.ts";

const now = Date.parse("2026-11-04T18:00:00Z");
const selection: ModelSelection = {
  instanceId: ProviderInstanceId.make("primary"),
  model: "claude-opus-5-5",
  routing: "auto",
};
function provider(id: string, used: number, extra: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-04T18:00:00.000Z",
    models: [{ slug: selection.model, name: "Opus", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt: "2026-11-04T18:00:00.000Z",
      windows: [{ id: "seven_day", label: "Weekly", kind: "weekly", usedPercent: used }],
    },
    ...extra,
  };
}
function route(providers: ServerProvider[], selected = selection) {
  return routeModelSelection({ selection: selected, providers, now, runtimeMode: "full-access" });
}
it("routes the same model to the account with greatest remaining capacity", () => {
  expect(route([provider("primary", 100), provider("backup", 5)])).toEqual({
    ...selection,
    instanceId: "backup",
  });
});
it("preserves explicit provider requests", () => {
  expect(
    route([provider("primary", 100), provider("backup", 0)], { ...selection, routing: "pinned" })
      .instanceId,
  ).toBe("primary");
  expect(
    route([provider("primary", 100), provider("backup", 0)], {
      instanceId: selection.instanceId,
      model: selection.model,
    }).instanceId,
  ).toBe("primary");
});
it.each([
  { enabled: false },
  { installed: false },
  { status: "error" as const },
  { auth: { status: "unauthenticated" as const } },
  { availability: "unavailable" as const },
  { models: [{ slug: "claude-sonnet-5-5", name: "Sonnet", isCustom: false, capabilities: null }] },
  { supportedRuntimeModes: ["approval-required" as const] },
  { usageLimits: undefined },
  {
    usageLimits: {
      checkedAt: "2026-11-04T17:54:59.999Z",
      windows: [{ id: "weekly", label: "Weekly", kind: "weekly" as const, usedPercent: 0 }],
    },
  },
])("rejects an ineligible alternative %j", (extra) => {
  expect(route([provider("primary", 90), provider("backup", 0, extra)]).instanceId).toBe("primary");
});
it("does not discard requested model options to find capacity", () => {
  expect(
    route([provider("primary", 90), provider("backup", 0)], {
      ...selection,
      options: [{ id: "reasoningEffort", value: "high" }],
    }).instanceId,
  ).toBe("primary");
});
it("keeps the current account when headroom ties", () => {
  expect(route([provider("backup", 5), provider("primary", 5)]).instanceId).toBe("primary");
});
it("does not assume an elapsed reset guarantees fresh capacity", () => {
  const expired = provider("backup", 100);
  expect(
    route([
      provider("primary", 90),
      {
        ...expired,
        usageLimits: {
          checkedAt: "2026-11-04T18:00:00.000Z",
          windows: [
            {
              id: "weekly",
              label: "Weekly",
              kind: "weekly",
              usedPercent: 100,
              resetsAt: "2026-11-04T17:59:59.999Z",
            },
          ],
        },
      },
    ]).instanceId,
  ).toBe("primary");
});

it("preserves supported effort options on the routed account", () => {
  const options = [{ id: "reasoningEffort", value: "high" }];
  const models = [
    {
      slug: selection.model,
      name: "Opus",
      isCustom: false,
      capabilities: createModelCapabilities({
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Effort",
            type: "select",
            options: [{ id: "high", label: "High" }],
          },
        ],
      }),
    },
  ];
  expect(
    route([provider("primary", 100, { models }), provider("backup", 5, { models })], {
      ...selection,
      options,
    }),
  ).toEqual({ ...selection, instanceId: "backup", options });
});
it("does not treat a Sonnet-only limit as an Opus limit", () => {
  const backup = provider("backup", 5);
  const usageLimits = {
    ...backup.usageLimits!,
    windows: [
      ...backup.usageLimits!.windows,
      { id: "seven_day_sonnet", label: "Sonnet", kind: "weekly" as const, usedPercent: 100 },
    ],
  };
  expect(route([provider("primary", 100), { ...backup, usageLimits }]).instanceId).toBe("backup");
});

it("routes generated prompts only to text generation providers, preserving options", () => {
  const options = [{ id: "reasoningEffort", value: "high" }] as const;
  const capabilities = createModelCapabilities({
    optionDescriptors: [
      {
        id: "reasoningEffort",
        label: "Effort",
        type: "select",
        options: [{ id: "high", label: "High" }],
      },
    ],
  });
  const models = [{ slug: selection.model, name: "Opus", isCustom: false, capabilities }];
  const routed = routeModelSelection({
    selection: { ...selection, options },
    now,
    runtimeMode: "text-generation",
    providers: [
      provider("primary", 100, { models }),
      provider("unsupported", 0, { models, supportsTextGeneration: false }),
      provider("backup", 5, { models, supportsTextGeneration: true, supportedRuntimeModes: [] }),
    ],
  });
  expect(routed).toEqual({ ...selection, options, instanceId: "backup" });
});
it("routes away from a disabled source when an eligible account has the same model", () => {
  expect(
    route([provider("primary", 100, { enabled: false }), provider("backup", 5)]).instanceId,
  ).toBe("backup");
});
