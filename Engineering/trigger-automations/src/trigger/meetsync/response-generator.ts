// Conversational response generator — wraps Claude Haiku to produce natural WhatsApp messages
// Every scenario has a static fallback so the bot never goes silent on API failure

export interface ResponseContext {
  scenario: string;
  state: string;
  userName?: string;
  userLanguage?: string;
  partnerName?: string;
  sessionCode?: string;
  shiftList?: string;
  slotList?: string;
  matchResult?: string;
  userMessage?: string;
  extraContext?: string;
}

const SYSTEM_PROMPT = `You are MeetSync, a WhatsApp scheduling assistant that helps two people find mutual free time.

Personality: friendly, casual, concise. Think helpful coworker texting you, not a corporate bot.

Rules:
- WhatsApp style: short messages (2-4 lines max unless showing data), use *bold* for emphasis
- Use emoji sparingly (0-2 per message, only when natural)
- Never invent dates, times, or schedule data — use ONLY what's provided in the context
- If structured data is provided (shifts, slots), include it exactly as given
- If the user's preferred language is provided, ALWAYS reply in that language. If "mt" (Maltese), reply in Maltese. If "it" (Italian), reply in Italian. Etc.
- If the user's name is provided, use it naturally (not every message, just where it feels right)
- If a partner name is provided, refer to them by name
- Be encouraging but not over-the-top
- If user asks something off-topic, answer briefly then gently redirect to the current step
- You know MeetSync can: accept schedule uploads (photo/PDF/text), parse shifts with AI, find overlapping free time, recommend meeting slots, and send calendar files
- You know MeetSync currently supports 2 people per session (not groups yet)
- There are NO session codes — users just say who they want to schedule with`;

// Scenario instructions tell Claude what each response should accomplish
const SCENARIO_INSTRUCTIONS: Record<string, string> = {
  // -- message-router scenarios --
  show_status: "Tell the user their current session status and state.",
  unsupported_media: "The user sent a voice note, video, or sticker. Explain you can only handle text, photos, and PDFs. Keep it light.",
  reset_all: "Confirm all their data has been cleared. Mention they can send 'new' to start fresh.",
  new_partner: "Confirm you're clearing their previous partner. Tell them to send 'new' to start with someone new.",
  idle_welcome: "Welcome a new user to MeetSync. Briefly explain what you do (find mutual free time between two people). Tell them to send 'new' to start scheduling. Ask for their name so you can remember them.",
  ask_name: "You've just met this user. Ask for their name so you can address them properly. Keep it short and friendly.",
  ask_partner: "Ask the user who they want to schedule with. They can give a name or phone number. Keep it casual.",
  partner_found: "You found the partner in the system! Tell the user you're pairing them and both should send their work schedules.",
  partner_not_found: "The person they named isn't in the system yet. Ask for their phone number so you can invite them when they message.",
  invite_sent: "An invite has been created. Tell the user their friend needs to message the bot to get started. You'll pair them automatically when they do.",
  invite_accepted_creator: "The partner just showed up! Both are now paired. Ask the user to send their work schedule.",
  invite_accepted_invitee: "Someone invited this user to schedule together. Tell them who invited them and ask for their work schedule.",
  invite_expired: "The partner never showed up. Suggest they try again or check with their friend.",
  awaiting_partner_reminder: "Still waiting for the partner to message the bot. Reassure them you'll pair automatically.",
  returning_partner_creator: "The user is scheduling with their known partner again. Ask for their new work schedule.",
  returning_partner_partner: "Notify the partner that their colleague wants to plan again. Ask for their work schedule.",
  missing_media: "The file didn't come through. Ask them to try sending it again.",
  remind_upload: "The user is in AWAITING_SCHEDULE but sent something unrecognized. Remind them to send their schedule (photo, PDF, or type hours).",
  schedule_confirmed: "Their schedule is confirmed. Let them know you're waiting for their colleague now.",
  schedule_rejected: "They rejected the parsed schedule. Ask them to send it again — photo, PDF, or type their hours.",
  confirm_prompt: "The user sent something unrecognized while you're waiting for schedule confirmation. Ask if the schedule is correct (yes/no) or if they want to adjust something.",
  remind_preferences: "The user needs to pick preferred slots. Remind them to reply with slot numbers.",
  session_complete: "Their session is done. Offer to start a new one with 'new'.",
  unknown_state_error: "Something unexpected happened. Suggest sending 'new' to start fresh or 'cancel' to reset.",
  cancel_self: "Confirm the session was cancelled. The partner has been notified. Offer to start a new session.",
  cancel_partner: "Their colleague cancelled the session. Let them know and offer to start a new one.",
  show_help: "Provide contextual help based on their current state. Mention they can always use 'cancel', 'status', or 'help'.",
  unknown_intent: "The user said something off-script. If it's a question about MeetSync or scheduling, answer it naturally. If it's completely unrelated, acknowledge it briefly and gently nudge them toward the next step in their current flow. Use the state to know what step they're on.",
  preferences_saved: "Their preferences are saved. Waiting for their colleague to pick theirs.",

  // -- schedule-parser scenarios --
  shifts_extracted: "Show the user their extracted shifts and ask for confirmation. Include the shift list exactly as provided. Mention they can say yes, no, or ask to adjust (e.g., 'check the whole month').",
  no_shifts_found: "Couldn't extract any shifts from what they sent. Ask them to try a clearer photo, PDF, or just type their hours.",
  parse_error: "Had trouble reading their schedule. Ask them to try again or type their hours directly.",

  // -- session-orchestrator scenarios --
  nudge_reminder: "It's been a while and they haven't sent their schedule yet. Send a friendly nudge — not pushy, just a gentle reminder.",
  session_expired: "The session timed out. Let them know and offer to start a new one.",
  meetup_reminder: "Remind them about their meetup tomorrow. Include the date and time provided.",

  // -- deliver-results scenarios --
  no_overlap: "No overlapping free time was found. Suggest uploading updated schedules or trying a different week.",
  mutual_match: "Both people preferred the same slot — celebrate! Show the match details provided.",
  best_match: "Show the best available slot. Mention no mutual preference matched so you picked the top-ranked one.",
};

