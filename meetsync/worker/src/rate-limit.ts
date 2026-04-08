// Rate limiting with escalating cooldowns
// 1st offense: 5 min cooldown | 2nd: 30 min | 3rd: 2 hours | 4th+: 24 hours
// Notifies admin on first offense per user

import type { Env } from "./types.js";

const MAX_REQUESTS = 10;
const WARN_THRESHOLD = 7;
const WINDOW_SECONDS = 60;

// Escalating cooldown durations in minutes
const COOLDOWNS = [5, 30, 120, 1440]; // 5min, 30min, 2h, 24h

export type RateLimitStatus = "ok" | "warning" | "cooldown";

/** Returns true if the phone number is blocked by admin */
export async function isBlocked(phone: string, env: Env): Promise<boolean> {
  try {
    const result = await env.DB.prepare(
      "SELECT 1 FROM blocked_phones WHERE phone = ?"
    ).bind(phone).first();
    return !!result;
  } catch {
    return false;
  }
}

/** Check rate limit with escalating cooldowns. Returns status + cooldown remaining if applicable. */
export async function checkRateLimit(
  phone: string,
  env: Env
): Promise<{ status: RateLimitStatus; cooldownMinutes?: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - WINDOW_SECONDS;

  try {
    // Check if user has strikes
    const strike = await env.DB.prepare(
      "SELECT strike_count, cooldown_until, last_strike FROM rate_strikes WHERE phone = ?"
    ).bind(phone).first<{ strike_count: number; cooldown_until: string | null; last_strike: string }>();

    // Reset strikes if last offense was over 24 hours ago
    if (strike && strike.last_strike) {
      const hoursSinceLastStrike = (Date.now() - new Date(strike.last_strike).getTime()) / 3600000;
      if (hoursSinceLastStrike > 24) {
        await env.DB.prepare("DELETE FROM rate_strikes WHERE phone = ?").bind(phone).run();
        // Continue as if no strikes exist
      } else if (strike.cooldown_until) {
        const cooldownEnd = new Date(strike.cooldown_until).getTime();
        if (Date.now() < cooldownEnd) {
          const remaining = Math.ceil((cooldownEnd - Date.now()) / 60000);
          return { status: "cooldown", cooldownMinutes: remaining };
        }
      }
    }

    // Count recent messages
    const result = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM rate_limits WHERE phone = ? AND ts > ?"
    ).bind(phone, windowStart).first<{ cnt: number }>();

    const count = result?.cnt ?? 0;

    if (count >= MAX_REQUESTS) {
      // Hit the limit — apply escalating cooldown
      // Re-check strikes (may have been reset above)
      const currentStrikes = await env.DB.prepare(
        "SELECT strike_count FROM rate_strikes WHERE phone = ?"
      ).bind(phone).first<{ strike_count: number }>();
      const strikes = (currentStrikes?.strike_count ?? 0) + 1;
      const cooldownIndex = Math.min(strikes - 1, COOLDOWNS.length - 1);
      const cooldownMinutes = COOLDOWNS[cooldownIndex];
      const cooldownUntil = new Date(Date.now() + cooldownMinutes * 60000).toISOString();

      await env.DB.prepare(
        `INSERT INTO rate_strikes (phone, strike_count, cooldown_until, last_strike)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(phone) DO UPDATE SET
           strike_count = ?,
           cooldown_until = ?,
           last_strike = datetime('now')`
      ).bind(phone, strikes, cooldownUntil, strikes, cooldownUntil).run();

      // Notify admin on first strike for this user
      if (strikes === 1 && env.ADMIN_PHONE) {
        notifyAdmin(env, phone, cooldownMinutes).catch(() => {});
      }

      return { status: "cooldown", cooldownMinutes };
    }

    // Log this request
    await env.DB.prepare(
      "INSERT INTO rate_limits (phone, ts) VALUES (?, ?)"
    ).bind(phone, now).run();

    // Cleanup old rate_limits entries (best-effort)
    env.DB.prepare("DELETE FROM rate_limits WHERE ts < ?")
      .bind(windowStart - WINDOW_SECONDS).run().catch(() => {});

    // Warning when approaching limit
    if (count >= WARN_THRESHOLD) {
      return { status: "warning" };
    }

    return { status: "ok" };
  } catch (err) {
    console.error("Rate limit check failed:", err);
    return { status: "ok" }; // fail-open
  }
}

async function notifyAdmin(env: Env, phone: string, cooldownMinutes: number): Promise<void> {
  await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: env.ADMIN_PHONE,
      type: "text",
      text: { body: `⚠️ *Rate limit triggered*\nUser ${phone} is spamming — put on ${cooldownMinutes}min cooldown. Use "block ${phone}" if needed.` },
    }),
  });
}
