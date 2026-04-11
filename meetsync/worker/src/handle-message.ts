// Parse Telegram webhook update and trigger Trigger.dev tasks

import type { Env, TelegramUpdate, TelegramMessage, TelegramCallbackQuery } from "./types.js";
import type { MessageRouterPayload } from "../../shared/types.js";
import { checkRateLimit, isBlocked } from "./rate-limit.js";

/**
 * Callback-data string (sent with inline-keyboard buttons) → synthetic
 * text the user "typed". Keeps the router pipeline unchanged: button
 * taps look like regular text messages to the intent classifier.
 * Extend this table when adding new keyboards — if a callback_data
 * isn't mapped, we fall through with the raw data string as the text.
 */
const CALLBACK_DATA_TO_TEXT: Record<string, string> = {
  confirm_schedule: "yes",
  reject_schedule: "no",
};

/**
 * Extract message from Telegram update and trigger Trigger.dev task.
 * Returns immediately — Telegram requires fast ack to avoid retries.
 */
export async function handleMessage(update: TelegramUpdate, env: Env): Promise<void> {
  // Round-9: inline-keyboard support. Telegram delivers button taps as
  // `callback_query` updates, not `message` updates. We translate the
  // callback_data into a synthetic text message representing what the
  // button click meant ("yes" / "no" / etc.) and feed it through the
  // normal pipeline. We also answer the callback query synchronously
  // so the spinner on the button goes away; without this the button
  // shows "loading" until the 60s Telegram timeout.
  if (update.callback_query) {
    await answerCallbackQuery(env, update.callback_query.id);
    const synthesized = synthesizeFromCallback(update.callback_query);
    if (!synthesized) return;
    // Use callback_query.id as the idempotency bucket — it's globally
    // unique per tap. The inline-keyboard message may be re-used across
    // many taps (users can tap the same button multiple times), so the
    // attached message.message_id is NOT unique and would collide in
    // Trigger.dev's dedup, silently dropping subsequent runs. Found the
    // hard way when scenario-03 passed the first run and hung on every
    // subsequent run because my synthetic callback hardcoded message_id=1.
    await routeExtractedPayload(synthesized, env, `cb-${update.callback_query.id}`);
    return;
  }

  const msg = update.message;
  if (!msg) return;

  const routerPayload = extractPayload(msg);
  if (!routerPayload) return;
  await routeExtractedPayload(routerPayload, env, `msg-${msg.message_id}`);
}

/**
 * Shared "post-extraction" pipeline — admin check, blocklist, rate
 * limit, pre-log to conversation_log, fire the trigger.dev task.
 * Extracted from handleMessage so both the normal message path and
 * the callback_query path can share it without duplication.
 */
