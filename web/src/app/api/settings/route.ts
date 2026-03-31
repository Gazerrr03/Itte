import { NextResponse } from "next/server";

import { getWebSetting, patchWebSetting } from "@/server/services/settings-service";

export async function GET() {
  const setting = await getWebSetting();
  return NextResponse.json({ setting });
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      streaming?: boolean;
      model?: string | null;
      ttsEnabled?: boolean;
      autoReadAssistant?: boolean;
      ttsEngine?: "browser" | "cloud";
      ttsVoice?: string | null;
      ttsRate?: number;
      proactiveDailyEnabled?: boolean;
    };

    const normalizedRate =
      typeof body.ttsRate === "number" && Number.isFinite(body.ttsRate)
        ? Math.min(2, Math.max(0.5, body.ttsRate))
        : undefined;

    const setting = await patchWebSetting({
      streaming: typeof body.streaming === "boolean" ? body.streaming : undefined,
      model: typeof body.model === "string" || body.model === null ? body.model : undefined,
      ttsEnabled: typeof body.ttsEnabled === "boolean" ? body.ttsEnabled : undefined,
      autoReadAssistant: typeof body.autoReadAssistant === "boolean" ? body.autoReadAssistant : undefined,
      ttsEngine: body.ttsEngine === "browser" || body.ttsEngine === "cloud" ? body.ttsEngine : undefined,
      ttsVoice: typeof body.ttsVoice === "string" || body.ttsVoice === null ? body.ttsVoice : undefined,
      ttsRate: normalizedRate,
      proactiveDailyEnabled: typeof body.proactiveDailyEnabled === "boolean" ? body.proactiveDailyEnabled : undefined,
    });

    return NextResponse.json({ setting });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update settings.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
