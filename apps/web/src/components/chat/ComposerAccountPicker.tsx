import type { ProviderInstanceId } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { ComposerControl, type ComposerControlSize } from "./ComposerControl";
import { threadAccountChoices, type AccountRouting } from "./threadAccount";

const AUTO = "auto";

export function ComposerAccountPicker(props: {
  entries: ReadonlyArray<ProviderInstanceEntry>;
  activeInstanceId: ProviderInstanceId;
  model: string;
  routing: AccountRouting;
  /** False when automatic switching is off in Settings, so "Auto" would do nothing. */
  autoAvailable: boolean;
  disabled: boolean;
  size: ComposerControlSize;
  onSelect: (choice: ProviderInstanceId | typeof AUTO) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const choices = threadAccountChoices({
    entries: props.entries,
    activeInstanceId: props.activeInstanceId,
    model: props.model,
    now,
  });
  if (choices.length < 2) return null;
  const isAuto = props.autoAvailable && props.routing === AUTO;
  const active = choices.find((choice) => choice.instanceId === props.activeInstanceId);
  const value = isAuto ? AUTO : props.activeInstanceId;
  return (
    <Menu onOpenChange={(open) => open && setNow(Date.now())}>
      <MenuTrigger
        disabled={props.disabled}
        render={<ComposerControl size={props.size} aria-label="Account for this chat" />}
      >
        <span data-composer-control-label>{isAuto ? "Auto" : (active?.label ?? "Account")}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start" side="top" className="max-w-72" data-composer-account-menu>
        <MenuRadioGroup
          aria-label="Account for this chat"
          value={value}
          onValueChange={(next: string) => {
            if (next !== value) props.onSelect(next as ProviderInstanceId | typeof AUTO);
          }}
        >
          {props.autoAvailable ? (
            <MenuRadioItem value={AUTO} closeOnClick>
              <span className="flex items-center gap-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">Auto</span>
                  <span className="text-muted-foreground text-xs">Follows your Settings</span>
                </span>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ) : null}
          {choices.map((choice) => (
            <MenuRadioItem key={choice.instanceId} value={choice.instanceId} closeOnClick>
              <span className="flex items-center gap-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{choice.label}</span>
                  {choice.percentLeft === null ? null : (
                    <span className="text-muted-foreground text-xs">
                      {Math.round(choice.percentLeft)}% left
                    </span>
                  )}
                </span>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
