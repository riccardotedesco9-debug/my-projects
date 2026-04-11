// Small shared helpers used by the router + its extracted handler modules.
// Kept separate so intent-handlers.ts / state-handlers.ts can import them
// without pulling in the full message-router.ts closure.

import { z } from "zod";
import { sendTextMessage } from "./telegram-client.js";
import { getParticipantCount, getPendingInviteCount } from "./d1-client.js";

/**
 * Router payload schema — defined here so extracted handler modules can
 * share the inferred type via `z.infer<typeof payloadSchema>` without
 * circular-importing message-router.ts.
 *
 * `log_id` is the pre-logged conversation_log row id. The Worker logs
 * user text inline before triggering, so bursts race at the Worker level
 * (sub-second) instead of at task cold-start (multi-second stagger) —
 * making the bail-if-newer guard reliable with a short sleep.
 */
export const payloadSchema = z.object({
  chat_id: z.string(),
  message_type: z.enum(["text", "image", "document", "audio", "contact", "unknown"]),
  text: z.string().optional(),
  media_id: z.string().optional(),
  mime_type: z.string().optional(),
  contact_phone: z.string().optional(),
  timestamp: z.string(),
  log_id: z.number().optional(),
});

export type RouterPayload = z.infer<typeof payloadSchema>;

/**
 * The creator can proceed to scheduling once they've either added at
 * least one real participant OR invited someone via deep-link (pending
 * invite). We count both because the common case is "I want to meet
 * Alice" → Alice doesn't exist yet → pending invite created → creator
 * should be able to upload schedule without having to wait for Alice to
 * actually tap the link.
 */
export async function canProceedToScheduling(sessionId: string): Promise<boolean> {
  const [participants, invites] = await Promise.all([
    getParticipantCount(sessionId),
    getPendingInviteCount(sessionId),
  ]);
  // participants includes the creator (1), so we need at least 1 real
  // partner OR 1 invite.
  return participants >= 2 || invites >= 1;
}

/**
 * Send a message, splitting oversized payloads to stay under Telegram's
 * 4096-char limit. Bot-side logging to conversation_log happens inside
 * sendTextMessage itself, so every task (router, schedule-parser,
 * orchestrator, deliver-results) produces consistent history without
 * callers having to remember to log.
 *
 * The split heuristic: find the last newline before the 4000-char mark.
 * If that newline is further than 2000 chars in (i.e. there's a reasonable
 * paragraph boundary), split there. Otherwise hard-cut at 4000 to avoid
 * pathological behavior on content with no newlines. The 4000 cap (vs
 * Telegram's 4096) leaves headroom for the bot's own username and any
 * entity framing the API adds.
 */
export async function reply(chatId: string, msg: string): Promise<void> {
  if (msg.length <= 4000) {
    await sendTextMessage(chatId, msg);
    return;
  }
  const chunks: string[] = [];
  let remaining = msg;
  while (remaining.length > 0) {
    if (remaining.length <= 4000) {
      chunks.push(remaining);
      break;
    }
    const cutAt = remaining.lastIndexOf("\n", 4000);
    const splitPoint = cutAt > 2000 ? cutAt : 4000;
    chunks.push(remaining.slice(0, splitPoint));
    remaining = remaining.slice(splitPoint).trimStart();
  }
  for (const chunk of chunks) {
    await sendTextMessage(chatId, chunk);
  }
}
