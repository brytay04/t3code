import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { uniqueModelChoices } from "./ModelPickerContent";

it("shows each model once and keeps the active account as its representative", () => {
  const primary = ProviderInstanceId.make("claudeAgent");
  const work = ProviderInstanceId.make("claude_work");
  const base = { driverKind: ProviderDriverKind.make("claudeAgent"), slug: "claude-opus-5-5" };
  const models = [
    { ...base, instanceId: primary },
    { ...base, instanceId: work },
    { ...base, slug: "claude-sonnet-5-5", instanceId: work },
  ];
  expect(uniqueModelChoices(models, work)).toEqual([models[1], models[2]]);
});
it("does not collapse provider-owned custom model names across drivers", () => {
  const models = ["claudeAgent", "opencode"].map((driver) => ({
    instanceId: ProviderInstanceId.make(driver),
    driverKind: ProviderDriverKind.make(driver),
    slug: "custom",
    isCustom: true,
  }));
  expect(uniqueModelChoices(models, models[0]!.instanceId)).toEqual(models);
});

it("keeps custom models selectable on separate accounts of the same driver", () => {
  const models = ["primary", "work"].map((instance) => ({
    instanceId: ProviderInstanceId.make(instance),
    driverKind: ProviderDriverKind.make("opencode"),
    slug: "custom",
    isCustom: true,
  }));
  expect(uniqueModelChoices(models, models[0]!.instanceId)).toEqual(models);
});
