import { ChatMessage } from "@/types/chat";

type UserBubbleProps = {
  message: ChatMessage;
};

export function UserBubble({ message }: UserBubbleProps) {
  return (
    <div className="group flex flex-col items-end gap-6">
      <div className="max-w-[85%] text-right text-xl leading-relaxed font-light text-primary/50 italic md:text-2xl">
        {message.content}
      </div>

      <div className="flex items-center gap-4 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="h-px w-8 bg-outline/10" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-outline/40">Reflection</span>
      </div>
    </div>
  );
}
