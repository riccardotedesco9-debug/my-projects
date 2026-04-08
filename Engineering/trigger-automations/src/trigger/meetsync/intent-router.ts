// Intent router — classifies WhatsApp messages via Claude Haiku
// Replaces keyword matching with natural language understanding

import { z } from "zod";

const INTENT_LIST = [
  "create_session",
  "resume_partner",
  "new_partner",
  "provide_partner",
  "provide_name",
  "decline_invite",
  "authorize_outreach",
  "send_availability",
  "upload_schedule_text",
  "confirm_schedule",
  "reject_schedule",
  "clarify_schedule",
  "submit_preferences",
  "show_status",
  "cancel_session",
  "show_help",
  "reset_all",
  "unsupported_media",
  "greeting",
  "unknown",
] as const;

export type Intent = (typeof INTENT_LIST)[number];

export interface IntentResult {
  intent: Intent;
  params: {
    partner_name?: string; // for provide_partner (user said a name)
    partner_phone?: string; // for provide_partner (user said a phone number)
    name?: string; // for provide_name (user sharing their own name)
    slots?: number[]; // for submit_preferences
    schedule_text?: string; // for upload_schedule_text
    clarification?: string; // for clarify_schedule (e.g., "check the whole month")
    detected_language?: string; // language detected from the message (en/mt/it/etc)
    learned_facts?: string; // new facts about the user worth remembering (e.g., "works night shifts")
    reply?: string; // for unknown intent — inline conversational response
  };
}

const intentSchema = z.object({
  intent: z.enum(INTENT_LIST),
  params: z.object({
    partner_name: z.string().optional(),
    partner_phone: z.string().optional(),
    name: z.string().optional(),
    slots: z.array(z.number()).optional(),
    schedule_text: z.string().optional(),
    clarification: z.string().optional(),
    detected_language: z.string().optional(),
    learned_facts: z.string().optional(),
    reply: z.string().optional(),
  }).optional().default({}),
});

