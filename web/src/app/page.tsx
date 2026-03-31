"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { FooterBar } from "@/components/footer-bar";
import { MessageList } from "@/components/message-list";
import { SessionSidebar } from "@/components/session-sidebar";
import { SettingsPanel } from "@/components/settings-panel";
import { TopNav } from "@/components/top-nav";
import {
  createSession,
  deleteSession,
  endSession,
  fetchSessionDetail,
  fetchSessions,
  fetchSettings,
  patchSettings,
  pollProactiveDaily,
  renameSession,
  streamMessage,
  translateAssistantMessage,
} from "@/lib/web-api";
import { getDialogueTextFromBlocks } from "@/lib/assistant-output-spec";
import { formatAssistantText, getAssistantReadAloudText } from "@/lib/assistant-format";
import { getTTSManager, type TTSManagerState } from "@/lib/tts/manager";
import type { ChatMessage, MessageTranslationState, SessionListItem, ToolAction, WebSetting } from "@/types/chat";

const ZenInputPanel = dynamic(
  () => import("@/components/zen-input-panel").then((mod) => mod.ZenInputPanel),
  { ssr: false },
);

type PendingInput = {
  input: string;
  display?: string;
};

const DEFAULT_SETTING: WebSetting = {
  streaming: true,
  model: null,
  proactiveDailyEnabled: true,
  ttsEnabled: true,
  autoReadAssistant: true,
  ttsEngine: "browser",
  ttsVoice: null,
  ttsRate: 1,
};
const TRANSLATION_TARGET_LANG = "ZH";

const TOOL_COMMAND: Record<ToolAction["key"], string> = {
  optimize: "/optimize",
  help: "/help",
  vibe: "/vibe",
  daily: "/daily",
};

function toDisplayText(rawInput: string) {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith("/")) {
    return trimmed;
  }

  const [head] = trimmed.split(/\s+/, 1);
  const arg = trimmed.slice(head.length).trim();

  if ((head === "/optimize" || head === "/help" || head === "/vibe") && arg) {
    return arg;
  }

  if (head === "/daily") {
    return "Daily practice";
  }

  return trimmed;
}

function applyToolCommandToDraft(tool: ToolAction["key"], currentDraft: string) {
  const command = TOOL_COMMAND[tool];
  const trimmed = currentDraft.trim();

  if (!trimmed) {
    return tool === "daily" ? command : `${command} `;
  }

  const existingCommandMatch = trimmed.match(/^\/(optimize|help|vibe|daily)\b([\s\S]*)$/i);
  const existingPayload = existingCommandMatch ? existingCommandMatch[2].trim() : trimmed;

  if (tool === "daily") {
    return command;
  }

  return existingPayload ? `${command} ${existingPayload}` : `${command} `;
}

function hydrateMessages(messages: ChatMessage[]) {
  return messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    const rawContent = message.rawContent ?? message.content;
    if (message.blocks && message.blocks.length > 0) {
      return {
        ...message,
        rawContent,
        content: rawContent,
      };
    }

    const formatted = formatAssistantText(rawContent);
    return {
      ...message,
      rawContent,
      content: formatted.display,
    };
  });
}

function translationKey(sessionId: string, messageId: string) {
  return `${sessionId}:${messageId}:${TRANSLATION_TARGET_LANG}`;
}

function getWelcomeGreeting(date: Date) {
  const hour = date.getHours();

  if (hour >= 5 && hour < 11) {
    return "Good morning";
  }

  if (hour >= 11 && hour < 18) {
    return "Good afternoon";
  }

  return "Good evening";
}

