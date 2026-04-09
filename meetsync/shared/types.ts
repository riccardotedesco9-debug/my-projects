// Shared types between Cloudflare Worker and Trigger.dev tasks

// --- Session & Participant ---

export type SessionStatus = "OPEN" | "AWAITING_PARTNER" | "PAIRED" | "MATCHING" | "COMPLETED" | "EXPIRED";

export type ParticipantRole = "creator" | "partner";

export type ParticipantState =
  | "IDLE"
  | "AWAITING_PARTNER_INFO"
  | "AWAITING_PARTNER"
  | "AWAITING_SCHEDULE"
  | "SCHEDULE_RECEIVED"
  | "AWAITING_CONFIRMATION"
  | "SCHEDULE_CONFIRMED"
  | "AWAITING_PREFERENCES"
  | "PREFERENCES_SUBMITTED"
  | "COMPLETED"
  | "EXPIRED";

export interface Session {
  id: string;
  code: string;
  creator_chat_id: string;
  status: SessionStatus;
  created_at: string;
  expires_at: string;
  both_confirmed_token_id: string | null;
  both_preferred_token_id: string | null;
}

export interface Participant {
  id: string;
  session_id: string;
  chat_id: string;
  role: ParticipantRole;
  state: ParticipantState;
  schedule_json: string | null;
  preferred_slots: string | null;
  created_at: string;
  updated_at: string;
}

// --- Schedule Parsing ---

export interface ParsedShift {
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM (24h)
  end_time: string; // HH:MM (24h)
  label?: string; // optional description (e.g., "Morning shift")
}

// --- Free Slots ---

export interface FreeSlot {
  id: string;
  session_id: string;
  slot_number: number;
  day: string; // YYYY-MM-DD
  day_name: string; // "Monday", "Tuesday", etc.
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  duration_minutes: number;
}

// --- Trigger.dev Task Payloads ---

export interface MessageRouterPayload {
  chat_id: string;
  message_type: "text" | "image" | "document" | "audio" | "contact" | "unknown";
  text?: string;
  media_id?: string;
  mime_type?: string;
  contact_phone?: string; // phone number from Telegram "share contact"
  timestamp: string;
}

export interface ScheduleParserPayload {
  participant_id: string;
  session_id: string;
  chat_id: string;
  media_id: string;
  mime_type: string;
}

export interface MatchComputePayload {
  session_id: string;
}

export interface DeliverResultsPayload {
  session_id: string;
}
