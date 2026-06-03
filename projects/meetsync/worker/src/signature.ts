// Validate Telegram webhook secret token header
// Telegram sends X-Telegram-Bot-Api-Secret-Token on every webhook request

export function verifyTelegramSecret(
  headerValue: string | null,
  expectedSecret: string
): boolean {
  if (!headerValue || !expectedSecret) return false;
  if (headerValue.length !== expectedSecret.length) return false;

  // Constant-time comparison to prevent timing attacks
  let mismatch = 0;
  for (let i = 0; i < headerValue.length; i++) {
    mismatch |= headerValue.charCodeAt(i) ^ expectedSecret.charCodeAt(i);
  }

  return mismatch === 0;
}
