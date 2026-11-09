import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { providerHeadroom } from "@t3tools/shared/modelRouting";
import { isProviderInstancePickerReady, type ProviderInstanceEntry } from "../../providerInstances";

export type AccountRouting = NonNullable<ModelSelection["routing"]>;

export interface ThreadAccountChoice {
  readonly instanceId: ProviderInstanceId;
  readonly label: string;
  /** Null when the account's usage is unknown or stale. */
  readonly percentLeft: number | null;
}

/** Accounts that can run this model. Other providers are a model choice, not an account choice. */
export function threadAccountChoices(input: {
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly activeInstanceId: ProviderInstanceId;
  readonly model: string;
  readonly now: number;
}): ThreadAccountChoice[] {
  const active = input.entries.find((entry) => entry.instanceId === input.activeInstanceId);
  if (!active) return [];
  return input.entries
    .filter(
      (entry) =>
        entry.driverKind === active.driverKind &&
        (entry.instanceId === active.instanceId || isProviderInstancePickerReady(entry)) &&
        entry.models.some((model) => model.slug === input.model && !model.isCustom),
    )
    .map((entry) => ({
      instanceId: entry.instanceId,
      label: entry.displayName,
      percentLeft: providerHeadroom(entry.snapshot, input.model, input.now),
    }));
}

/** A pending choice in the composer wins over what the thread last ran with. */
export function resolveAccountRouting(
  draftRouting: AccountRouting | undefined,
  threadRouting: AccountRouting | undefined,
): AccountRouting {
  return draftRouting ?? threadRouting ?? "auto";
}
