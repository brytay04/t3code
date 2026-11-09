import type { ModelSelection, RuntimeMode, ServerProvider } from "@t3tools/contracts";
import type { AccountSwitching } from "@t3tools/contracts/settings";

// Longer than the 5-minute usage refresh, so a slow refresh never hides every account.
const USAGE_STALE_AFTER_MS = 15 * 60_000;
// "when-full" leaves a chat alone until its account has this little left.
const SWITCH_AT_HEADROOM_PERCENT = 5;

// Unknown and stale quotas must never look like an unused subscription.
export function providerHeadroom(
  provider: ServerProvider,
  model: string,
  now: number,
): number | null {
  const limits = provider.usageLimits;
  if (!limits || limits.unavailable) return null;
  const checkedAt = Date.parse(limits.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > USAGE_STALE_AFTER_MS)
    return null;
  if (
    limits.windows.some(
      (window) => window.resetsAt && !Number.isFinite(Date.parse(window.resetsAt)),
    )
  )
    return null;
  // A window past its reset no longer limits anything; a family cap limits only that family.
  const windows = limits.windows.filter((window) => {
    if (window.resetsAt && Date.parse(window.resetsAt) <= now) return false;
    const family = /^seven_day_(opus|sonnet|haiku|fable)$/.exec(window.id)?.[1];
    return !family || model.includes(family);
  });
  return windows.length ? Math.min(...windows.map((window) => 100 - window.usedPercent)) : null;
}

export function routeModelSelection(input: {
  selection: ModelSelection;
  providers: ReadonlyArray<ServerProvider>;
  runtimeMode: RuntimeMode | "text-generation";
  now: number;
  accountSwitching: AccountSwitching;
}): ModelSelection {
  const { selection, providers, runtimeMode, now, accountSwitching } = input;
  if (selection.routing !== "auto" || accountSwitching === "off") return selection;
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
      accountSwitching === "when-full" &&
      provider.instanceId === selection.instanceId &&
      headroom > SWITCH_AT_HEADROOM_PERCENT
    )
      return selection;
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
