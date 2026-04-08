// WhatsApp Cloud API webhook payload types

export interface Env {
  DB: D1Database;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_VERIFY_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
  TRIGGERDEV_API_KEY: string;
  TRIGGERDEV_API_URL: string;
  ADMIN_PHONE: string; // Your phone number — only this number can run admin commands
  ANTHROPIC_API_KEY: string; // For admin command classification via Haiku
}

// --- Incoming webhook payload ---

export interface WebhookPayload {
  object: "whatsapp_business_account";
  entry: WebhookEntry[];
}

export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

export interface WebhookChange {
  value: {
    messaging_product: "whatsapp";
    metadata: {
      display_phone_number: string;
      phone_number_id: string;
    };
    contacts?: Array<{
      profile: { name: string };
      wa_id: string;
    }>;
    messages?: WhatsAppMessage[];
    statuses?: Array<{ id: string; status: string }>;
  };
  field: "messages";
}

export interface WhatsAppMessage {
  from: string; // sender phone number (E.164 without +)
  id: string;
  timestamp: string;
  type: "text" | "image" | "document" | "audio" | "video" | "sticker" | "reaction" | "interactive";
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  audio?: { id: string; mime_type: string };
}
