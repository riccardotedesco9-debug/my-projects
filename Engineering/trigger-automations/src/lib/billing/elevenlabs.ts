// ElevenLabs subscription / character usage.
// Auth: xi-api-key header (the same key used for TTS calls).

import type { ProviderUsage } from "./types.js";
import { emptyUsage } from "./types.js";

interface Subscription {
  tier: string;
  character_count: number;
  character_limit: number;
  next_character_count_reset_unix: number; // 0 if no reset
  status: string;
}

export async function fetchElevenLabsUsage(): Promise<ProviderUsage> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return emptyUsage("elevenlabs", "ELEVENLABS_API_KEY not set");

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": key },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return emptyUsage("elevenlabs", `HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const sub = (await res.json()) as Subscription;
    const periodEnd =
      sub.next_character_count_reset_unix > 0
        ? new Date(sub.next_character_count_reset_unix * 1000).toISOString()
        : null;
    return {
      provider: "elevenlabs",
      used: sub.character_count,
      remaining: Math.max(0, sub.character_limit - sub.character_count),
      unit: "characters",
      periodStart: null,
      periodEnd,
      estCostUSD: null, // varies by tier; user's plan price is fixed monthly
      error: null,
    };
  } catch (err) {
    return emptyUsage("elevenlabs", err instanceof Error ? err.message : String(err));
  }
}
