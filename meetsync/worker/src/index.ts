// MeetSync Cloudflare Worker — Telegram webhook gateway
// Receives Telegram messages and forwards them to Trigger.dev for processing

import type { Env, TelegramUpdate } from "./types.js";
import { verifyTelegramSecret } from "./signature.js";
import { handleMessage } from "./handle-message.js";
import { renderDashboard } from "./dashboard.js";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Privacy policy page
    if (url.pathname === "/privacy") {
      return new Response(
        `<!DOCTYPE html><html><head><title>MeetSync Privacy Policy</title></head><body>
<h1>MeetSync Privacy Policy</h1>
<p>Last updated: April 2026</p>
<p>MeetSync is a personal scheduling assistant that helps people find mutual free time via Telegram.</p>
<h2>Data We Collect</h2>
<ul>
<li>Your Telegram chat ID (to identify you in a session)</li>
<li>Work schedule data you send us (text or images)</li>
<li>Session codes and preferences</li>
</ul>
<h2>How We Use It</h2>
<p>Your data is used solely to compute overlapping free time between two participants. We do not sell, share, or use your data for advertising.</p>
<h2>Data Retention</h2>
<p>Session data is automatically deleted after 7 days. We do not retain schedule images after parsing.</p>
<h2>Contact</h2>
<p>For questions, message the bot with "help" or contact the developer.</p>
</body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    // Admin observability dashboard — session_events viewer.
    // Gated on a query-string token matching TELEGRAM_WEBHOOK_SECRET
    // so it's not publicly browsable. Not bulletproof (same secret
    // used for webhook verification) but good enough to keep casual
    // URL guessers out while letting the admin bookmark a one-URL
    // view that doesn't need a full auth system.
    if (url.pathname === "/dashboard") {
      const token = url.searchParams.get("token");
      if (!token || token !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
      return await renderDashboard(env);
    }

    // One-shot webhook (re-)registration. Needed after round-9 to
    // include "callback_query" in allowed_updates so Telegram
    // actually delivers button-tap events — default is just ["message"]
    // which silently drops callbacks. Secret-gated like /dashboard.
    if (url.pathname === "/setup-webhook") {
      const token = url.searchParams.get("token");
      if (!token || token !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
      const webhookUrl = `${url.origin}/webhook`;
      const tgResp = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: webhookUrl,
            secret_token: env.TELEGRAM_WEBHOOK_SECRET,
            allowed_updates: ["message", "callback_query"],
          }),
        }
      );
      const body = await tgResp.text();
      return new Response(
        `Webhook registered at ${webhookUrl}\nallowed_updates: [message, callback_query]\n\nTelegram response:\n${body}`,
        { status: tgResp.ok ? 200 : 500, headers: { "Content-Type": "text/plain" } }
      );
    }

    // Only handle /webhook path
    if (url.pathname !== "/webhook") {
      return new Response("Not Found", { status: 404 });
    }

    // POST = incoming Telegram update
    if (request.method === "POST") {
      // Validate secret token header
      const secret = request.headers.get("x-telegram-bot-api-secret-token");
      if (!verifyTelegramSecret(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
        console.warn("Invalid webhook secret — rejecting");
        return new Response("Unauthorized", { status: 401 });
      }

      // Parse and process — use waitUntil so Worker responds 200 immediately
      try {
        const update: TelegramUpdate = await request.json();
        ctx.waitUntil(handleMessage(update, env));
      } catch (err) {
        console.error("Failed to parse Telegram update:", err);
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Method Not Allowed", { status: 405 });
  },
} satisfies ExportedHandler<Env>;
