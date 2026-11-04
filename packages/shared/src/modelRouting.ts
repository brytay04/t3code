import type { ModelSelection, RuntimeMode, ServerProvider } from "@t3tools/contracts";

// Unknown and stale quotas must never look like an unused subscription.
function providerHeadroom(provider: ServerProvider, model: string, now: number): number | null {
  const limits = provider.usageLimits;
  if (
    !limits ||
    limits.unavailable ||
    now - Date.parse(limits.checkedAt) > 300_000 ||
    Date.parse(limits.checkedAt) > now ||
    !Number.isFinite(Date.parse(limits.checkedAt))
  )
    return null;
  if (
    limits.windows.some(
      (window) =>
        window.resetsAt &&
        (!Number.isFinite(Date.parse(window.resetsAt)) || Date.parse(window.resetsAt) <= now),
    )
  )
    return null;
  const windows = limits.windows.filter((window) => {
    const family = /^seven_day_(opus|sonnet|haiku)$/.exec(window.id)?.[1];
    return !family || model.includes(family);
  });
  return windows.length ? Math.min(...windows.map((window) => 100 - window.usedPercent)) : null;
}

export function routeModelSelection(input: {
  selection: ModelSelection;
  providers: ReadonlyArray<ServerProvider>;
  runtimeMode: RuntimeMode | "text-generation";
  now: number;
}): ModelSelection {
  const { selection, providers, runtimeMode, now } = input;
  if (selection.routing !== "auto") return selection;
  const source = providers.find((provider) => provider.instanceId === selection.instanceId);
  const selectedModel = source?.models.find((model) => model.slug === selection.model);
  if (!source || !selectedModel || selectedModel.isCustom) return selection;
  let best = selection;
  let bestHeadroom = -1;
  for (const provider of providers) {
    if (
      !provider.enabled ||
      !provider.installed ||
      provider.status !== "ready" ||
      provider.availability === "unavailable" ||
      provider.auth.status !== "authenticated" ||
      (runtimeMode === "text-generation"
        ? provider.supportsTextGeneration === false
        : provider.supportedRuntimeModes && !provider.supportedRuntimeModes.includes(runtimeMode))
    )
      continue;
    const model = provider.models.find(
      (model) => model.slug === selection.model && !model.isCustom,
    );
    if (!model) continue;
    const options = model.capabilities?.optionDescriptors ?? [];
    if (
      selection.options?.some(
        (option) =>
          !options.some(
            (descriptor) =>
              descriptor.id === option.id &&
              (descriptor.type === "boolean"
                ? typeof option.value === "boolean"
                : descriptor.options.some((choice) => choice.id === option.value)),
          ),
      )
    )
      continue;
    const headroom = providerHeadroom(provider, selection.model, now);
    if (headroom === null || headroom <= 0) continue;
    if (
      headroom > bestHeadroom ||
      (headroom === bestHeadroom && provider.instanceId === selection.instanceId)
    ) {
      bestHeadroom = headroom;
      best = { ...selection, instanceId: provider.instanceId };
    }
  }
  return best;
}
