// Internal transcription endpoint — POST /internal/transcribe
//
// Called by the Trigger.dev turn handler when the user sends a Telegram
// voice note. Uses the Worker's runtime AI binding (env.AI) which has
// implicit auth — no Cloudflare API token required, bypassing the
// missing-Workers-AI-scope problem on the bot's REST token.
//
// Auth: shared secret. Trigger.dev sends `Authorization: Bearer <bot_token>`
// using TELEGRAM_BOT_TOKEN, which both sides already have. The Worker
// validates the header matches its own bot token before transcribing —
// stops random hits from the public internet from burning AI quota.
//
// Request: raw audio bytes in the body, Content-Type: application/octet-stream
// Response: { ok: true, text: "<transcript>" } | { ok: false, error: "<msg>" }

import type { Env } from "./types.js";

export async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  // 1. Validate auth — must match the bot token both sides already share.
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.TELEGRAM_BOT_TOKEN}`;
  if (!constantTimeEqual(auth, expected)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "POST only" });
  }

  // 2. Read audio bytes
  let audioBuffer: ArrayBuffer;
  try {
    audioBuffer = await request.arrayBuffer();
  } catch (err) {
    return jsonResponse(400, { ok: false, error: `Failed to read body: ${String(err)}` });
  }
  if (audioBuffer.byteLength === 0) {
    return jsonResponse(400, { ok: false, error: "Empty audio body" });
  }

  // 3. Run Whisper via the runtime binding. Try v3-turbo first (modern,
  // accurate, handles Telegram OGG/Opus reliably), fall back to legacy
  // whisper if the account doesn't have v3 access.
  const audioBytes = [...new Uint8Array(audioBuffer)];

  const tryRun = async (modelId: string): Promise<{ text?: string; error?: string }> => {
    try {
      const result = await env.AI.run(modelId, { audio: audioBytes });
      const text = result?.text?.trim() ?? "";
      if (!text) return { error: `[${modelId}] empty transcript` };
      return { text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `[${modelId}] ${msg.slice(0, 300)}` };
    }
  };

  const errors: string[] = [];

  const v3 = await tryRun("@cf/openai/whisper-large-v3-turbo");
  if (v3.text) return jsonResponse(200, { ok: true, text: v3.text, model: "whisper-large-v3-turbo" });
  if (v3.error) errors.push(v3.error);

  const legacy = await tryRun("@cf/openai/whisper");
  if (legacy.text) return jsonResponse(200, { ok: true, text: legacy.text, model: "whisper" });
  if (legacy.error) errors.push(legacy.error);

  return jsonResponse(502, { ok: false, error: `All Whisper models failed. ${errors.join(" || ")}` });
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