// Static fallbacks — current hardcoded strings, used when Claude API fails
const STATIC_FALLBACKS: Record<string, (ctx: ResponseContext) => string> = {
  show_status: (ctx) => `Status: ${ctx.state}`,
  unsupported_media: () => "I can't process voice messages, videos, or stickers. Please type your message or send a photo/PDF of your schedule.",
  reset_all: () => "All your data has been cleared. Send *new* to start fresh.",
  new_partner: () => "Got it — starting fresh. Send *new* to create a session with someone new.",
  idle_welcome: () => "Welcome to MeetSync! I help you find the best time to meet with a colleague.\n\nSend *new* to start scheduling.\n\nWhat's your name?",
  ask_name: () => "Hey! What's your name?",
  ask_partner: () => "Who do you want to schedule with? Just give me their name or phone number.",
  partner_found: (ctx) => `Found them! Scheduling with *${ctx.partnerName ?? "your partner"}*. Both of you send me your work schedules — photo, PDF, or type your hours.`,
  partner_not_found: () => "I don't know them yet. What's their phone number? I'll pair you up when they message me.",
  invite_sent: () => "Got it! Tell your friend to message me on WhatsApp. I'll pair you both automatically when they do.",
  invite_accepted_creator: (ctx) => `${ctx.partnerName ?? "Your partner"} just showed up! Send me your work schedule — photo, PDF, or type your hours.`,
  invite_accepted_invitee: (ctx) => `${ctx.partnerName ?? "Your colleague"} invited you to find a time to meet! Send me your work schedule — photo, PDF, or type your hours.`,
  invite_expired: () => "Your partner never messaged me. Send *new* to try again!",
  awaiting_partner_reminder: () => "Still waiting for your partner to message me. Once they do, I'll pair you both automatically!",
  returning_partner_creator: () => "Let's plan again! Send me your new work schedule — photo, PDF, or type your hours.",
  returning_partner_partner: (ctx) => `${ctx.partnerName ?? "Your colleague"} wants to plan the next meetup! Send me your work schedule — photo, PDF, or type your hours.`,
  missing_media: () => "I couldn't receive that file. Please try sending it again.",
  remind_upload: () => "Send me your work schedule — you can:\n- Send a *photo* or *PDF* of your schedule\n- Or just *type your hours* (e.g., \"I work Mon-Fri 9-5\")",
  schedule_confirmed: () => "Schedule confirmed! Waiting for your colleague...",
  schedule_rejected: () => "No problem! Send me your schedule again — photo, PDF, or type your hours.",
  confirm_prompt: () => "Reply *yes* to confirm, *no* to re-upload, or tell me what to adjust (e.g., \"check the whole month\").",
  remind_preferences: () => "Reply with the numbers of your preferred slots (e.g., *1, 3*)",
  session_complete: () => "Your last session is complete. Send *new* to start a fresh one!",
  unknown_state_error: () => "Something went wrong. Send *new* to start fresh or *cancel* to reset.",
  cancel_self: () => "Session cancelled. Send *new* to start a fresh one.",
  cancel_partner: () => "Your colleague cancelled the session. Send *new* to start a fresh one.",
  show_help: (ctx) => {
    const hints: Record<string, string> = {
      IDLE: "Send *new* to start scheduling.",
      AWAITING_PARTNER_INFO: "Tell me who you want to schedule with — a name or phone number.",
      AWAITING_PARTNER: "Waiting for your partner to message me. They'll be paired automatically.",
      AWAITING_SCHEDULE: "Send me your work schedule (photo, PDF, or type your hours).",
      SCHEDULE_RECEIVED: "Your schedule is being analyzed. Please wait...",
      AWAITING_CONFIRMATION: "Reply *yes* to confirm your schedule or *no* to re-upload.",
      SCHEDULE_CONFIRMED: "Waiting for your colleague to upload their schedule.",
      AWAITING_PREFERENCES: "Reply with your preferred slot numbers (e.g., 1, 3, 5).",
      PREFERENCES_SUBMITTED: "Waiting for your colleague to select their preferences.",
      COMPLETED: "Session complete! Send *new* to start a fresh one.",
    };
    const hint = hints[ctx.state] ?? "Send *new* to start scheduling.";
    return `*MeetSync Help*\n\n${hint}\n\nYou can also:\n- *cancel* — cancel current session\n- *status* — check current state\n- *help* — show this message`;
  },
  unknown_intent: (ctx) => {
    const hints: Record<string, string> = {
      IDLE: "Send *new* to start scheduling with someone.",
      AWAITING_PARTNER_INFO: "Tell me who you want to schedule with — a name or phone number.",
      AWAITING_PARTNER: "Still waiting for your partner to message me.",
      AWAITING_SCHEDULE: "Send me your work schedule — photo, PDF, or type your hours.",
      AWAITING_CONFIRMATION: "Reply *yes* to confirm, *no* to re-upload, or tell me what to adjust.",
      AWAITING_PREFERENCES: "Reply with your preferred slot numbers (e.g., *1, 3*).",
    };
    return hints[ctx.state] ?? "Send *help* if you're stuck.";
  },
  preferences_saved: () => "Your preferences are saved! Waiting for your colleague to select theirs...",
  shifts_extracted: (ctx) => `Here's what I extracted:\n\n${ctx.shiftList}\n\nIs this correct? Reply *yes* to confirm, *no* to re-upload, or tell me what to adjust.`,
  no_shifts_found: () => "I couldn't find any work shifts. Try sending a clearer photo, PDF, or type your hours (e.g., \"I work Mon-Fri 9-5\").",
  parse_error: () => "Sorry, I had trouble reading that. Try again or type your hours directly (e.g., \"Mon-Fri 9am-5pm\").",
  nudge_reminder: () => "Friendly reminder — send me your work schedule so we can find a time to meet!",
  session_expired: () => "Session expired. Send *new* to start a fresh one.",
  meetup_reminder: (ctx) => `Reminder: you have a meetup tomorrow!\n\n${ctx.matchResult}`,
  no_overlap: () => "Unfortunately, I couldn't find any overlapping free time between your schedules. Try uploading updated schedules or consider a different week.",
  mutual_match: (ctx) => `You both prefer the same slot!\n\n${ctx.matchResult}\n\nEnjoy your meetup!`,
  best_match: (ctx) => `Here's the best available slot:\n\n${ctx.matchResult}\n\n(No mutual preference matched, so I picked the top-ranked slot.)`,
};

