// Schedule parser — extracts work shifts from images/PDFs/text via Claude API
// Supports file uploads (WhatsApp media) and typed schedule descriptions

import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { downloadMedia, sendTextMessage } from "./whatsapp-client.js";
import { updateParticipantState } from "./d1-client.js";
import { generateResponse } from "./response-generator.js";

// Accepts either media (file upload) or text_content (typed schedule)
const payloadSchema = z.object({
  participant_id: z.string(),
  session_id: z.string(),
  phone: z.string(),
  media_id: z.string().optional(),
  mime_type: z.string().optional(),
  text_content: z.string().optional(),
});

const parsedShiftSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  label: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const parseResultSchema = z.object({
  shifts: z.array(parsedShiftSchema),
  date_range: z.string().optional(),
  person_name: z.string().optional(),
});

function getExtractionPrompt(): string {
  const today = new Date().toISOString().split("T")[0];
  return `You are analyzing a work schedule. Extract ALL work shifts into structured JSON.

Rules:
- Return a JSON object with a "shifts" array
- Each shift: { "date": "YYYY-MM-DD", "start_time": "HH:MM", "end_time": "HH:MM", "label": "optional description", "confidence": 0.0-1.0 }
- Use 24-hour format for times
- Only include actual work shifts (not days off, holidays, or breaks)
- confidence: 1.0 = clearly legible/unambiguous, 0.7-0.9 = mostly sure, below 0.7 = uncertain
- If a person's name is visible, include it as "person_name" in the top-level object
- If the date range is visible (e.g., "April 2026"), include it as "date_range"
- If you can't determine exact dates, use the most recent/upcoming matching dates (today is ${today})
- Return ONLY the JSON object, no other text

Example:
{
  "shifts": [
    { "date": "2026-04-07", "start_time": "09:00", "end_time": "17:00", "label": "Day shift", "confidence": 1.0 },
    { "date": "2026-04-08", "start_time": "14:00", "end_time": "22:00", "label": "Afternoon", "confidence": 0.8 }
  ]
}`; // end of template literal
} // end of getExtractionPrompt

export const scheduleParser = schemaTask({
  id: "meetsync-schedule-parser",
  schema: payloadSchema,
  maxDuration: 120,
  retry: { maxAttempts: 2 },

  run: async (payload) => {
    const { participant_id, phone, media_id, mime_type, text_content } = payload;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

    try {
      let shifts: Array<{
        date: string;
        start_time: string;
        end_time: string;
        label?: string;
        confidence?: number;
      }>;

      if (text_content) {
        // Text-based schedule input
        shifts = await parseTextWithClaude(apiKey, text_content);
      } else if (media_id && mime_type) {
        // File upload (image/PDF)
        const { buffer } = await downloadMedia(media_id);
        const base64 = arrayBufferToBase64(buffer);
        const claudeMediaType = mapMimeType(mime_type);
        shifts = await parseMediaWithClaude(apiKey, base64, claudeMediaType);
      } else {
        throw new Error("No media_id or text_content provided");
      }

      if (shifts.length === 0) {
        await updateParticipantState(participant_id, "AWAITING_SCHEDULE");
        await sendTextMessage(phone, await generateResponse({
          scenario: "no_shifts_found", state: "AWAITING_SCHEDULE",
        }));
        return { success: false, reason: "no_shifts_found" };
      }

      // Store all parsed shifts (no weekday filter — user may work weekends or need a full month view)
      const scheduleJson = JSON.stringify(shifts);
      await updateParticipantState(participant_id, "AWAITING_CONFIRMATION", {
        schedule_json: scheduleJson,
      });

      // Format shifts for display with confidence warnings
      const shiftList = formatShiftList(shifts);

      await sendTextMessage(phone, await generateResponse({
        scenario: "shifts_extracted", state: "AWAITING_CONFIRMATION",
        shiftList, extraContext: `${shifts.length} shifts extracted`,
      }));

      return { success: true, shift_count: shifts.length };
    } catch (err) {
      console.error("Schedule parsing error:", err);
      await updateParticipantState(participant_id, "AWAITING_SCHEDULE");
      await sendTextMessage(phone, await generateResponse({
        scenario: "parse_error", state: "AWAITING_SCHEDULE",
      }));
      return { success: false, reason: String(err) };
    }
  },
});

// --- Claude API calls ---

async function parseTextWithClaude(apiKey: string, text: string) {
  return await callClaude(apiKey, [
    { type: "text", text: `${getExtractionPrompt()}\n\nSchedule description:\n${text}` },
  ]);
}

async function parseMediaWithClaude(apiKey: string, base64Data: string, mediaType: string) {
  const isPdf = mediaType === "application/pdf";
  const mediaBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64Data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } };

  return await callClaude(apiKey, [mediaBlock, { type: "text", text: getExtractionPrompt() }]);
}

async function callClaude(
  apiKey: string,
  content: Array<Record<string, unknown>>
): Promise<Array<{ date: string; start_time: string; end_time: string; label?: string; confidence?: number }>> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error (${response.status}): ${err}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  const textBlock = data.content.find((b) => b.type === "text");
  if (!textBlock?.text) throw new Error("No text response from Claude");

  const jsonStr = textBlock.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  const parsed = parseResultSchema.parse(JSON.parse(jsonStr));
  return parsed.shifts;
}

// --- Display formatting ---

function formatShiftList(
  shifts: Array<{ date: string; start_time: string; end_time: string; label?: string; confidence?: number }>
): string {
  const MAX_DISPLAY = 15;
  const display = shifts.slice(0, MAX_DISPLAY);
  const CONFIDENCE_THRESHOLD = 0.85;

  const lines = display.map((s) => {
    const dayName = new Date(s.date).toLocaleDateString("en-US", { weekday: "short" });
    const timeRange = `${s.start_time}-${s.end_time}`;
    const label = s.label ? ` (${s.label})` : "";
    const warning = (s.confidence !== undefined && s.confidence < CONFIDENCE_THRESHOLD)
      ? " ⚠️ _not 100% sure_"
      : "";
    return `- ${dayName} ${s.date}: ${timeRange}${label}${warning}`;
  });

  if (shifts.length > MAX_DISPLAY) {
    lines.push(`...and ${shifts.length - MAX_DISPLAY} more shifts.`);
  }

  return lines.join("\n");
}

// --- Utils ---

function mapMimeType(mime: string): string {
  if (mime.startsWith("image/jpeg")) return "image/jpeg";
  if (mime.startsWith("image/png")) return "image/png";
  if (mime.startsWith("image/webp")) return "image/webp";
  if (mime.startsWith("application/pdf")) return "application/pdf";
  return "image/jpeg";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
