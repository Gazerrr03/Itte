import { ChatMessage, ToolAction } from "@/types/chat";

export function getInitialConversation(): ChatMessage[] {
  return [
    {
      id: "a-1",
      role: "assistant",
      tone: "hero",
      content: "I see what you mean. It is okay to start small. Let us keep going.",
    },
    {
      id: "u-1",
      role: "user",
      tone: "reflection",
      content:
        "I am trying to say that learning a language is like building a house, one brick at a time... but sometimes I forget where the bricks go.",
    },
    {
      id: "a-2",
      role: "assistant",
      tone: "hero",
      content: "That is a beautiful metaphor.",
    },
    {
      id: "a-3",
      role: "assistant",
      tone: "quote",
      content:
        "In Italian, we could say \"Passo dopo passo si fa la strada\" - which literally translates to \"step by step, the road is made.\" This mirrors your \"brick by brick\" sentiment perfectly.",
    },
    {
      id: "a-4",
      role: "assistant",
      tone: "hero",
      content: "Would you like to try translating your house metaphor into a simpler phrase?",
    },
  ];
}

export const TOOL_ACTIONS: ToolAction[] = [
  { key: "optimize", label: "Optimize", icon: "auto_fix_high", enabled: true },
  { key: "help", label: "Help", icon: "support_agent", enabled: true },
  { key: "vibe", label: "Vibe", icon: "theater_comedy", enabled: true },
  { key: "daily", label: "Daily", icon: "today", enabled: true },
];

export function commandForTool(tool: ToolAction["key"], draft: string): { input: string; display?: string } {
  const text = draft.trim();

  if (tool === "daily") {
    return { input: "/daily", display: "Daily practice" };
  }

  if (!text) {
    throw new Error("Please write something in the input box first.");
  }

  if (tool === "optimize") {
    return { input: `/optimize ${text}`, display: text };
  }

  if (tool === "help") {
    return { input: `/help ${text}`, display: text };
  }

  return { input: `/vibe ${text}`, display: text };
}
