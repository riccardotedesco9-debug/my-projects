// Telegram Bot API client — shared by all MeetSync tasks

const TELEGRAM_API_BASE = "https://api.telegram.org";

function getConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return { token };
}

/** Send a plain text message to a Telegram chat */
export async function sendTextMessage(chatId: string, text: string): Promise<void> {
  const { token } = getConfig();

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Telegram send failed (${response.status}): ${err}`);
  }
}

/** Send a document/file via Telegram (e.g., .ics calendar file) */
export async function sendDocumentMessage(
  chatId: string,
  fileContent: string,
  filename: string,
  caption?: string
): Promise<void> {
  const { token } = getConfig();

  // Telegram accepts file upload in a single multipart request
  const formData = new FormData();
  formData.append("chat_id", chatId);
  const blob = new Blob([fileContent], { type: "text/calendar" });
  formData.append("document", blob, filename);
  if (caption) formData.append("caption", caption);

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendDocument`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Telegram document send failed (${response.status}): ${err}`);
  }
}

/** Transcribe audio using Cloudflare Workers AI (Whisper model) */
export async function transcribeAudio(audioBuffer: ArrayBuffer): Promise<string> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new Error("Cloudflare credentials not set");

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/openai/whisper`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: audioBuffer,
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Transcription failed (${response.status}): ${err}`);
  }

  const data = (await response.json()) as { result?: { text?: string } };
  return data.result?.text?.trim() ?? "";
}

/** Download media from Telegram (returns the file as an ArrayBuffer + mime type) */
export async function downloadMedia(
  fileId: string
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const { token } = getConfig();

  // Step 1: Get file path from Telegram
  const fileResponse = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );

  if (!fileResponse.ok) {
    throw new Error(`Telegram getFile failed: ${fileResponse.status}`);
  }

  const fileData = (await fileResponse.json()) as {
    ok: boolean;
    result?: { file_path?: string; file_size?: number };
  };

  if (!fileData.ok || !fileData.result?.file_path) {
    throw new Error("Telegram getFile returned no file_path");
  }

  const filePath = fileData.result.file_path;

  // Reject files over 10MB to prevent OOM
  if (fileData.result.file_size && fileData.result.file_size > 10 * 1024 * 1024) {
    throw new Error("File too large (max 10MB)");
  }

  // Step 2: Download the actual file
  const downloadResponse = await fetch(
    `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`
  );

  if (!downloadResponse.ok) {
    throw new Error(`Telegram file download failed: ${downloadResponse.status}`);
  }

  // Infer mime type from file extension
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
  };

  return {
    buffer: await downloadResponse.arrayBuffer(),
    mimeType: mimeMap[ext] ?? "application/octet-stream",
  };
}
