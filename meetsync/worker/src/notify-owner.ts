// Push critical operational alerts to the bot owner's Telegram chat.
// Best-effort — never throws, since alerting must not break the caller.

import type { Env } from "./types.js";

const TELEGRAM_MAX_LEN = 4096;

export async function notifyOwner(env: Env, message: string): Promise<void> {
  if (!env.ADMIN_CHAT_ID || !env.TELEGRAM_BOT_TOKEN) return;

  const trimmed =
    message.length > TELEGRAM_MAX_LEN
      ? message.slice(0, TELEGRAM_MAX_LEN - 16) + "\n…[truncated]"
      : message;

  try {
    await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.ADMIN_CHAT_ID,
          text: trimmed,
          disable_web_page_preview: true,
        }),
      },
    );
  } catch (err) {
    console.error("notifyOwner failed:", err);
  }
}

export function formatError(label: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const stack =
    err instanceof Error && err.stack
      ? err.stack.split("\n").slice(0, 5).join("\n")
      : "";
  return `⚠️ [${label}]\n${msg}${stack ? `\n\n${stack}` : ""}`;
}
