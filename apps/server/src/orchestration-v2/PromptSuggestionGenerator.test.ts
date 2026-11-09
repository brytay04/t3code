import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { generateWithAvailableAccount } from "./PromptSuggestionGenerator.ts";

it.effect.each(["route", "project-disabled", "pinned", "inherited", "pinned-thread"] as const)(
  "uses the chosen suggestion model and effort with %s selection",
  (scenario) =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("suggestion-project");
      const primary = ProviderInstanceId.make("primary");
      const backup = ProviderInstanceId.make("backup");
      const options = [{ id: "reasoningEffort", value: "high" }];
      const selection = {
        instanceId: primary,
        model: "gpt-6-astra",
        options,
        routing: scenario === "pinned" ? ("pinned" as const) : ("auto" as const),
      };
      const providers: ServerProvider[] = [primary, backup].map((instanceId, index) => ({
        instanceId,
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "1970-01-01T00:00:00.000Z",
        slashCommands: [],
        skills: [],
        supportsTextGeneration: true,
        models: [
          {
            slug: selection.model,
            name: "Astra",
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
        ],
        usageLimits: {
          checkedAt: "1970-01-01T00:00:00.000Z",
          windows: [
            { id: "weekly", label: "Weekly", kind: "weekly", usedPercent: index === 0 ? 100 : 5 },
          ],
        },
      }));
      const settings = {
        ...DEFAULT_SERVER_SETTINGS,
        promptSuggestionModelSelection: scenario === "inherited" ? null : selection,
        textGenerationModelSelection: selection,
        projectSettingsOverrides:
          scenario === "project-disabled"
            ? { [projectId]: { providerInstances: { [backup]: { enabled: false } } } }
            : {},
      };
      const result = yield* generateWithAvailableAccount({
        settings,
        projectId,
        cwd: "/project",
        userMessage: "Build it",
        assistantMessage: "Built it",
        ...(scenario === "pinned-thread"
          ? { threadSelection: { ...selection, instanceId: primary, routing: "pinned" as const } }
          : {}),
      }).pipe(
        Effect.provide(
          Layer.merge(
            ProviderRegistryMock.layer(providers),
            Layer.mock(TextGeneration.TextGeneration)({
              generatePromptSuggestion: (input) =>
                Effect.sync(() => {
                  assert.equal(
                    input.modelSelection.instanceId,
                    scenario === "route" || scenario === "inherited" ? backup : primary,
                  );
                  assert.equal(input.modelSelection.model, selection.model);
                  assert.deepEqual(input.modelSelection.options, options);
                  assert.equal(input.cwd, "/project");
                  return { suggestion: "Verify it" };
                }),
            }),
          ),
        ),
      );
      assert.equal(result.suggestion, "Verify it");
    }),
);
