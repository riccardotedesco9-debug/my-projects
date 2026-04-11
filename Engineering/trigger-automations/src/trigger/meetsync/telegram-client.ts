// Telegram Bot API client — shared by all MeetSync tasks

import { logMessage } from "./d1-client.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";

// Reserved chat_ids for synthetic webhook tests (see meetsync/tools/send-telegram-update.sh).
// Outbound sends to these ids are intercepted and logged so Claude can test the full
// pipeline without a real Telegram account and without noisy "chat not found" Bot API errors.
// 10 reserved test ids — enough to run multi-persona concurrent stress tests.
const TEST_CHAT_IDS = new Set([
  "999999001", "999999002", "999999003", "999999004", "999999005",
  "999999006", "999999007", "999999008", "999999009", "999999010",
]);

function isTestChat(chatId: string): boolean {
  return TEST_CHAT_IDS.has(String(chatId));
}

function getConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return { token };
}

/**
 * Telegram inline keyboard — a 2D array of button rows. Each button's
 * `callback_data` is what the Worker will receive in the subsequent
 * `callback_query` update when the user taps it.
 */
export interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

/**
 * Common keyboards reused across scenarios. Kept minimal on purpose —
 * every additional variant is one more callback_data string the router
 * needs to recognize.
 */
export const yesNoKeyboard = (): InlineKeyboard => ({
  inline_keyboard: [[
    { text: "✓ Yes", callback_data: "confirm_schedule" },
    { text: "✗ No", callback_data: "reject_schedule" },
  ]],
});

/**
 * Send a plain text message to a Telegram chat.
 * Sends first, then logs to conversation_log — so a failed Telegram API call
 * doesn't create a "phantom" bot message in history that the user never saw.
 * Every task (schedule-parser, session-orchestrator, deliver-results,
 * message-router) contributes to the same persistent history, which is
 * critical for both the AI's context window and for synthetic-webhook tests
 * that read replies from D1.
 *
 * Optional `keyboard` attaches an inline keyboard via Telegram's
 * `reply_markup`. The Worker translates button taps into synthetic text
 * messages (e.g. "confirm_schedule" callback → text "yes") so the rest
 * of the router pipeline sees them as normal user input and doesn't
 * need a parallel callback-handling path.
 */
export async function sendTextMessage(
  chatId: string,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  if (isTestChat(chatId)) {
    // Test chats skip the real Bot API but still produce a log entry so
    // synthetic-webhook tests can read the intended reply back from D1.
    console.log(`[TEST] sendTextMessage chat_id=${chatId}:\n${text}`);
    await logMessage(chatId, "bot", text).catch((err) =>
      console.error("sendTextMessage: logMessage failed:", err)
    );
    return;
  }

  const { token } = getConfig();

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  };
  if (keyboard) body.reply_markup = keyboard;

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Telegram send failed (${response.status}): ${err}`);
  }

  // Only log AFTER a successful send so a failed API call doesn't leave a
  // phantom bot message in history that the user never actually saw.
  await logMessage(chatId, "bot", text).catch((err) =>
    console.error("sendTextMessage: logMessage failed:", err)
  );
}

/** Send a document/file via Telegram (e.g., .ics calendar file) */
export async function sendDocumentMessage(
  chatId: string,
  fileContent: string,
  filename: string,
  caption?: string
): Promise<void> {
  if (isTestChat(chatId)) {
    console.log(
      `[TEST] sendDocumentMessage chat_id=${chatId} filename=${filename}` +
        (caption ? ` caption=${caption}` : "") +
        `\n--- file (${fileContent.length} bytes) ---\n${fileContent.slice(0, 500)}${fileContent.length > 500 ? "…" : ""}`
    );
    return;
  }

  const { token } = getConfig();

  // Telegram accepts file upload in a single multipart request
  const formData = new FormData();
  formData.append("chat_id", chatId);
  const blob = new Blob([fileContent], { type: "text/calendar" });
  formData.append("document", blob, filename);
  if (caption) formData.append("caption", caption);

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendDocument`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Telegram document send failed (${response.status}): ${err}`);
  }
}

/**
 * Transcribe audio by POSTing to the Worker's /internal/transcribe endpoint.
 *
 * The Worker has Cloudflare's Workers AI runtime binding (env.AI) which is
 * implicitly authenticated — no API token scope required. Posting from
 * Trigger.dev to the Worker bypasses the bot's REST-token-missing-AI-scope
 * problem entirely.
 *
 * Auth: Bearer <TELEGRAM_BOT_TOKEN>. Both sides already have this token,
 * so no new env var needed. The Worker validates the header matches its
 * own env.TELEGRAM_BOT_TOKEN before running the model.
 */
export async function transcribeAudio(audioBuffer: ArrayBuffer): Promise<string> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const workerUrl =
    process.env.MEETSYNC_WORKER_URL ?? "https://meetsync-worker.riccardotedesco9.workers.dev";

  const response = await fetch(`${workerUrl}/internal/transcribe`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: audioBuffer,
  });

  const respText = await response.text();
  if (!response.ok) {
    throw new Error(`Worker /internal/transcribe HTTP ${response.status}: ${respText.slice(0, 400)}`);
  }

  let data: { ok?: boolean; text?: string; error?: string; model?: string };
  try {
    data = JSON.parse(respText);
  } catch {
    throw new Error(`Worker /internal/transcribe non-JSON response: ${respText.slice(0, 300)}`);
  }

  if (!data.ok || !data.text) {
    throw new Error(`Worker /internal/transcribe failed: ${data.error ?? respText.slice(0, 300)}`);
  }
  return data.text;
}

/** Download media from Telegram (returns the file as an ArrayBuffer + mime type) */
export async function downloadMedia(
  fileId: string
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const { token } = getConfig();

  // Step 1: Get file path from Telegram
  const fileResponse = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );

  if (!fileResponse.ok) {
    throw new Error(`Telegram getFile failed: ${fileResponse.status}`);
  }

  const fileData = (await fileResponse.json()) as {
    ok: boolean;
    result?: { file_path?: string; file_size?: number };
  };

  if (!fileData.ok || !fileData.result?.file_path) {
    throw new Error("Telegram getFile returned no file_path");
  }

  const filePath = fileData.result.file_path;

  // Reject files over 10MB to prevent OOM
  if (fileData.result.file_size && fileData.result.file_size > 10 * 1024 * 1024) {
    throw new Error("File too large (max 10MB)");
  }

  // Step 2: Download the actual file
  const downloadResponse = await fetch(
    `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`
  );

  if (!downloadResponse.ok) {
    throw new Error(`Telegram file download failed: ${downloadResponse.status}`);
  }

  // Infer mime type from file extension
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
  };

  return {
    buffer: await downloadResponse.arrayBuffer(),
    mimeType: mimeMap[ext] ?? "application/octet-stream",
  };
}
