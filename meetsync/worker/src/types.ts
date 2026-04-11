// Telegram Bot API webhook types

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  TRIGGERDEV_API_KEY: string;
  TRIGGERDEV_API_URL: string;
  ADMIN_CHAT_ID: string; // Your Telegram chat ID — only this user can run admin commands
  ANTHROPIC_API_KEY: string; // For admin command classification via Haiku
}

// --- Incoming Telegram update ---

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string };
  date: number; // Unix timestamp
  text?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: TelegramVoice;
  contact?: TelegramContact;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  // IETF BCP 47 language tag of the user's Telegram client (e.g. "en",
  // "it", "ja-JP"). Used by the router to guess an IANA timezone for
  // first-time users.
  language_code?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramContact {
  phone_number: string;
  first_name: string;
  last_name?: string;
  user_id?: number;
}
