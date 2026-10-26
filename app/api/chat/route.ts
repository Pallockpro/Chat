import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addTokens, findUserById, type ChatMessage } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_URL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com") + "/chat/completions";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-flash";
const SYSTEM_PROMPT =
  "You are Lumen, a thoughtful, warm and concise AI assistant. Use Markdown for formatting when it helps.";

const enc = new TextEncoder();
const line = (obj: unknown) => enc.encode(JSON.stringify(obj) + "\n");

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey)
    return NextResponse.json(
      { error: "Server is missing DEEPSEEK_API_KEY. Add it to .env.local." },
      { status: 500 }
    );

  const remaining = user.tokenLimit - user.tokensUsed;
  if (remaining <= 0)
    return NextResponse.json(
      { error: "You've used all of your tokens for this account.", used: user.tokensUsed, limit: user.tokenLimit },
      { status: 429 }
    );

  const body = await req.json().catch(() => null);
  const incoming: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : [];
  const messages = incoming
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
    .slice(-30)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 12000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user")
    return NextResponse.json({ error: "Send a message first." }, { status: 400 });

  const upstream = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      stream: true,
      stream_options: { include_usage: true },
      // never let one reply blow past what the account has left
      max_tokens: Math.max(64, Math.min(2048, remaining)),
    }),
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    let detail = "";
    if (upstream) detail = (await upstream.text().catch(() => "")).slice(0, 300);
    const status = upstream?.status === 402 ? "The DeepSeek account is out of balance (402)." : "DeepSeek request failed.";
    return NextResponse.json({ error: `${status} ${detail}`.trim() }, { status: 502 });
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = "";
      let totalTokens = 0;
      let sawUsage = false;
      let producedChars = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const raw of lines) {
            const l = raw.trim();
            if (!l.startsWith("data:")) continue;
            const data = l.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                producedChars += delta.length;
                controller.enqueue(line({ t: "delta", c: delta }));
              }
              if (json.usage?.total_tokens) {
                totalTokens = json.usage.total_tokens;
                sawUsage = true;
              }
            } catch {
              /* ignore partial JSON */
            }
          }
        }
      } catch {
        controller.enqueue(line({ t: "error", error: "Connection to the model was interrupted." }));
      } finally {
        // Prefer the provider's exact count; otherwise estimate (~4 chars/token).
        if (!sawUsage) {
          const promptChars = messages.reduce((n, m) => n + m.content.length, 0) + SYSTEM_PROMPT.length;
          totalTokens = Math.ceil((promptChars + producedChars) / 4);
        }
        const fresh = await findUserById(user.id);
        const result = fresh ? await addTokens(user.id, totalTokens) : null;
        controller.enqueue(
          line({
            t: "usage",
            charged: totalTokens,
            used: result?.used ?? user.tokensUsed + totalTokens,
            limit: result?.limit ?? user.tokenLimit,
          })
        );
        controller.close();
      }
    },
    cancel() {
      reader.cancel().catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
