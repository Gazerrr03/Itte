import { db } from "@/server/db";

export type EffectiveWebSetting = {
  streaming: boolean;
  model: string | null;
  ttsEnabled: boolean;
  autoReadAssistant: boolean;
  ttsEngine: "browser" | "cloud";
  ttsVoice: string | null;
  ttsRate: number;
  proactiveDailyEnabled: boolean;
};

export async function getWebSetting(): Promise<EffectiveWebSetting> {
  const row = await db.webSetting.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });

  return {
    streaming: row.streaming,
    model: row.model,
    ttsEnabled: row.ttsEnabled,
    autoReadAssistant: row.autoReadAssistant,
    ttsEngine: row.ttsEngine,
    ttsVoice: row.ttsVoice,
    ttsRate: row.ttsRate,
    proactiveDailyEnabled: row.proactiveDailyEnabled,
  };
}

export async function patchWebSetting(input: Partial<EffectiveWebSetting>): Promise<EffectiveWebSetting> {
  const row = await db.webSetting.upsert({
    where: { id: "default" },
    update: {
      streaming: input.streaming,
      model: input.model,
      ttsEnabled: input.ttsEnabled,
      autoReadAssistant: input.autoReadAssistant,
      ttsEngine: input.ttsEngine,
      ttsVoice: input.ttsVoice,
      ttsRate: input.ttsRate,
      proactiveDailyEnabled: input.proactiveDailyEnabled,
    },
    create: {
      id: "default",
      streaming: input.streaming ?? true,
      model: input.model ?? null,
      ttsEnabled: input.ttsEnabled ?? true,
      autoReadAssistant: input.autoReadAssistant ?? true,
      ttsEngine: input.ttsEngine ?? "browser",
      ttsVoice: input.ttsVoice ?? null,
      ttsRate: input.ttsRate ?? 1,
      proactiveDailyEnabled: input.proactiveDailyEnabled ?? true,
    },
  });

  return {
    streaming: row.streaming,
    model: row.model,
    ttsEnabled: row.ttsEnabled,
    autoReadAssistant: row.autoReadAssistant,
    ttsEngine: row.ttsEngine,
    ttsVoice: row.ttsVoice,
    ttsRate: row.ttsRate,
    proactiveDailyEnabled: row.proactiveDailyEnabled,
  };
}
