// WhatsApp Cloud API client — shared by all MeetSync tasks

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

function getConfig() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN is not set");
  if (!phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not set");
  return { token, phoneNumberId };
}

/** Send a plain text message to a WhatsApp number */
export async function sendTextMessage(to: string, text: string): Promise<void> {
  const { token, phoneNumberId } = getConfig();

  const response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${err}`);
  }
}

/** Send a document/file via WhatsApp (e.g., .ics calendar file) */
export async function sendDocumentMessage(
  to: string,
  fileContent: string,
  filename: string,
  caption?: string
): Promise<void> {
  const { token, phoneNumberId } = getConfig();

  // Step 1: Upload the file to WhatsApp media
  const formData = new FormData();
  const blob = new Blob([fileContent], { type: "text/calendar" });
  formData.append("file", blob, filename);
  formData.append("messaging_product", "whatsapp");
  formData.append("type", "text/calendar");

  const uploadResponse = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!uploadResponse.ok) {
    const err = await uploadResponse.text();
    throw new Error(`WhatsApp media upload failed (${uploadResponse.status}): ${err}`);
  }

  const { id: mediaId } = (await uploadResponse.json()) as { id: string };

  // Step 2: Send message with the uploaded media
  const response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        id: mediaId,
        filename,
        caption: caption ?? "Add to your calendar",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`WhatsApp document send failed (${response.status}): ${err}`);
  }
}

/** Download media from WhatsApp (returns the file as an ArrayBuffer + mime type) */
export async function downloadMedia(
  mediaId: string
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const { token } = getConfig();

  // Step 1: Get the download URL
  const metaResponse = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!metaResponse.ok) {
    throw new Error(`WhatsApp media metadata failed: ${metaResponse.status}`);
  }

  const meta = (await metaResponse.json()) as { url: string; mime_type: string };

  // Step 2: Download the actual file
  const fileResponse = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!fileResponse.ok) {
    throw new Error(`WhatsApp media download failed: ${fileResponse.status}`);
  }

  // Reject files over 10MB to prevent OOM
  const contentLength = fileResponse.headers.get("Content-Length");
  if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
    throw new Error("File too large (max 10MB)");
  }

  return {
    buffer: await fileResponse.arrayBuffer(),
    mimeType: meta.mime_type,
  };
}
