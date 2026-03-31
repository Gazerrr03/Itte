import { ChangeEvent, FormEvent, KeyboardEvent, useMemo } from "react";

import { MaterialIcon } from "@/components/material-icon";
import { ToolRow } from "@/components/tool-row";
import { TOOL_ACTIONS } from "@/lib/mock-chat";
import { ToolAction } from "@/types/chat";

type ZenInputPanelProps = {
  value: string;
  isSending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onToolClick: (key: ToolAction["key"]) => void;
};

type SlashCommand = "/optimize" | "/help" | "/vibe" | "/daily";

type ParsedCommandDraft = {
  command: SlashCommand;
  body: string;
};

function parseCommandDraft(value: string): ParsedCommandDraft | null {
  const match = value.match(/^\/(optimize|help|vibe|daily)\b(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return null;
  }

  const command = `/${match[1].toLowerCase()}` as SlashCommand;
  return {
    command,
    body: match[2] ?? "",
  };
}

export function ZenInputPanel({
  value,
  isSending,
  onChange,
  onSubmit,
  onToolClick,
}: ZenInputPanelProps) {
  const parsedCommand = useMemo(() => parseCommandDraft(value), [value]);
  const commandNeedsBody =
    parsedCommand?.command === "/optimize" || parsedCommand?.command === "/help" || parsedCommand?.command === "/vibe";
  const inputValue = parsedCommand ? parsedCommand.body : value;
  const placeholder = parsedCommand
    ? parsedCommand.command === "/daily"
      ? "Press Send to start today's practice."
      : "Type your content for this command..."
    : "Share your thoughts...";
  const sendDisabled = useMemo(() => {
    if (isSending) {
      return true;
    }
    if (parsedCommand) {
      return commandNeedsBody ? parsedCommand.body.trim().length === 0 : false;
    }
    return value.trim().length === 0;
  }, [commandNeedsBody, isSending, parsedCommand, value]);

  const handleInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const element = event.currentTarget;
    element.style.height = "";
    element.style.height = `${element.scrollHeight}px`;
    if (parsedCommand) {
      const nextBody = element.value;
      const nextDraft = nextBody ? `${parsedCommand.command} ${nextBody}` : `${parsedCommand.command} `;
      onChange(nextDraft);
      return;
    }
    onChange(element.value);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!sendDisabled) {
        onSubmit();
      }
      return;
    }

    if (!parsedCommand) {
      return;
    }

    if (
      event.key === "Backspace" &&
      parsedCommand.body.length === 0 &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0
    ) {
      event.preventDefault();
      onChange("");
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!sendDisabled) {
      onSubmit();
    }
  };

  return (
    <div className="relative overflow-hidden px-6 pb-16 pt-12">
      <div className="zen-input-area relative z-10 mx-auto w-full max-w-4xl">
        <form className="liquid-glass-high-fi squircle-frame relative z-10 flex flex-col gap-6 p-0" onSubmit={handleSubmit}>
          <div className="fluid-mesh" />
          <div className="grain-overlay" />

          <div className="relative z-10 flex items-center gap-4 p-4 md:p-6">
            <div className="liquid-input-well flex-1 px-4">
              {parsedCommand ? (
                <div className="flex items-center gap-2 px-1 pt-2">
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold tracking-wide text-primary/85">
                    {parsedCommand.command}
                  </span>
                  <button
                    className="rounded-full bg-white/65 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-outline/80 transition hover:bg-white/90 hover:text-primary"
                    onClick={() => onChange(parsedCommand.body)}
                    title="Remove command"
                    type="button"
                  >
                    Clear
                  </button>
                </div>
              ) : null}
              <textarea
                className="liquid-input-text hide-scrollbar h-10 w-full resize-none border-none bg-transparent py-2 text-lg font-light leading-relaxed focus:outline-none focus:ring-0 md:text-xl"
                onChange={handleInput}
                onKeyDown={handleInputKeyDown}
                placeholder={placeholder}
                rows={1}
                value={inputValue}
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                className="liquid-button-fused flex h-12 w-12 cursor-pointer items-center justify-center rounded-full text-outline/70 transition-colors hover:text-primary"
                title="Voice input"
                type="button"
              >
                <MaterialIcon name="mic" />
              </button>

              <button
                className="liquid-button-fused liquid-button-fused-primary flex h-12 w-12 cursor-pointer items-center justify-center rounded-full"
                disabled={sendDisabled}
                title="Send"
                type="submit"
              >
                <MaterialIcon className="-rotate-45 pl-0.5" name="send" />
              </button>
            </div>
          </div>
        </form>

        <ToolRow
          onToolClick={(key) => {
            if (!isSending) {
              onToolClick(key);
            }
          }}
          tools={TOOL_ACTIONS}
        />
      </div>
    </div>
  );
}
