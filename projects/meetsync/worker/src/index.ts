// MeetSync Cloudflare Worker — Telegram webhook gateway
// Receives Telegram messages and forwards them to Trigger.dev for processing

import type { Env, TelegramUpdate } from "./types.js";
import { verifyTelegramSecret } from "./signature.js";
import { handleMessage } from "./handle-message.js";
import { renderDashboard } from "./dashboard.js";
import { handleAuthCallback } from "./google-oauth.js";
import { handleTranscribe } from "./transcribe.js";
import { notifyOwner, formatError } from "./notify-owner.js";

/**
 * Constant-time string comparison. Prevents timing-attack leakage of the
 * `INTERNAL_ALERT_SECRET` via the /internal/alert auth check. CF Workers
 * provide `crypto.subtle.timingSafeEqual` as a non-standard helper that
 * runs in constant time over equal-length byte arrays.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

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
<p>Session data is automatically deleted after 30 days. We do not retain schedule images after parsing.</p>
<h2>Contact</h2>
<p>For questions, message the bot with "help" or contact the developer.</p>
</body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    // Admin observability dashboard — session_events viewer.
    // Gated on a query-string token. Prefer the separate DASHBOARD_TOKEN
    // secret; fall back to TELEGRAM_WEBHOOK_SECRET so existing deploys
    // keep working, but a freshly-set DASHBOARD_TOKEN means a leaked
    // dashboard URL no longer compromises the Telegram webhook auth.
    const dashboardToken = env.DASHBOARD_TOKEN ?? env.TELEGRAM_WEBHOOK_SECRET;
    if (url.pathname === "/dashboard") {
      const token = url.searchParams.get("token");
      if (!token || token !== dashboardToken) {
        return new Response("Unauthorized", { status: 401 });
      }
      return await renderDashboard(env);
    }

    // One-shot webhook (re-)registration. Needed after round-9 to
    // include "callback_query" in allowed_updates so Telegram
    // actually delivers button-tap events — default is just ["message"]
    // which silently drops callbacks. Same DASHBOARD_TOKEN gate as above.
    // POST-only so link-preview crawlers / pre-fetchers can't trigger
    // it just by surfacing the URL with a token in their referer.
    if (url.pathname === "/setup-webhook") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
      }
      const token = url.searchParams.get("token");
      if (!token || token !== dashboardToken) {
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

    // Google Calendar OAuth callback — Google redirects here after the
    // user consents. Verifies the signed state and stores the tokens in
    // D1 so deliver-results can auto-add events to the user's calendar.
    if (url.pathname === "/auth/google/callback") {
      return await handleAuthCallback(request, env);
    }

    // Internal transcription endpoint — Trigger.dev posts voice note bytes
    // here so the Worker can call env.AI.run() with implicit runtime auth.
    // Auth via Bearer <bot_token> header (shared secret both sides have).
    // See transcribe.ts for the rationale.
    if (url.pathname === "/internal/transcribe") {
      return await handleTranscribe(request, env);
    }

    // Generic internal alert relay. Any service that knows
    // INTERNAL_ALERT_SECRET can POST {label, message} and the Worker
    // forwards it to ADMIN_CHAT_ID via Telegram. Used by Trigger.dev
    // failure webhooks and other cross-service alerts so they don't
    // need their own bot credentials.
    if (url.pathname === "/internal/alert") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
      }
      const auth = request.headers.get("authorization");
      const expected = env.INTERNAL_ALERT_SECRET;
      if (!expected || !timingSafeStringEqual(auth ?? "", `Bearer ${expected}`)) {
        return new Response("Unauthorized", { status: 401 });
      }
      let body: { label?: unknown; message?: unknown };
      try {
        body = await request.json();
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
      const label = typeof body.label === "string" ? body.label : "alert";
      const message = typeof body.message === "string" ? body.message : "(no message)";
      ctx.waitUntil(notifyOwner(env, `⚠️ [${label}]\n${message}`));
      return new Response("OK", { status: 200 });
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
        ctx.waitUntil(handleMessage(update, env, url.origin));
      } catch (err) {
        console.error("Failed to parse Telegram update:", err);
        ctx.waitUntil(
          notifyOwner(env, formatError("meetsync/parse", err)),
        );
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Method Not Allowed", { status: 405 });
  },
} satisfies ExportedHandler<Env>;
