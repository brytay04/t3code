import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
  type ModelSelection,
} from "@t3tools/contracts";
import type { AccountSwitching } from "@t3tools/contracts/settings";
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
  return routeModelSelection({
    selection: selected,
    providers,
    now,
    runtimeMode: "full-access",
    accountSwitching: "most-headroom",
  });
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
      checkedAt: "2026-11-04T17:44:59.999Z",
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
    accountSwitching: "most-headroom",
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

describe("automatic account switching setting", () => {
  const routeWith = (accountSwitching: AccountSwitching, providers: ServerProvider[]) =>
    routeModelSelection({
      selection,
      providers,
      now,
      runtimeMode: "full-access",
      accountSwitching,
    }).instanceId;

  it("never leaves the chosen account when off, even if it is full", () => {
    expect(routeWith("off", [provider("primary", 100), provider("backup", 0)])).toBe("primary");
  });

  it("stays on the current account until it is nearly full", () => {
    expect(routeWith("when-full", [provider("primary", 90), provider("backup", 0)])).toBe(
      "primary",
    );
    expect(routeWith("when-full", [provider("primary", 96), provider("backup", 0)])).toBe("backup");
  });

  it("always takes the most headroom when asked", () => {
    expect(routeWith("most-headroom", [provider("primary", 20), provider("backup", 10)])).toBe(
      "backup",
    );
  });
});

describe("usage data edge cases", () => {
  const withWindows = (
    instanceId: string,
    windows: NonNullable<ServerProvider["usageLimits"]>["windows"],
  ) =>
    provider(instanceId, 0, {
      usageLimits: { checkedAt: "2026-11-04T18:00:00.000Z", windows },
    });

  it("does not let a full Fable cap block an Opus chat", () => {
    expect(
      route([
        provider("primary", 100),
        withWindows("backup", [
          { id: "seven_day", label: "Weekly", kind: "weekly", usedPercent: 10 },
          { id: "seven_day_fable", label: "Fable", kind: "weekly", usedPercent: 100 },
        ]),
      ]).instanceId,
    ).toBe("backup");
  });

  it("keeps using usage data across a slow refresh", () => {
    const sixMinutesOld = "2026-11-04T17:54:00.000Z";
    const aged = (instanceId: string, used: number) =>
      provider(instanceId, 0, {
        usageLimits: {
          checkedAt: sixMinutesOld,
          windows: [{ id: "seven_day", label: "Weekly", kind: "weekly", usedPercent: used }],
        },
      });
    expect(route([aged("primary", 100), aged("backup", 10)]).instanceId).toBe("backup");
  });

  it("ignores a window that has already reset when another one still applies", () => {
    expect(
      route([
        provider("primary", 100),
        withWindows("backup", [
          {
            id: "five_hour",
            label: "Session",
            kind: "session",
            usedPercent: 40,
            resetsAt: "2026-11-04T17:59:00.000Z",
          },
          { id: "seven_day", label: "Weekly", kind: "weekly", usedPercent: 8 },
        ]),
      ]).instanceId,
    ).toBe("backup");
  });
});