/**
 * Generate a natural conversational response using Claude Haiku.
 * Falls back to static string if API fails or AI responses are disabled.
 */
export async function generateResponse(ctx: ResponseContext): Promise<string> {
  // Kill switch — env var to disable AI responses
  if (process.env.MEETSYNC_USE_AI_RESPONSES === "false") {
    return getStaticFallback(ctx);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return getStaticFallback(ctx);

  const instruction = SCENARIO_INSTRUCTIONS[ctx.scenario];
  if (!instruction) return getStaticFallback(ctx);

  // Build context message for Claude
  const parts: string[] = [
    `Scenario: ${ctx.scenario}`,
    `User state: ${ctx.state}`,
    `Instruction: ${instruction}`,
  ];
  if (ctx.userName) parts.push(`User's name: ${ctx.userName}`);
  if (ctx.userLanguage && ctx.userLanguage !== "en") parts.push(`User's preferred language: ${ctx.userLanguage} — reply in this language`);
  if (ctx.partnerName) parts.push(`Partner's name: ${ctx.partnerName}`);
  if (ctx.sessionCode) parts.push(`Session code: ${ctx.sessionCode}`);
  if (ctx.shiftList) parts.push(`Shift data (include exactly as-is):\n${ctx.shiftList}`);
  if (ctx.slotList) parts.push(`Slot options (include exactly as-is):\n${ctx.slotList}`);
  if (ctx.matchResult) parts.push(`Match result (include exactly as-is):\n${ctx.matchResult}`);
  if (ctx.userMessage) parts.push(`User's message: "${ctx.userMessage}"`);
  if (ctx.extraContext) parts.push(`Extra context: ${ctx.extraContext}`);

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
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: parts.join("\n") }],
      }),
    });

    if (!response.ok) {
      console.error(`Response generator API error: ${response.status}`);
      return getStaticFallback(ctx);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    const text = data.content.find((b) => b.type === "text")?.text?.trim();
    if (!text) return getStaticFallback(ctx);

    return text;
  } catch (err) {
    console.error("Response generation failed:", err);
    return getStaticFallback(ctx);
  }
}

function getStaticFallback(ctx: ResponseContext): string {
  const fn = STATIC_FALLBACKS[ctx.scenario];
  if (fn) return fn(ctx);
  return "Something went wrong. Send *help* if you're stuck.";
}
