import { useEffect, useState } from "react";

import { MaterialIcon } from "@/components/material-icon";
import { formatAssistantText } from "@/lib/assistant-format";
import { ChatMessage, MessageTranslationState } from "@/types/chat";

type AssistantBubbleProps = {
  message: ChatMessage;
  translation?: MessageTranslationState;
  onToggleTranslation: () => void;
  onReadAloud: () => void;
  isReading: boolean;
};

function isHoverCapable() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function AssistantBubble({ message, translation, onToggleTranslation, onReadAloud, isReading }: AssistantBubbleProps) {
  const tone = message.tone ?? "standard";
  const rawContent = message.rawContent ?? message.content;
  const isThinking = Boolean(message.isThinking && !rawContent.trim());
  const canTranslate = !isThinking && !message.id.startsWith("a-temp-");
  const [supportsHover, setSupportsHover] = useState(isHoverCapable);
  const [touchActionsOpen, setTouchActionsOpen] = useState(false);

  const formatted = formatAssistantText(rawContent);
  const blocks =
    formatted.sections.length > 0
      ? formatted.sections.map((section) => ({ content: section.content, variant: section.variant }))
      : [{ content: formatted.display, variant: "main" as const }];

  const mainClass =
    tone === "standard"
      ? "max-w-3xl whitespace-pre-wrap text-2xl leading-tight font-semibold tracking-tight text-primary md:text-3xl"
      : "max-w-3xl whitespace-pre-wrap text-3xl leading-tight font-bold tracking-tight text-primary md:text-4xl";
  const monoClass = "max-w-3xl whitespace-pre-wrap font-mono text-[15px] leading-7 text-primary/78 md:text-base";

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const onChange = () => {
      const nextHover = media.matches;
      setSupportsHover(nextHover);
      if (nextHover) {
        setTouchActionsOpen(false);
      }
    };

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  const actionVisibilityClass = supportsHover
    ? "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
    : touchActionsOpen
      ? "opacity-100 pointer-events-auto"
      : "opacity-0 pointer-events-none";

  const handleContentTap = () => {
    if (supportsHover || !canTranslate) {
      return;
    }
    setTouchActionsOpen((previous) => !previous);
  };

  const translateLabel = translation?.loading
    ? "Translating..."
    : translation?.text && translation.expanded
      ? "Hide Translation"
      : "Translate";

  return (
    <div className="group flex flex-col gap-6">
      {tone === "quote" ? (
        <div className="max-w-2xl border-l-2 border-outline/10 py-1 pl-6 font-mono text-sm leading-relaxed text-outline/70 italic md:text-base">
          {formatted.display}
        </div>
      ) : isThinking ? (
        <div className="max-w-3xl whitespace-pre-wrap font-mono text-sm leading-7 text-outline/70 italic md:text-base">
          <span className="thinking-text">thinking...</span>
        </div>
      ) : (
        <div className="flex flex-col gap-7" onClick={handleContentTap} role="presentation">
          {blocks.map((block, index) => (
            <div key={`${message.id}-${index}`} className={block.variant === "mono" ? monoClass : mainClass}>
              {block.content}
            </div>
          ))}
        </div>
      )}

      {canTranslate ? (
        <div className={`transition-opacity duration-200 ${actionVisibilityClass}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-outline/40">Itte</span>
              <div className="h-px w-8 bg-outline/10" />
            </div>

            <div
              className="flex items-center gap-2"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                className="inline-flex items-center gap-1 rounded-full border border-outline/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-outline/80 transition hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
                disabled={Boolean(translation?.loading)}
                onClick={() => {
                  void onToggleTranslation();
                }}
                type="button"
              >
                <MaterialIcon className="text-[13px]" name="translate" />
                {translateLabel}
              </button>

              <button
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                  isReading
                    ? "border-primary/35 bg-primary/10 text-primary hover:bg-primary/15"
                    : "border-outline/20 text-outline/80 hover:bg-primary/5 hover:text-primary"
                }`}
                onClick={() => {
                  void onReadAloud();
                }}
                type="button"
              >
                <MaterialIcon className="text-[13px]" name="volume_up" />
                {isReading ? "Stop" : "Replay"}
              </button>
            </div>
          </div>

          {translation?.error ? (
            <div className="mt-3 text-xs text-red-500/90">{translation.error}</div>
          ) : null}

          {translation?.text && translation.expanded ? (
            <div
              className="mt-4 whitespace-pre-wrap border-l-2 border-outline/10 py-1 pl-4 text-sm leading-relaxed font-light text-primary/72"
              onClick={(event) => event.stopPropagation()}
              role="presentation"
            >
              {translation.text}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
