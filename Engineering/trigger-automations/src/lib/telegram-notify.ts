// Cross-task Telegram alerts via the MeetSync bot. Reuses the TELEGRAM_BOT_TOKEN
// env var already configured for the meetsync tasks; reads ADMIN_CHAT_ID
// (a.k.a. owner chat) so all alerts land in Riccardo's chat with the bot.
//
// Best-effort — never throws, since alerting must not break the caller's
// main flow. Always log + swallow on failure.

const TELEGRAM_MAX_LEN = 4096;

export async function notifyOwner(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ADMIN_CHAT_ID ?? process.env.OWNER_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[telegram-notify] TELEGRAM_BOT_TOKEN or ADMIN_CHAT_ID missing — skipping alert");
    return;
  }

  const trimmed =
    message.length > TELEGRAM_MAX_LEN
      ? message.slice(0, TELEGRAM_MAX_LEN - 16) + "\n…[truncated]"
      : message;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: trimmed,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[telegram-notify] HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
  } catch (err) {
    console.error("[telegram-notify] fetch failed:", err);
  }
}

export function formatErrorAlert(label: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const stack =
    err instanceof Error && err.stack
      ? err.stack.split("\n").slice(0, 5).join("\n")
      : "";
  return `⚠️ [${label}]\n${msg}${stack ? `\n\n${stack}` : ""}`;
}
