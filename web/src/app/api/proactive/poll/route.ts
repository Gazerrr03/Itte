import { NextResponse } from "next/server";

import { pollProactiveForClient } from "@/server/services/proactive-daily-service";

export async function POST() {
  try {
    const result = await pollProactiveForClient();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to poll proactive daily.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