async function routeExtractedPayload(
  routerPayload: MessageRouterPayload,
  env: Env,
  // Globally-unique idempotency bucket for this inbound event. Prefixed
  // with "msg-" for regular text messages (msg.message_id) or "cb-" for
  // callback_query taps (cq.id). Must be unique per event or Trigger.dev
  // will dedup and silently drop repeats.
  idempotencyBucket: string,
): Promise<void> {

  // Admin commands — only the admin chat ID can run these
  if (env.ADMIN_CHAT_ID && routerPayload.chat_id === env.ADMIN_CHAT_ID && routerPayload.text) {
    const handled = await handleAdminCommand(routerPayload.text, env);
    if (handled) return;
  }

  // Blocklist check — silently drop messages from blocked users
  if (await isBlocked(routerPayload.chat_id, env)) {
    console.warn(`Blocked: ${routerPayload.chat_id}`);
    return;
  }

  // Rate limit with escalating cooldowns
  const { status: rateStatus, cooldownMinutes } = await checkRateLimit(routerPayload.chat_id, env);
  if (rateStatus === "cooldown") {
    console.warn(`Cooldown: ${routerPayload.chat_id} (${cooldownMinutes}min)`);
    await sendReply(env, routerPayload.chat_id,
      `You've been sending too many messages. You're on a ${cooldownMinutes}-minute timeout. Try again later.`
    );
    return;
  }
  if (rateStatus === "warning") {
    await sendReply(env, routerPayload.chat_id,
      "Heads up — you're close to the message limit. Slow down or you'll get a timeout."
    );
  }

  // Pre-log user text to conversation_log HERE at the Worker (rather than inside
  // the Trigger.dev task). Reason: rapid-fire bursts spawn parallel task runs that
  // used to boot with multi-second stagger, so the in-task "bail if newer" guard
  // couldn't reliably see sibling user-msg rows. Worker-side inserts all land within
  // a few hundred ms of each other (parallel HTTP handlers hitting D1 directly),
  // so by the time any task starts, every sibling's row is already committed and
  // the bail guard works with a ~1s sleep instead of 3+.
  let logId: number | undefined;
  if (routerPayload.message_type === "text" && routerPayload.text) {
    try {
      const trimmed = routerPayload.text.slice(0, 500);
      const insert = await env.DB.prepare(
        "INSERT INTO conversation_log (chat_id, role, message) VALUES (?, 'user', ?)"
      ).bind(routerPayload.chat_id, trimmed).run();
      const rawId = insert.meta.last_row_id;
      if (typeof rawId === "number") logId = rawId;
    } catch (err) {
      console.error("Worker pre-log failed:", err);
      // Fall through — task will log inline as fallback
    }
  } else if (routerPayload.message_type !== "text") {
    // Log non-text uploads as a synthetic user message so they're visible in
    // conversation_log for debugging. Without this, media uploads are invisible —
    // the bot's reply shows up but nothing indicates the user sent an image/PDF.
    // The stored message includes the file_id so we can re-download via the
    // Telegram Bot API if we need to re-inspect what the user actually sent.
    try {
      const label = routerPayload.message_type === "image"
        ? `[photo uploaded · file_id=${routerPayload.media_id ?? "?"}]`
        : routerPayload.message_type === "document"
        ? `[document uploaded · mime=${routerPayload.mime_type ?? "?"} · file_id=${routerPayload.media_id ?? "?"}]`
        : routerPayload.message_type === "audio"
        ? `[voice message · file_id=${routerPayload.media_id ?? "?"}]`
        : routerPayload.message_type === "contact"
        ? `[contact shared · phone=${routerPayload.contact_phone ?? "?"}]`
        : `[${routerPayload.message_type} upload]`;
      await env.DB.prepare(
        "INSERT INTO conversation_log (chat_id, role, message) VALUES (?, 'user', ?)"
      ).bind(routerPayload.chat_id, label).run();
    } catch (err) {
      console.error("Worker media-log failed:", err);
    }
  }

  await triggerMessageRouter({ ...routerPayload, log_id: logId }, env, idempotencyBucket);
}

/**
 * Build a MessageRouterPayload from a callback_query. The `data`
 * field is translated via CALLBACK_DATA_TO_TEXT so e.g. a tap on a
 * button with callback_data "confirm_schedule" produces a synthetic
 * text message "yes" — which the existing intent classifier already
 * recognizes without any new router branches.
 *
 * Security note (round-10 code review C1): we use `cq.from.id` as
 * the chat_id, NOT `cq.message.chat.id`. This is intentional — the
 * message the button was attached to was sent BY the bot, so its
 * chat.id and the tapping user's from.id are the same for private
 * chats (MeetSync is private-only). In a group chat they'd differ,
 * and using message.chat.id would let one user spoof another; we
 * correctly trust the tapper's from.id instead. The `data` payload
 * is trusted only because the bot sent it — Telegram guarantees
 * button data is round-tripped from the original reply_markup, not
 * forgeable by the client.
 */
function synthesizeFromCallback(cq: TelegramCallbackQuery): MessageRouterPayload | null {
  if (!cq.data) return null;
  const text = CALLBACK_DATA_TO_TEXT[cq.data] ?? cq.data;
  return {
    chat_id: String(cq.from.id),
    message_type: "text",
    text,
    timestamp: new Date().toISOString(),
    telegram_language_code: cq.from.language_code,
  };
}

