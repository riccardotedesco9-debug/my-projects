// Parse WhatsApp webhook payload and trigger Trigger.dev tasks

import type { Env, WebhookPayload, WhatsAppMessage } from "./types.js";
import type { MessageRouterPayload } from "../../shared/types.js";
import { checkRateLimit, isBlocked } from "./rate-limit.js";

/**
 * Extract messages from webhook payload and trigger Trigger.dev tasks.
 * Returns 200 immediately — WhatsApp requires fast ack to avoid retries.
 */
export async function handleMessage(payload: WebhookPayload, env: Env): Promise<void> {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const messages = change.value.messages;
      if (!messages?.length) continue;

      for (const msg of messages) {
        const routerPayload = extractPayload(msg);
        if (!routerPayload) continue;

        // Admin commands — only the admin phone can run these
        if (env.ADMIN_PHONE && routerPayload.phone === env.ADMIN_PHONE && routerPayload.text) {
          const handled = await handleAdminCommand(routerPayload.text, env);
          if (handled) continue;
        }

        // Blocklist check — silently drop messages from blocked phones
        if (await isBlocked(routerPayload.phone, env)) {
          console.warn(`Blocked: ${routerPayload.phone}`);
          continue;
        }

        // Rate limit with escalating cooldowns
        const { status: rateStatus, cooldownMinutes } = await checkRateLimit(routerPayload.phone, env);
        if (rateStatus === "cooldown") {
          console.warn(`Cooldown: ${routerPayload.phone} (${cooldownMinutes}min)`);
          await sendReply(env, routerPayload.phone,
            `You've been sending too many messages. You're on a ${cooldownMinutes}-minute timeout. Try again later.`
          );
          continue;
        }
        if (rateStatus === "warning") {
          await sendReply(env, routerPayload.phone,
            "Heads up — you're close to the message limit. Slow down or you'll get a timeout."
          );
        }

        await triggerMessageRouter(routerPayload, env);
      }
    }
  }
}

// --- Admin commands (only admin phone, classified by Claude Haiku) ---

interface AdminIntent {
  action: "block" | "unblock" | "list_blocked" | "list_users" | "not_admin";
  phone?: string;
}

async function handleAdminCommand(text: string, env: Env): Promise<boolean> {
  // Use Claude Haiku to classify admin intent
  const intent = await classifyAdminIntent(text, env);

  if (intent.action === "not_admin") return false;

  if (intent.action === "block" && intent.phone) {
    const phone = intent.phone.replace(/[^0-9]/g, "");
    if (!phone || phone.length < 7 || phone.length > 15) {
      await sendAdminReply(env, "Invalid phone number. Use a number like 35699511425.");
      return true;
    }
    await env.DB.prepare(
      "INSERT OR IGNORE INTO blocked_phones (phone) VALUES (?)"
    ).bind(phone).run();
    await sendAdminReply(env, `Done — blocked *${phone}*. They won't be able to use the bot anymore.`);
    return true;
  }

  if (intent.action === "unblock" && intent.phone) {
    const phone = intent.phone.replace(/[^0-9]/g, "");
    if (!phone || phone.length < 7 || phone.length > 15) {
      await sendAdminReply(env, "Invalid phone number. Use a number like 35699511425.");
      return true;
    }
    await env.DB.prepare(
      "DELETE FROM blocked_phones WHERE phone = ?"
    ).bind(phone).run();
    await sendAdminReply(env, `Done — unblocked *${phone}*. They can use the bot again.`);
    return true;
  }

  if (intent.action === "list_blocked") {
    const result = await env.DB.prepare(
      "SELECT phone, blocked_at FROM blocked_phones ORDER BY blocked_at DESC"
    ).all<{ phone: string; blocked_at: string }>();

    if (!result.results.length) {
      await sendAdminReply(env, "Nobody is blocked right now.");
    } else {
      const list = result.results.map((r) => `- ${r.phone} (since ${r.blocked_at})`).join("\n");
      await sendAdminReply(env, `*Blocked users:*\n${list}`);
    }
    return true;
  }

  if (intent.action === "list_users") {
    const result = await env.DB.prepare(
      "SELECT DISTINCT phone FROM participants ORDER BY created_at DESC LIMIT 50"
    ).all<{ phone: string }>();

    if (!result.results.length) {
      await sendAdminReply(env, "No users yet.");
    } else {
      const list = result.results.map((r) => `- ${r.phone}`).join("\n");
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
        system: `You classify admin commands for a WhatsApp bot. Return ONLY JSON.
Actions: "block" (ban a user, needs phone), "unblock" (unban, needs phone), "list_blocked" (show blocked), "list_users" (show all users), "not_admin" (not an admin command).
Extract phone numbers from the message if present (any format: +356XXX, 356XXX, etc).
Return: { "action": "...", "phone": "..." }`,
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

async function sendReply(env: Env, phone: string, text: string): Promise<void> {
  await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: text },
    }),
  });
}

async function sendAdminReply(env: Env, text: string): Promise<void> {
  await sendReply(env, env.ADMIN_PHONE, text);
}

function extractPayload(msg: WhatsAppMessage): MessageRouterPayload | null {
  const base = {
    phone: msg.from,
    timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
  };

  switch (msg.type) {
    case "text":
      return {
        ...base,
        message_type: "text",
        text: msg.text?.body?.trim(),
      };

    case "image":
      return {
        ...base,
        message_type: "image",
        media_id: msg.image?.id,
        mime_type: msg.image?.mime_type,
      };

    case "document":
      return {
        ...base,
        message_type: "document",
        media_id: msg.document?.id,
        mime_type: msg.document?.mime_type,
      };

    default:
      // Pass unsupported types through so the bot can respond helpfully
      return {
        ...base,
        message_type: "unknown" as const,
      };
  }
}

async function triggerMessageRouter(
  payload: MessageRouterPayload,
  env: Env
): Promise<void> {
  const url = `${env.TRIGGERDEV_API_URL}/api/v1/tasks/meetsync-message-router/trigger`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.TRIGGERDEV_API_KEY}`,
    },
    body: JSON.stringify({
      payload,
      options: {
        idempotencyKey: `wa-${payload.phone}-${payload.timestamp}`,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Trigger.dev API error: ${response.status} — ${text}`);
  }
}
