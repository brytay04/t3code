import type {
  EnvironmentId,
  ProviderInstanceId,
  ServerProvider,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import { collectProviderUsageLimits } from "@t3tools/shared/usageLimits";
import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useStableCallback } from "../../hooks/useStableCallback";
import { toastManager } from "../ui/toast";
import { usageLimitsBannerItem } from "./ComposerUsageLimits";

const EMPTY_USAGE_PROVIDERS = Atom.make<readonly ServerProvider[]>([]);

/** Keep opened data live. Retain hidden panels during reconnect; clear when quota-spending work resumes. */
export function useUsageLimitsPanel(input: {
  readonly environmentId: EnvironmentId;
  readonly threadKey: string;
  readonly panelKey: string | null;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providerDriver: ServerProvider["driver"] | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
}) {
  const {
    environmentId,
    threadKey,
    panelKey,
    providerInstanceId,
    providerDriver,
    providers,
    sources,
  } = input;
  const [panel, setPanel] = useState<{
    readonly key: string;
    readonly threadKey: string;
    readonly now: number;
  } | null>(null);
  const minute = useNowMinute();
  const now = Math.max(Date.parse(`${minute}:00Z`), panel?.now ?? 0);
  const liveProviders = useAtomValue(
    panel === null ? EMPTY_USAGE_PROVIDERS : serverEnvironment.providersValueAtom(environmentId),
  );
  const canRefresh = useAtomValue(serverEnvironment.refreshProviders.permissionAtom(environmentId));
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    label: "Refresh account usage",
  });
  const refreshingRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useStableCallback(async () => {
    if (!canRefresh || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await refreshProviders({ environmentId, input: {} });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not refresh usage",
        description: String(error),
      });
    }
    refreshingRef.current = false;
    setRefreshing(false);
    setPanel((current) => (current?.key === panelKey ? { ...current, now: Date.now() } : current));
  });
  if (panel !== null && panelKey !== null && panel.key !== panelKey) {
    setPanel(null);
  }
  const report =
    panel !== null && panelKey !== null && panel.key === panelKey && providerInstanceId !== null
      ? collectProviderUsageLimits(
          providerInstanceId,
          liveProviders ?? providers,
          sources,
          now,
          true,
        )
      : null;
  const banner =
    panel !== null && panelKey !== null && panel.key === panelKey
      ? usageLimitsBannerItem(
          `usage-limits:${panel.key}:${panel.now}`,
          report ?? {
            createdAt: new Date(now).toISOString(),
            accounts: [],
            notices: ["Usage unavailable. No capacity estimate is available for this provider."],
          },
          environmentId,
          () => setPanel(null),
          { refresh: () => void refresh(), refreshing, canRefresh },
        )
      : null;
  const offered = providerDriver !== null;
  const open = useStableCallback(() => {
    if (panelKey === null || providerInstanceId === null) return false;
    setPanel({ key: panelKey, threadKey, now: Date.now() });
    void refresh();
    return true;
  });
  // Async responses may clear only their originating thread's panel.
  const clearFor = useStableCallback((originThreadKey: string) =>
    setPanel((current) =>
      current !== null && current.threadKey === originThreadKey ? null : current,
    ),
  );

  return { banner, offered, open, clearFor };
}
