// google-auth.ts — shared OAuth2 refresh-token flow for Gmail + Sheets clients.
// Pattern copied + adapted from meetsync/google-calendar.ts → refreshAccessToken().
// One refresh token covers both scopes (gmail.send + spreadsheets). Used by the
// monthly billing pulse (sheet-writer + alerts-log).

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

let cache: CachedToken | null = null;

/**
 * Returns a valid access token. Refreshes proactively 60s before expiry so a
 * long-running run doesn't die mid-request with a stale token.
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAtMs - 60_000 > now) return cache.accessToken;

  // Dedicated Desktop-type OAuth client. Scopes on the refresh token:
  // gmail.send + spreadsheets.
  const clientId = process.env.OAuth_Client_ID_Desktop;
  const clientSecret = process.env.OAuth_Client_Secret_Desktop;
  const refreshToken = process.env.Google_Refresh_Token;
  if (!clientId) throw new Error("OAuth_Client_ID_Desktop is not set");
  if (!clientSecret) throw new Error("OAuth_Client_Secret_Desktop is not set");
  if (!refreshToken) throw new Error("Google_Refresh_Token is not set");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    // invalid_grant = refresh token revoked/expired. User must re-run OAuth flow.
    throw new Error(`Google token refresh failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cache = {
    accessToken: data.access_token,
    expiresAtMs: now + data.expires_in * 1000,
  };
  return data.access_token;
}

/** Force a fresh token on next call — useful after auth errors. */
export function clearTokenCache(): void {
  cache = null;
}
