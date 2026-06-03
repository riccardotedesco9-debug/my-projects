// gmail-client.ts — Gmail REST v1 via native fetch. Uses the shared OAuth2
// refresh token (scope gmail.send). We use users.messages.send with a raw
// RFC 2822 message, base64url-encoded.

import { getAccessToken } from "./google-auth.js";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export async function sendEmail(input: EmailInput): Promise<void> {
  const token = await getAccessToken();
  const raw = buildRawMessage(input);

  const resp = await fetch(`${GMAIL_BASE}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: base64url(raw) }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Gmail send failed (${resp.status}): ${body}`);
  }
}

/** Build a minimal multipart/alternative RFC 2822 message with HTML body. */
function buildRawMessage({ to, subject, html, replyTo }: EmailInput): string {
  const headers: string[] = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
  ];
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  const bodyB64 = Buffer.from(html, "utf8").toString("base64");
  return `${headers.join("\r\n")}\r\n\r\n${bodyB64}`;
}

function base64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
