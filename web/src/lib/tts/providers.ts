export type TTSEngine = "browser" | "cloud";

export type TTSRequest = {
  text: string;
  voice: string | null;
  rate: number;
};

export type TTSProvider = {
  readonly engine: TTSEngine;
  isSupported: () => boolean;
  speak: (request: TTSRequest) => Promise<void>;
  stop: () => void;
};

class TTSCancelledError extends Error {
  constructor() {
    super("tts_cancelled");
    this.name = "TTSCancelledError";
  }
}

function clampRate(rate: number) {
  if (!Number.isFinite(rate)) {
    return 1;
  }
  return Math.min(2, Math.max(0.5, rate));
}

function splitSpeechText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const sentences = normalized.match(/[^.!?]+[.!?]?/g) ?? [normalized];
  const chunks: string[] = [];
  let buffer = "";

  for (const sentence of sentences) {
    const unit = sentence.trim();
    if (!unit) {
      continue;
    }

    if (!buffer) {
      buffer = unit;
      continue;
    }

    if (buffer.length + 1 + unit.length <= 220) {
      buffer = `${buffer} ${unit}`;
      continue;
    }

    chunks.push(buffer);
    buffer = unit;
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks;
}

export class BrowserTTSProvider implements TTSProvider {
  readonly engine: TTSEngine = "browser";
  private token = 0;

  isSupported() {
    return (
      typeof window !== "undefined" &&
      typeof window.speechSynthesis !== "undefined" &&
      typeof window.SpeechSynthesisUtterance !== "undefined"
    );
  }

  stop() {
    this.token += 1;
    if (!this.isSupported()) {
      return;
    }
    window.speechSynthesis.cancel();
  }

  async speak(request: TTSRequest): Promise<void> {
    if (!this.isSupported()) {
      throw new Error("Browser speech synthesis is unavailable.");
    }

    const synth = window.speechSynthesis;
    this.stop();
    const token = this.token;
    const chunks = splitSpeechText(request.text);
    if (chunks.length === 0) {
      return;
    }

    const voices = synth.getVoices();
    const targetVoice = request.voice
      ? voices.find((voice) => voice.name.toLowerCase() === request.voice!.toLowerCase()) ?? null
      : null;
    const rate = clampRate(request.rate);

    await new Promise<void>((resolve, reject) => {
      let index = 0;

      const playNext = () => {
        if (token !== this.token) {
          reject(new TTSCancelledError());
          return;
        }

        if (index >= chunks.length) {
          resolve();
          return;
        }

        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        utterance.rate = rate;
        if (targetVoice) {
          utterance.voice = targetVoice;
          utterance.lang = targetVoice.lang;
        }

        utterance.onend = () => {
          index += 1;
          playNext();
        };
        utterance.onerror = (event) => {
          if (token !== this.token) {
            reject(new TTSCancelledError());
            return;
          }
          reject(new Error(event.error || "Failed to speak the message."));
        };

        synth.speak(utterance);
      };

      playNext();
    });
  }
}

export class CloudTTSProviderStub implements TTSProvider {
  readonly engine: TTSEngine = "cloud";

  isSupported() {
    return false;
  }

  stop() {}

  async speak(): Promise<void> {
    throw new Error("Cloud TTS is not enabled in this milestone.");
  }
}

export function isTTSCancelledError(error: unknown) {
  return error instanceof TTSCancelledError;
}
