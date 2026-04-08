// MeetSync Cloudflare Worker — WhatsApp webhook gateway
// Receives WhatsApp messages and forwards them to Trigger.dev for processing

import type { Env, WebhookPayload } from "./types.js";
import { handleVerification } from "./verify-webhook.js";
import { verifySignature } from "./signature.js";
import { handleMessage } from "./handle-message.js";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Privacy policy page (required by Meta to publish the app)
    if (url.pathname === "/privacy") {
      return new Response(
        `<!DOCTYPE html><html><head><title>MeetSync Privacy Policy</title></head><body>
<h1>MeetSync Privacy Policy</h1>
<p>Last updated: April 2026</p>
<p>MeetSync is a personal scheduling assistant that helps two people find mutual free time via WhatsApp.</p>
<h2>Data We Collect</h2>
<ul>
<li>Your phone number (to identify you in a session)</li>
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

    // Only handle /webhook path
    if (url.pathname !== "/webhook") {
      return new Response("Not Found", { status: 404 });
    }

    // GET = webhook verification (Meta setup handshake)
    if (request.method === "GET") {
      return handleVerification(url, env.WHATSAPP_VERIFY_TOKEN);
    }

    // POST = incoming message
    if (request.method === "POST") {
      const body = await request.text();

      // Validate HMAC signature
      const signature = request.headers.get("x-hub-signature-256");
      const valid = await verifySignature(body, signature, env.WHATSAPP_APP_SECRET);
      if (!valid) {
        console.warn("Invalid webhook signature — rejecting");
        return new Response("Unauthorized", { status: 401 });
      }

      // Parse and trigger Trigger.dev — use waitUntil so Worker stays alive
      // but responds 200 to WhatsApp immediately
      try {
        const payload: WebhookPayload = JSON.parse(body);
        ctx.waitUntil(handleMessage(payload, env));
      } catch (err) {
        console.error("Failed to parse webhook payload:", err);
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Method Not Allowed", { status: 405 });
  },
} satisfies ExportedHandler<Env>;