/**
 * Dismiss the loading spinner on a tapped inline-keyboard button.
 * Telegram requires every callback_query be answered within 60s or
 * the button shows "loading" forever; we don't attach any visible
 * text or alert — just the acknowledgment.
 */
async function answerCallbackQuery(env: Env, callbackQueryId: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  } catch (err) {
    console.warn("answerCallbackQuery failed:", err);
  }
}

// --- Admin commands (only admin chat ID, classified by Claude Haiku) ---

interface AdminIntent {
  action: "block" | "unblock" | "list_blocked" | "list_users" | "not_admin";
  chat_id?: string;
}

async function handleAdminCommand(text: string, env: Env): Promise<boolean> {
  const intent = await classifyAdminIntent(text, env);

  if (intent.action === "not_admin") return false;

  if (intent.action === "block" && intent.chat_id) {
    const targetId = intent.chat_id.replace(/[^0-9-]/g, "");
    if (!targetId || targetId.length < 3) {
      await sendAdminReply(env, "Invalid chat ID. Use a numeric Telegram chat ID.");
      return true;
    }
    await env.DB.prepare(
      "INSERT OR IGNORE INTO blocked_users (chat_id) VALUES (?)"
    ).bind(targetId).run();
    await sendAdminReply(env, `Done — blocked *${targetId}*. They won't be able to use the bot anymore.`);
    return true;
  }

  if (intent.action === "unblock" && intent.chat_id) {
    const targetId = intent.chat_id.replace(/[^0-9-]/g, "");
    if (!targetId || targetId.length < 3) {
      await sendAdminReply(env, "Invalid chat ID. Use a numeric Telegram chat ID.");
      return true;
    }
    await env.DB.prepare(
      "DELETE FROM blocked_users WHERE chat_id = ?"
    ).bind(targetId).run();
    await sendAdminReply(env, `Done — unblocked *${targetId}*. They can use the bot again.`);
    return true;
  }

  if (intent.action === "list_blocked") {
    const result = await env.DB.prepare(
      "SELECT chat_id, blocked_at FROM blocked_users ORDER BY blocked_at DESC"
    ).all<{ chat_id: string; blocked_at: string }>();

    if (!result.results.length) {
      await sendAdminReply(env, "Nobody is blocked right now.");
    } else {
      const list = result.results.map((r) => `- ${r.chat_id} (since ${r.blocked_at})`).join("\n");
      await sendAdminReply(env, `*Blocked users:*\n${list}`);
    }
    return true;
  }

  if (intent.action === "list_users") {
    const result = await env.DB.prepare(
      "SELECT DISTINCT chat_id FROM participants ORDER BY created_at DESC LIMIT 50"
    ).all<{ chat_id: string }>();

    if (!result.results.length) {
      await sendAdminReply(env, "No users yet.");
    } else {
      const list = result.results.map((r) => `- ${r.chat_id}`).join("\n");
      await sendAdminReply(env, `*Users (${result.results.length}):*\n${list}`);
    }
    return true;
  }

  return false;
}

async function classifyAdminIntent(text: string, env: Env): Promise<AdminIntent> {
  // Fast-path: if no obvious admin keywords, skip the API call
  const lower = text.toLowerCase();
  const adminKeywords = ["block", "unblock", "remove", "ban", "kick", "who", "users", "list", "allowed"];
  if (!adminKeywords.some((k) => lower.includes(k))) {
    return { action: "not_admin" };
  }

  try {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return { action: "not_admin" };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        system: `You classify admin commands for a Telegram bot. Return ONLY JSON.
Actions: "block" (ban a user, needs chat_id), "unblock" (unban, needs chat_id), "list_blocked" (show blocked), "list_users" (show all users), "not_admin" (not an admin command).
Extract chat IDs (numeric) from the message if present.
Return: { "action": "...", "chat_id": "..." }`,
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!response.ok) return { action: "not_admin" };

    const data = (await response.json()) as { content: Array<{ type: string; text?: string }> };
    const textBlock = data.content.find((b) => b.type === "text")?.text?.trim();
    if (!textBlock) return { action: "not_admin" };

    const parsed = JSON.parse(textBlock.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
    return parsed as AdminIntent;
  } catch {
    return { action: "not_admin" };
  }
}

