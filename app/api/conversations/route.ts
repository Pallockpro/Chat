import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteConversation, upsertConversation, type ChatMessage } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string" || !Array.isArray(body.messages))
    return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const messages: ChatMessage[] = body.messages
    .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 20000) }))
    .slice(-200);

  await upsertConversation(user.id, {
    id: body.id.slice(0, 64),
    title: String(body.title || "New chat").slice(0, 80),
    messages,
    updatedAt: Date.now(),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  await deleteConversation(user.id, id);
  return NextResponse.json({ ok: true });
}