const SYSTEM_PROMPT = `You are MeetSync's intent classifier. Given a WhatsApp message, the user's current conversation state, and the message type, return a JSON object with the intent and any extracted parameters.

Possible intents:
- create_session: user wants to start a new scheduling session (e.g., "new", "start", "let's schedule")
- resume_partner: user wants to schedule with their existing partner again (e.g., "hey", "hi", "let's plan", "schedule again" — when they have a known partner)
- new_partner: user wants to switch to a different scheduling partner (e.g., "scheduling with someone new", "different person", "new partner")
- provide_partner: user is telling the bot WHO they want to schedule with. Extract into params.partner_name (if they said a name like "Diego", "my friend Sarah") or params.partner_phone (if they gave a phone number). This is the primary intent in AWAITING_PARTNER_INFO state.
- provide_name: user is sharing their own name when asked (e.g., "I'm Riccardo", "My name is Diego", "It's Sarah"). Extract into params.name
- decline_invite: user doesn't want to schedule with the person who invited them (e.g., "no thanks", "not now", "I'm busy")
- authorize_outreach: user is giving permission for the bot to proactively message their partner (e.g., "yes message them", "go ahead", "reach out to them", "send it"). Only valid in AWAITING_PARTNER state.
- send_availability: user wants the bot to share their availability with their partner directly (e.g., "send my availability", "share my free times", "yes send it to them"). Only valid in SCHEDULE_CONFIRMED state.
- upload_schedule_text: user is describing their work schedule in text (e.g., "I work Mon-Fri 9-5", "off on Wednesday"). Put the full schedule description in params.schedule_text
- confirm_schedule: user is confirming their parsed schedule is correct (e.g., "yes", "looks good", "correct", "that's right")
- reject_schedule: user is rejecting their parsed schedule (e.g., "no", "wrong", "redo", "that's not right")
- clarify_schedule: user isn't rejecting but wants to adjust the scope or add context (e.g., "check the whole month", "not just this week", "look at all of April"). Put clarification in params.clarification
- submit_preferences: user is selecting preferred meeting slots by number OR by day name (e.g., "1 and 3", "slots 2, 4, 5", "Monday and Wednesday"). Extract slot numbers into params.slots.
- show_status: user wants to know their current session status
- cancel_session: user wants to cancel (e.g., "cancel", "quit", "stop")
- show_help: user wants help
- reset_all: user wants to wipe all data and start fresh (e.g., "reset everything", "clear my data", "start over completely")
- unsupported_media: message is audio, video, sticker, or reaction
- greeting: casual greeting without clear intent when user has no active session AND no known partner
- unknown: can't determine intent. Include a brief, helpful reply in params.reply that addresses what the user said and gently nudges them toward the next step based on their state.

ALWAYS include params.detected_language — the ISO 639-1 code of the language the user wrote in (e.g., "en", "mt", "it", "fr"). Detect from the actual message text.

If the user says ANYTHING that could be useful context in future conversations, include it in params.learned_facts as a short note. This includes but is not limited to: job/work info, schedule details, availability ("free next week", "off on Wednesdays"), preferences, plans, location, relationships ("Diego is my colleague"), uploaded schedule summaries, time constraints, personal details they share. Be generous — if in doubt, store it. Only omit this field if the message is purely functional (like "yes", "1 and 3", "cancel") with zero contextual value.

Context rules:
- In AWAITING_PARTNER_INFO state: bias toward provide_partner. If it looks like a phone number, extract as partner_phone. If it looks like a name, extract as partner_name.
- In AWAITING_PARTNER state: bias toward authorize_outreach for affirmative responses ("yes", "go ahead", "sure"). If user describes work hours/days or says they'll upload a schedule, classify as upload_schedule_text. Also handle cancel_session.
- In AWAITING_CONFIRMATION state: bias toward confirm_schedule, reject_schedule, or clarify_schedule.
- In AWAITING_PREFERENCES state: bias toward submit_preferences
- In AWAITING_SCHEDULE state: if text describes work hours/days, it's upload_schedule_text
- If user is IDLE and has a known partner: bias toward resume_partner for greetings
- If user is IDLE and bot asked for their name: bias toward provide_name
- If message_type is audio/video/sticker: always return unsupported_media

Return ONLY valid JSON: { "intent": "...", "params": { ... } }`;

/**
 * Classify a WhatsApp message into a structured intent using Claude Haiku.
 * Falls back to "unknown" if classification fails.
 */
export async function classifyIntent(
  text: string | undefined,
  messageType: string,
  currentState: string
): Promise<IntentResult> {
  // Fast path: non-text media that isn't image/document
  if (["audio", "video", "sticker", "reaction"].includes(messageType)) {
    return { intent: "unsupported_media", params: {} };
  }

  // Fast path: image or document upload (file, not text)
  if (messageType === "image" || messageType === "document") {
    return { intent: "upload_schedule_text", params: {} }; // handled as file upload by router
  }

  // Fast path: phone number in AWAITING_PARTNER_INFO state
  if (currentState === "AWAITING_PARTNER_INFO" && text) {
    const phoneMatch = text.replace(/[\s\-\(\)\.+]/g, "").match(/^\d{7,15}$/);
    if (phoneMatch) {
      return { intent: "provide_partner", params: { partner_phone: phoneMatch[0] } };
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set — falling back to unknown intent");
    return { intent: "unknown", params: {} };
  }

  const userMessage = `Current state: ${currentState}
Message type: ${messageType}
Message: "${text ?? ""}"`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      console.error(`Haiku API error: ${response.status}`);
      return { intent: "unknown", params: {} };
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    const textBlock = data.content.find((b) => b.type === "text");
    if (!textBlock?.text) return { intent: "unknown", params: {} };

    const jsonStr = textBlock.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = intentSchema.parse(JSON.parse(jsonStr));

    return { intent: parsed.intent, params: parsed.params };
  } catch (err) {
    console.error("Intent classification failed:", err);
    return { intent: "unknown", params: {} };
  }
}
