import { NextResponse } from "next/server";

import { sessionProcessManager } from "@/server/session-process-manager";
import { deleteSession, getSession, renameSession } from "@/server/services/session-service";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await getSession(id);

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  return NextResponse.json({ session });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const body = (await request.json()) as { title?: string };
    if (typeof body.title !== "string") {
      return NextResponse.json({ error: "title is required." }, { status: 400 });
    }

    const session = await renameSession(id, body.title);
    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to rename session.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    sessionProcessManager.disposeSession(id);
    await deleteSession(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete session." }, { status: 400 });
  }
}
