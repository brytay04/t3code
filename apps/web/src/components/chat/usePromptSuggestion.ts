import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useServerConfigs } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";

/** The provider's suggested next prompt for a thread, or null when there is none. */
export function usePromptSuggestion(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
): string | null {
  const supported =
    useServerConfigs().get(environmentId)?.environment.capabilities.promptSuggestions === true;
  const { data } = useEnvironmentQuery(
    supported && threadId !== null
      ? orchestrationEnvironment.v2.promptSuggestion({ environmentId, input: { threadId } })
      : null,
  );
  return data?.suggestion ?? null;
}