export default function Home() {
  const ttsManager = useMemo(() => getTTSManager(), []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionEnded, setActiveSessionEnded] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [isBooting, setIsBooting] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setting, setSetting] = useState<WebSetting>(DEFAULT_SETTING);
  const [translations, setTranslations] = useState<Record<string, MessageTranslationState>>({});
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  const [ttsNotice, setTtsNotice] = useState<string | null>(null);
  const [retryPayload, setRetryPayload] = useState<PendingInput | null>(null);
  const [welcomeGreeting, setWelcomeGreeting] = useState("Welcome");
  const [ttsState, setTtsState] = useState<TTSManagerState>({
    isSpeaking: false,
    speakingMessageId: null,
    lastError: null,
    supported: true,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastAutoReadMessageIdRef = useRef<string | null>(null);

  const canSend = useMemo(
    () => Boolean(activeSessionId) && draft.trim().length > 0 && !isSending && !activeSessionEnded,
    [activeSessionEnded, activeSessionId, draft, isSending],
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setIsBooting(true);
      setPanelNotice(null);

      const [sessionResult, settingResult] = await Promise.allSettled([fetchSessions(), fetchSettings()]);
      if (cancelled) {
        return;
      }

      if (settingResult.status === "fulfilled") {
        setSetting(settingResult.value);
      }

      if (sessionResult.status === "rejected") {
        setPanelNotice(sessionResult.reason instanceof Error ? sessionResult.reason.message : "Failed to load sessions.");
        setIsBooting(false);
        return;
      }

      let nextSessions = sessionResult.value;
      if (nextSessions.length === 0) {
        try {
          const created = await createSession();
          nextSessions = [created];
        } catch (error) {
          if (!cancelled) {
            setPanelNotice(error instanceof Error ? error.message : "Failed to create initial session.");
          }
          setIsBooting(false);
          return;
        }
      }

      setSessions(nextSessions);
      const firstSession = nextSessions[0];
      setActiveSessionId(firstSession.id);

      try {
        const detail = await fetchSessionDetail(firstSession.id);
        if (!cancelled) {
          setMessages(hydrateMessages(detail.messages));
          setActiveSessionEnded(detail.status === "ENDED");
        }
      } catch (error) {
        if (!cancelled) {
          setPanelNotice(error instanceof Error ? error.message : "Failed to load messages.");
        }
      } finally {
        if (!cancelled) {
          setIsBooting(false);
        }
      }
    }

    bootstrap().catch((error) => {
      if (!cancelled) {
        setPanelNotice(error instanceof Error ? error.message : "Unexpected bootstrap error.");
        setIsBooting(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const updateGreeting = () => {
      setWelcomeGreeting(getWelcomeGreeting(new Date()));
    };

    updateGreeting();
    const timerId = window.setInterval(updateGreeting, 60_000);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = ttsManager.subscribe((state) => {
      setTtsState(state);
    });
    return () => {
      unsubscribe();
      ttsManager.stop();
    };
  }, [ttsManager]);

  useEffect(() => {
    ttsManager.setConfig({
      ttsEnabled: setting.ttsEnabled,
      autoReadAssistant: setting.autoReadAssistant,
      ttsEngine: setting.ttsEngine,
      ttsVoice: setting.ttsVoice,
      ttsRate: setting.ttsRate,
    });
  }, [setting, ttsManager]);

  useEffect(() => {
    ttsManager.syncMessages(messages);
  }, [messages, ttsManager]);

  useEffect(() => {
    if (!ttsState.lastError) {
      return;
    }
    setTtsNotice(ttsState.lastError);
  }, [ttsState.lastError]);

  const syncSessionView = async (sessionId: string) => {
    const [sessionList, detail] = await Promise.all([fetchSessions(), fetchSessionDetail(sessionId)]);
    setSessions(sessionList);
    setMessages(hydrateMessages(detail.messages));
    setActiveSessionEnded(detail.status === "ENDED");
    return detail;
  };

  const runProactivePoll = useCallback(async () => {
    try {
      const result = await pollProactiveDaily();
      if (!result.triggered || !result.session) {
        return;
      }

      const sessionList = await fetchSessions();
      setSessions(sessionList);

      const hasActiveConversation = Boolean(activeSessionId) && !activeSessionEnded;
      if (!hasActiveConversation) {
        setActiveSessionId(result.session.id);
        const detail = await fetchSessionDetail(result.session.id);
        setMessages(hydrateMessages(detail.messages));
        setActiveSessionEnded(detail.status === "ENDED");
      }

      setPanelNotice(
        result.skippedCount > 0
          ? "A proactive /daily topic is ready. Older offline triggers were compacted."
          : "A proactive /daily topic is ready in your session list.",
      );
    } catch {
      // Proactive polling should not block normal chat interactions.
    }
  }, [activeSessionEnded, activeSessionId]);

  useEffect(() => {
    if (isBooting) {
      return;
    }
    runProactivePoll().catch(() => null);
  }, [isBooting, runProactivePoll]);

  useEffect(() => {
    if (isBooting) {
      return;
    }

    const timerId = window.setInterval(() => {
      runProactivePoll().catch(() => null);
    }, 60_000);

    return () => window.clearInterval(timerId);
  }, [isBooting, runProactivePoll]);

  const sendToActiveSession = async (payload: PendingInput, options?: { clearDraft?: boolean }) => {
    if (!activeSessionId || isSending || activeSessionEnded) {
      return;
    }

    const clearDraft = options?.clearDraft ?? true;
    const userContent = payload.display?.trim() || toDisplayText(payload.input);
    const tempUserId = `u-temp-${Date.now()}`;
    const tempAssistantId = `a-temp-${Date.now()}`;

    if (clearDraft) {
      setDraft("");
    }

    setPanelNotice(null);
    setRetryPayload(null);
    ttsManager.stop();
    setIsSending(true);
    setMessages((previous) => [
      ...previous,
      { id: tempUserId, role: "user", content: userContent, tone: "reflection" },
      { id: tempAssistantId, role: "assistant", content: "", rawContent: "", tone: "standard", isThinking: true },
    ]);

    let streamed = "";

    try {
      await streamMessage({
        sessionId: activeSessionId,
        input: payload.input,
        display: userContent,
        onChunk: (chunk) => {
          streamed += chunk;
          setMessages((previous) =>
            previous.map((message) =>
              message.id === tempAssistantId && message.role === "assistant"
                ? (() => {
                    const nextRaw = `${message.rawContent ?? message.content}${chunk}`;
                    const formatted = formatAssistantText(nextRaw);
                    return {
                      ...message,
                      rawContent: nextRaw,
                      content: formatted.display,
                      isThinking: false,
                    };
                  })()
                : message,
            ),
          );
        },
      });

      const detail = await syncSessionView(activeSessionId);
      const latestAssistant = [...detail.messages]
        .reverse()
        .find((message) => message.role === "assistant" && (message.rawContent ?? message.content).trim().length > 0);

      if (
        setting.ttsEnabled &&
        setting.autoReadAssistant &&
        latestAssistant &&
        latestAssistant.id !== lastAutoReadMessageIdRef.current
      ) {
        const hasStructuredBlocks = Array.isArray(latestAssistant.blocks) && latestAssistant.blocks.length > 0;
        const readAloudText = hasStructuredBlocks
          ? getDialogueTextFromBlocks(latestAssistant.blocks)
          : getAssistantReadAloudText(latestAssistant.rawContent ?? latestAssistant.content);
        if (readAloudText) {
          lastAutoReadMessageIdRef.current = latestAssistant.id;
          await ttsManager.speak(readAloudText, {
            messageId: latestAssistant.id,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message failed.";

      if (!streamed) {
        setMessages((previous) =>
          previous.map((entry) =>
            entry.id === tempAssistantId
              ? {
                  ...entry,
                  content: `[Error] ${message}`,
                  rawContent: `[Error] ${message}`,
                  tone: "standard",
                  isThinking: false,
                }
              : entry,
          ),
        );
      }

      setPanelNotice(message);
      setRetryPayload(payload);
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSend) {
      return;
    }

    const input = draft.trim();
    await sendToActiveSession({ input, display: toDisplayText(input) });
  };

  const handleToolClick = (key: ToolAction["key"]) => {
    if (isSending || activeSessionEnded) {
      return;
    }

    setPanelNotice(null);
    setDraft((previous) => applyToolCommandToDraft(key, previous));
  };

  const handleCreateSession = async () => {
    if (isSending || isEndingSession) {
      return;
    }

    try {
      ttsManager.stop();
      const session = await createSession();
      lastAutoReadMessageIdRef.current = null;
      setSessions((previous) => [session, ...previous]);
      setActiveSessionId(session.id);
      setMessages([]);
      setActiveSessionEnded(false);
      setRetryPayload(null);
      setSidebarOpen(false);
      setPanelNotice(null);
    } catch (error) {
      setPanelNotice(error instanceof Error ? error.message : "Failed to create session.");
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    if (isSending || isEndingSession) {
      setPanelNotice("Please wait for the current response to finish.");
      return;
    }

    ttsManager.stop();
    lastAutoReadMessageIdRef.current = null;
    setActiveSessionId(sessionId);
    setSidebarOpen(false);
    setPanelNotice(null);
    setRetryPayload(null);

    try {
      const detail = await fetchSessionDetail(sessionId);
      setMessages(hydrateMessages(detail.messages));
      setActiveSessionEnded(detail.status === "ENDED");
    } catch (error) {
      setPanelNotice(error instanceof Error ? error.message : "Failed to switch session.");
    }
  };

  const handleRenameSession = async (sessionId: string) => {
    const current = sessions.find((entry) => entry.id === sessionId);
    const nextTitle = window.prompt("Rename session", current?.title ?? "");

    if (nextTitle === null) {
      return;
    }

    try {
      const updated = await renameSession(sessionId, nextTitle);
      setSessions((previous) => previous.map((entry) => (entry.id === sessionId ? updated : entry)));
      setPanelNotice(null);
    } catch (error) {
      setPanelNotice(error instanceof Error ? error.message : "Failed to rename session.");
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (isSending || isEndingSession) {
      setPanelNotice("Please wait for the current response to finish.");
      return;
    }

    const confirmed = window.confirm("Delete this session? This cannot be undone.");
    if (!confirmed) {
      return;
    }

    try {
      if (activeSessionId === sessionId) {
        ttsManager.stop();
      }
      await deleteSession(sessionId);
      const nextSessions = sessions.filter((entry) => entry.id !== sessionId);
      setSessions(nextSessions);

      if (activeSessionId !== sessionId) {
        return;
      }

      if (nextSessions.length === 0) {
        const created = await createSession();
        lastAutoReadMessageIdRef.current = null;
        setSessions([created]);
        setActiveSessionId(created.id);
        setMessages([]);
        setActiveSessionEnded(false);
        setRetryPayload(null);
        return;
      }

      const fallback = nextSessions[0];
      setActiveSessionId(fallback.id);
      const detail = await fetchSessionDetail(fallback.id);
      setMessages(hydrateMessages(detail.messages));
      setActiveSessionEnded(detail.status === "ENDED");
    } catch (error) {
      setPanelNotice(error instanceof Error ? error.message : "Failed to delete session.");
    }
  };

  const handleChangeSetting = async (next: WebSetting) => {
    const previous = setting;
    setSetting(next);
    setPanelNotice(null);
    setTtsNotice(null);

    try {
      const saved = await patchSettings(next);
      setSetting(saved);
    } catch (error) {
      setSetting(previous);
      setPanelNotice(error instanceof Error ? error.message : "Failed to save settings.");
    }
  };

  const handleToggleTranslation = async (messageId: string) => {
    if (!activeSessionId) {
      return;
    }

    const key = translationKey(activeSessionId, messageId);
    const current = translations[key];

    if (current?.loading) {
      return;
    }

    if (current?.text) {
      setTranslations((previous) => ({
        ...previous,
        [key]: {
          ...current,
          expanded: !current.expanded,
          error: null,
        },
      }));
      return;
    }

    setTranslations((previous) => ({
      ...previous,
      [key]: {
        text: null,
        sections: [],
        expanded: true,
        loading: true,
        error: null,
      },
    }));

    try {
      const result = await translateAssistantMessage({ sessionId: activeSessionId, messageId });
      setTranslations((previous) => ({
        ...previous,
        [key]: {
          text: result.translation,
          sections: result.sections,
          expanded: true,
          loading: false,
          error: null,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Translation failed.";
      setTranslations((previous) => ({
        ...previous,
        [key]: {
          text: null,
          sections: [],
          expanded: false,
          loading: false,
          error: message,
        },
      }));
    }
  };

  const handleEndSession = async () => {
    if (!activeSessionId || activeSessionEnded || isEndingSession || isSending) {
      return;
    }

    const confirmed = window.confirm("End this session now?");
    if (!confirmed) {
      return;
    }

    setIsEndingSession(true);
    setPanelNotice(null);
    ttsManager.stop();
    lastAutoReadMessageIdRef.current = null;

    try {
      await endSession(activeSessionId);
      await syncSessionView(activeSessionId);
    } catch (error) {
      setPanelNotice(error instanceof Error ? error.message : "Failed to end session.");
    } finally {
      setIsEndingSession(false);
    }
  };

  const handleReadAloud = async (messageId: string) => {
    if (ttsState.isSpeaking && ttsState.speakingMessageId === messageId) {
      ttsManager.stop();
      return;
    }

    setTtsNotice(null);
    const ok = await ttsManager.replay(messageId);
    if (!ok) {
      const latestError = ttsManager.getState().lastError;
      if (latestError) {
        setTtsNotice(latestError);
      }
    }
  };

  return (
    <>
      <TopNav
        onEndSession={() => {
          void handleEndSession();
        }}
        onOpenMenu={() => setSidebarOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        sessionEnded={!activeSessionId || activeSessionEnded || isEndingSession || isSending}
      />

      <SessionSidebar
        activeSessionId={activeSessionId}
        onClose={() => setSidebarOpen(false)}
        onCreateSession={() => {
          void handleCreateSession();
        }}
        onDeleteSession={(id) => {
          void handleDeleteSession(id);
        }}
        onRenameSession={(id) => {
          void handleRenameSession(id);
        }}
        onSelectSession={(id) => {
          void handleSelectSession(id);
        }}
        open={sidebarOpen}
        sessions={sessions}
      />

      <SettingsPanel
        onChange={(next) => {
          void handleChangeSetting(next);
        }}
        onClose={() => setSettingsOpen(false)}
        open={settingsOpen}
        setting={setting}
      />

      <div className="flex h-screen overflow-hidden bg-background">
        <main className="relative flex flex-1 flex-col overflow-hidden bg-background">
          <div
            ref={scrollRef}
            className="hide-scrollbar flex flex-1 flex-col items-center overflow-y-auto px-6 py-32 md:px-0"
          >
            {isBooting ? (
              <div className="rounded-2xl border border-outline/10 bg-white/60 px-6 py-4 text-sm text-outline/70">
                Loading your sessions...
              </div>
            ) : messages.length === 0 ? (
              <div className="flex min-h-[48vh] w-full max-w-3xl items-center justify-center px-6">
                <div className="text-center">
                  <p className="text-[clamp(2.2rem,5vw,3.6rem)] font-light tracking-[0.02em] text-primary/75">
                    {welcomeGreeting},
                  </p>
                  <p className="mt-2 text-xs tracking-[0.24em] text-outline/70 uppercase">Welcome to Itte</p>
                </div>
              </div>
            ) : (
              <MessageList
                activeSessionId={activeSessionId}
                onReadAloud={(messageId) => {
                  void handleReadAloud(messageId);
                }}
                messages={messages}
                onToggleTranslation={(messageId) => {
                  void handleToggleTranslation(messageId);
                }}
                speakingMessageId={ttsState.speakingMessageId}
                translations={translations}
              />
            )}
          </div>

          {panelNotice ? (
            <div className="mx-auto mb-4 w-full max-w-4xl px-6 text-xs tracking-wide text-red-600">
              {panelNotice}
              {retryPayload ? (
                <button
                  className="ml-3 rounded-full border border-red-300/80 px-3 py-1 text-[10px] font-semibold tracking-[0.14em] uppercase transition hover:bg-red-50"
                  disabled={isSending || activeSessionEnded}
                  onClick={() => {
                    void sendToActiveSession(retryPayload, { clearDraft: false });
                  }}
                  type="button"
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}

          {!panelNotice && ttsNotice ? (
            <div className="mx-auto mb-4 w-full max-w-4xl px-6 text-xs tracking-wide text-outline/75">{ttsNotice}</div>
          ) : null}

          <ZenInputPanel
            isSending={isSending || activeSessionEnded}
            onChange={setDraft}
            onSubmit={() => {
              void handleSubmit();
            }}
            onToolClick={(key) => {
              handleToolClick(key);
            }}
            value={draft}
          />
        </main>
      </div>

      <FooterBar />
    </>
  );
}