// Reserved fake chat_ids used for synthetic webhook tests (mirrors TEST_CHAT_IDS in
// Engineering/trigger-automations/src/trigger/meetsync/telegram-client.ts).
// Worker-level replies to these ids (admin messages, rate-limit notifications) are
// logged instead of sent to the real Telegram Bot API.
const TEST_CHAT_IDS = new Set([
  "999999001", "999999002", "999999003", "999999004", "999999005",
  "999999006", "999999007", "999999008", "999999009", "999999010",
]);

async function sendReply(env: Env, chatId: string, text: string): Promise<void> {
  if (TEST_CHAT_IDS.has(String(chatId))) {
    console.log(`[TEST] worker sendReply chat_id=${chatId}:\n${text}`);
    return;
  }
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

async function sendAdminReply(env: Env, text: string): Promise<void> {
  await sendReply(env, env.ADMIN_CHAT_ID, text);
}

function extractPayload(msg: TelegramMessage): MessageRouterPayload | null {
  const chatId = String(msg.chat.id);
  const timestamp = new Date(msg.date * 1000).toISOString();
  // Telegram populates `from.language_code` on almost every message (it's
  // the client UI language). Forward it so the router can guess a
  // timezone for first-time users.
  const telegram_language_code = msg.from?.language_code;

  // Text message
  if (msg.text) {
    return {
      chat_id: chatId,
      message_type: "text",
      text: msg.text.trim(),
      timestamp,
      telegram_language_code,
    };
  }

  // Photo — use last element (highest resolution)
  if (msg.photo?.length) {
    const photo = msg.photo[msg.photo.length - 1];
    return {
      chat_id: chatId,
      message_type: "image",
      media_id: photo.file_id,
      mime_type: "image/jpeg", // Telegram photos are always JPEG
      timestamp,
      telegram_language_code,
    };
  }

  // Document (PDF, etc.)
  if (msg.document) {
    return {
      chat_id: chatId,
      message_type: "document",
      media_id: msg.document.file_id,
      mime_type: msg.document.mime_type ?? "application/octet-stream",
      timestamp,
      telegram_language_code,
    };
  }

  // Voice message
  if (msg.voice) {
    return {
      chat_id: chatId,
      message_type: "audio",
      media_id: msg.voice.file_id,
      mime_type: msg.voice.mime_type ?? "audio/ogg",
      timestamp,
      telegram_language_code,
    };
  }

  // Contact sharing (user shared their phone number)
  if (msg.contact) {
    return {
      chat_id: chatId,
      message_type: "contact",
      contact_phone: msg.contact.phone_number,
      text: `Shared contact: ${msg.contact.first_name} ${msg.contact.last_name ?? ""}`.trim(),
      timestamp,
      telegram_language_code,
    };
  }

  // Unsupported types — pass through so the bot can respond helpfully
  return {
    chat_id: chatId,
    message_type: "unknown",
    timestamp,
  };
}

async function triggerMessageRouter(
  payload: MessageRouterPayload,
  env: Env,
  // Unique bucket for this inbound event ("msg-<id>" or "cb-<id>"). The
  // router idempotency key is `tg-<chat_id>-<bucket>` — same chat + same
  // bucket collapses to a single run (desirable for retries, fatal for
  // distinct events that happen to share an id). Callers must construct
  // the bucket so it's unique per Telegram update.
  idempotencyBucket: string,
): Promise<void> {
  const url = `${env.TRIGGERDEV_API_URL}/api/v1/tasks/meetsync-message-router/trigger`;

  // The burst/race consolidation is handled inside the router task itself
  // via a logMessage row-id "bail if newer" guard (see message-router.ts)
  // — NOT via a Trigger.dev queue, because FIFO serialization breaks the
  // consolidation scan.
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.TRIGGERDEV_API_KEY}`,
    },
    body: JSON.stringify({
      payload,
      options: {
        idempotencyKey: `tg-${payload.chat_id}-${idempotencyBucket}`,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Trigger.dev API error: ${response.status} — ${text}`);
  }
}
