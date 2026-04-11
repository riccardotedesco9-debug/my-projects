// Google Calendar OAuth flow for MeetSync.
//
// Flow:
//   1. User types `/connect` in Telegram → Worker builds a signed auth URL and
//      DMs it back. URL points at `/auth/google?state=<signed-chat-id>`.
//   2. User clicks → Worker redirects to Google consent screen with scope
//      https://www.googleapis.com/auth/calendar.events.
//   3. Google redirects back to `/auth/google/callback?code=...&state=...`.
//   4. Worker verifies the signed state (prevents a malicious user from binding
//      someone else's chat_id to their own Google account), exchanges the code
//      for access+refresh tokens, and upserts `google_tokens`.
//   5. Next time `deliver-results` fires for that chat_id, `createCalendarEvent`
//      finds a token and silently adds the event to their primary calendar.
//
// The state signature reuses TELEGRAM_WEBHOOK_SECRET as the HMAC key — no new
// secret needed. Tokens expire after 15min to limit the click-window.

import type { Env } from "./types.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Build the redirect URI used for both the initial auth request and the
 *  callback. Must exactly match the URI whitelisted in Google Cloud Console. */
export function buildRedirectUri(origin: string): string {
  return `${origin}/auth/google/callback`;
}

/** Build the Google consent URL for a given chat_id. Returns null if
 *  GOOGLE_CLIENT_ID is missing (means OAuth isn't configured yet). */
export async function buildAuthUrl(chatId: string, env: Env, origin: string): Promise<string | null> {
  if (!env.GOOGLE_CLIENT_ID) return null;

  const state = await signState(chatId, env.TELEGRAM_WEBHOOK_SECRET);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: buildRedirectUri(origin),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // `prompt=consent` forces Google to re-issue a refresh_token on every
    // auth. Without it, the second+ auth attempts for the same user return
    // only an access_token, and our token refresh path breaks silently.
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Handle the callback from Google. Verifies state, exchanges the auth code
 *  for tokens, and persists them to D1. Returns an HTML response for the
 *  user's browser. */
export async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return htmlResponse(500, "Google Calendar integration is not configured on this bot.");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return htmlResponse(400, `Google denied the request: ${escapeHtml(error)}. You can close this tab and try \`/connect\` again.`);
  }
  if (!code || !state) {
    return htmlResponse(400, "Missing code or state parameter.");
  }

  const chatId = await verifyState(state, env.TELEGRAM_WEBHOOK_SECRET);
  if (!chatId) {
    return htmlResponse(400, "Invalid or expired link. Send <code>/connect</code> to the bot again to get a fresh one.");
  }

  // Exchange the auth code for access + refresh tokens.
  const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: buildRedirectUri(url.origin),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResp.ok) {
    const body = await tokenResp.text();
    console.error(`Google token exchange failed (${tokenResp.status}): ${body}`);
    return htmlResponse(502, "Google rejected the token exchange. Try <code>/connect</code> again.");
  }

  const data = (await tokenResp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  // `prompt=consent` should always yield a refresh_token, but if Google skipped
  // it (e.g. user revoked and re-authorised with prompt=none somewhere), bail
  // instead of saving a useless record.
  if (!data.refresh_token) {
    return htmlResponse(400, "Google didn't send a refresh token. Revoke this app's access at <a href='https://myaccount.google.com/permissions'>myaccount.google.com/permissions</a> and run <code>/connect</code> again.");
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Upsert directly into D1. We're in the Worker, so we don't need the
  // Trigger.dev d1-client helper.
  await env.DB.prepare(
    `INSERT INTO google_tokens (chat_id, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at`
  ).bind(chatId, data.access_token, data.refresh_token, expiresAt).run();

  return htmlResponse(200, "✅ Google Calendar connected. You can close this tab and head back to Telegram — future meetups will be auto-added to your primary calendar.");
}

// --- State signing (HMAC-SHA256, truncated to 16 hex chars) ---

/** Sign state as `<chatId>.<ts>.<hmac16>`. */
export async function signState(chatId: string, secret: string): Promise<string> {
  const ts = Date.now().toString();
  const payload = `${chatId}.${ts}`;
  const sig = await hmacHex(payload, secret);
  return `${payload}.${sig.slice(0, 16)}`;
}

/** Verify state, returns chatId on success or null on failure. */
export async function verifyState(state: string, secret: string): Promise<string | null> {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [chatId, ts, sig] = parts;
  if (!chatId || !ts || !sig) return null;

  const expected = (await hmacHex(`${chatId}.${ts}`, secret)).slice(0, 16);
  if (!constantTimeEqual(sig, expected)) return null;

  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < 0 || age > STATE_TTL_MS) return null;

  return chatId;
}

async function hmacHex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- HTML helpers ---

function htmlResponse(status: number, body: string): Response {
  const html = `<!DOCTYPE html><html><head><title>MeetSync · Google Calendar</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:480px;margin:4rem auto;padding:0 1.5rem;color:#222;line-height:1.5}
  h1{font-size:1.25rem;margin-bottom:1rem}
  code{background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:0.9em}
  a{color:#1a73e8}
</style></head>
<body><h1>MeetSync</h1><p>${body}</p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
