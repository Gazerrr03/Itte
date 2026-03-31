import { AssistantBubble } from "@/components/assistant-bubble";
import { UserBubble } from "@/components/user-bubble";
import { ChatMessage, MessageTranslationState } from "@/types/chat";

type MessageListProps = {
  messages: ChatMessage[];
  activeSessionId: string | null;
  translations: Record<string, MessageTranslationState>;
  onToggleTranslation: (messageId: string) => void;
  onReadAloud: (messageId: string) => void;
  speakingMessageId: string | null;
};

function translationKey(sessionId: string, messageId: string) {
  return `${sessionId}:${messageId}:ZH`;
}

export function MessageList({
  messages,
  activeSessionId,
  translations,
  onToggleTranslation,
  onReadAloud,
  speakingMessageId,
}: MessageListProps) {
  return (
    <div className="w-full max-w-3xl space-y-24">
      {messages.map((message) => {
        if (message.role === "assistant") {
          const key = activeSessionId ? translationKey(activeSessionId, message.id) : null;
          const translation = key ? translations[key] : undefined;
          return (
            <AssistantBubble
              key={message.id}
              message={message}
              onReadAloud={() => onReadAloud(message.id)}
              translation={translation}
              onToggleTranslation={() => onToggleTranslation(message.id)}
              isReading={speakingMessageId === message.id}
            />
          );
        }

        if (message.role === "user") {
          return <UserBubble key={message.id} message={message} />;
        }

        return (
          <div key={message.id} className="rounded-2xl border border-outline/15 bg-white/60 p-5">
            <div className="mb-2 text-[10px] tracking-[0.18em] text-outline/70 uppercase">Session Summary</div>
            <pre className="whitespace-pre-wrap font-mono text-sm leading-6 text-primary/80">{message.content}</pre>
          </div>
        );
      })}
    </div>
  );
}
