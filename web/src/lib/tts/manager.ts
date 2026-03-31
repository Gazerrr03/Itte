import { ChatMessage } from "@/types/chat";

import { BrowserTTSProvider, CloudTTSProviderStub, isTTSCancelledError, type TTSEngine, type TTSProvider } from "./providers";

export type TTSManagerConfig = {
  ttsEnabled: boolean;
  autoReadAssistant: boolean;
  ttsEngine: TTSEngine;
  ttsVoice: string | null;
  ttsRate: number;
};

export type TTSManagerState = {
  isSpeaking: boolean;
  speakingMessageId: string | null;
  lastError: string | null;
  supported: boolean;
};

type SpeakOptions = {
  messageId?: string;
};

const defaultState: TTSManagerState = {
  isSpeaking: false,
  speakingMessageId: null,
  lastError: null,
  supported: true,
};

export class TTSManager {
  private readonly providers: Record<TTSEngine, TTSProvider> = {
    browser: new BrowserTTSProvider(),
    cloud: new CloudTTSProviderStub(),
  };
  private readonly listeners = new Set<(state: TTSManagerState) => void>();
  private readonly messageCache = new Map<string, string>();
  private provider: TTSProvider = this.providers.browser;
  private config: TTSManagerConfig = {
    ttsEnabled: true,
    autoReadAssistant: true,
    ttsEngine: "browser",
    ttsVoice: null,
    ttsRate: 1,
  };
  private state = defaultState;

  subscribe(listener: (state: TTSManagerState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState() {
    return this.state;
  }

  setConfig(config: TTSManagerConfig) {
    this.config = config;
    const nextProvider = this.providers[config.ttsEngine] ?? this.providers.browser;
    if (nextProvider.engine !== this.provider.engine) {
      this.stop();
      this.provider = nextProvider;
    }
    if (!config.ttsEnabled) {
      this.stop();
    }

    this.updateState({
      supported: this.provider.isSupported(),
      lastError: null,
    });
  }

  syncMessages(messages: ChatMessage[]) {
    this.messageCache.clear();
    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }
      const raw = (message.rawContent ?? message.content).trim();
      if (!raw) {
        continue;
      }
      this.messageCache.set(message.id, raw);
    }
  }

  async replay(messageId: string) {
    const text = this.messageCache.get(messageId);
    if (!text) {
      this.updateState({ lastError: "Message text is not available for replay." });
      return false;
    }
    return this.speak(text, { messageId });
  }

  async speak(text: string, options: SpeakOptions = {}) {
    if (!this.config.ttsEnabled) {
      this.updateState({ lastError: "Read aloud is turned off in settings." });
      return false;
    }

    if (!this.provider.isSupported()) {
      this.updateState({
        supported: false,
        lastError:
          this.provider.engine === "cloud"
            ? "Cloud TTS is not enabled in this milestone."
            : "Read aloud is unavailable in this browser.",
      });
      return false;
    }

    if (!text.trim()) {
      return false;
    }

    this.stop();
    this.updateState({
      isSpeaking: true,
      speakingMessageId: options.messageId ?? null,
      lastError: null,
      supported: true,
    });

    try {
      await this.provider.speak({
        text,
        voice: this.config.ttsVoice,
        rate: this.config.ttsRate,
      });
      this.updateState({
        isSpeaking: false,
        speakingMessageId: null,
      });
      return true;
    } catch (error) {
      if (isTTSCancelledError(error)) {
        this.updateState({
          isSpeaking: false,
          speakingMessageId: null,
        });
        return false;
      }

      const message = error instanceof Error ? error.message : "Failed to read aloud.";
      this.updateState({
        isSpeaking: false,
        speakingMessageId: null,
        lastError: message,
      });
      return false;
    }
  }

  stop() {
    this.provider.stop();
    this.updateState({
      isSpeaking: false,
      speakingMessageId: null,
    });
  }

  private updateState(partial: Partial<TTSManagerState>) {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

let singleton: TTSManager | null = null;

export function getTTSManager() {
  if (!singleton) {
    singleton = new TTSManager();
  }
  return singleton;
}
