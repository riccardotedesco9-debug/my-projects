// Cloudflare D1 HTTP API client — access D1 from Trigger.dev tasks

interface D1QueryResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes: number; last_row_id: number; rows_read: number; rows_written: number };
}

function getConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not set");
  if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN is not set");
  if (!databaseId) throw new Error("CLOUDFLARE_D1_DATABASE_ID is not set");
  return { accountId, apiToken, databaseId };
}

/** Execute a D1 SQL query via HTTP API */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<D1QueryResult<T>> {
  const { accountId, apiToken, databaseId } = getConfig();

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ sql, params }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`D1 query failed (${response.status}): ${err}`);
  }

  const data = (await response.json()) as { result: D1QueryResult<T>[] };
  return data.result[0];
}

// --- Convenience helpers ---

export async function getParticipantByPhone(phone: string) {
  const result = await query<{
    id: string;
    session_id: string;
    phone: string;
    role: string;
    state: string;
    schedule_json: string | null;
    preferred_slots: string | null;
    session_status: string;
    session_code: string;
  }>(
    `SELECT p.*, s.status as session_status, s.code as session_code
     FROM participants p
     JOIN sessions s ON p.session_id = s.id
     WHERE p.phone = ?
       AND s.status NOT IN ('EXPIRED', 'COMPLETED')
       AND s.expires_at > datetime('now')
     ORDER BY p.created_at DESC LIMIT 1`,
    [phone]
  );
  return result.results[0] ?? null;
}

export async function getSessionParticipants(sessionId: string) {
  const result = await query<{
    id: string;
    phone: string;
    role: string;
    state: string;
    schedule_json: string | null;
    preferred_slots: string | null;
  }>(
    "SELECT * FROM participants WHERE session_id = ?",
    [sessionId]
  );
  return result.results;
}

export async function updateParticipantState(
  participantId: string,
  state: string,
  extra?: Record<string, unknown>
) {
  const sets = ["state = ?", "updated_at = datetime('now')"];
  const params: unknown[] = [state];

  if (extra) {
    const ALLOWED_COLUMNS = new Set(["schedule_json", "preferred_slots"]);
    for (const [key, value] of Object.entries(extra)) {
      if (!ALLOWED_COLUMNS.has(key)) throw new Error(`Invalid column: ${key}`);
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }

  params.push(participantId);
  await query(`UPDATE participants SET ${sets.join(", ")} WHERE id = ?`, params);
}

export async function updateSessionStatus(sessionId: string, status: string) {
  await query("UPDATE sessions SET status = ? WHERE id = ?", [status, sessionId]);
}

// --- Partner helpers ---

/** Find an existing scheduling partner for this phone number */
export async function getPartnerForPhone(phone: string) {
  const result = await query<{
    id: string;
    phone_a: string;
    phone_b: string;
    last_session_id: string | null;
  }>(
    "SELECT * FROM partners WHERE phone_a = ? OR phone_b = ? ORDER BY created_at DESC LIMIT 1",
    [phone, phone]
  );
  return result.results[0] ?? null;
}

/** Save a partner pair after a completed session */
export async function savePartner(phoneA: string, phoneB: string, sessionId: string) {
  // Always store in sorted order for consistent deduplication
  const [a, b] = [phoneA, phoneB].sort();
  await query(
    `INSERT INTO partners (id, phone_a, phone_b, last_session_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(phone_a, phone_b) DO UPDATE SET last_session_id = ?`,
    [crypto.randomUUID(), a, b, sessionId, sessionId]
  );
}

/** Remove partner link for a phone number */
export async function clearPartner(phone: string) {
  await query(
    "DELETE FROM partners WHERE phone_a = ? OR phone_b = ?",
    [phone, phone]
  );
}

/** Clear all data for a phone number (reset) */
export async function resetUserData(phone: string) {
  await clearPartner(phone);
  await query(
    "UPDATE sessions SET status = 'EXPIRED' WHERE (creator_phone = ? OR partner_phone = ?) AND status NOT IN ('EXPIRED', 'COMPLETED')",
    [phone, phone]
  );
}

// --- Google Calendar token helpers ---

export async function getGoogleToken(phone: string) {
  const result = await query<{
    access_token: string;
    refresh_token: string;
    expires_at: string;
  }>(
    "SELECT * FROM google_tokens WHERE phone = ?",
    [phone]
  );
  return result.results[0] ?? null;
}

export async function saveGoogleToken(
  phone: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: string
) {
  await query(
    `INSERT INTO google_tokens (phone, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET access_token = ?, refresh_token = ?, expires_at = ?`,
    [phone, accessToken, refreshToken, expiresAt, accessToken, refreshToken, expiresAt]
  );
}

// --- User knowledge base helpers ---

export interface UserProfile {
  phone: string;
  name: string | null;
  preferred_language: string;
  first_seen: string;
  last_seen: string;
}

/** Register or update a user — called on every inbound message */
export async function registerUser(phone: string, name?: string, language?: string) {
  await query(
    `INSERT INTO users (phone, name, preferred_language)
     VALUES (?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET
       last_seen = datetime('now'),
       name = COALESCE(?, users.name),
       preferred_language = COALESCE(?, users.preferred_language)`,
    [phone, name ?? null, language ?? "en", name ?? null, language ?? null]
  );
}

/** Get full user profile */
export async function getUser(phone: string): Promise<UserProfile | null> {
  const result = await query<UserProfile>(
    "SELECT * FROM users WHERE phone = ?",
    [phone]
  );
  return result.results[0] ?? null;
}

/** Update user's display name */
export async function updateUserName(phone: string, name: string) {
  await query(
    "UPDATE users SET name = ?, last_seen = datetime('now') WHERE phone = ?",
    [name, phone]
  );
}

/** Update user's preferred language */
export async function updateUserLanguage(phone: string, language: string) {
  await query(
    "UPDATE users SET preferred_language = ?, last_seen = datetime('now') WHERE phone = ?",
    [language, phone]
  );
}

/** Fuzzy search users by name */
export async function findUserByName(name: string) {
  // Escape LIKE wildcards to prevent data enumeration
  const escaped = name.replace(/%/g, "\\%").replace(/_/g, "\\_");
  const result = await query<UserProfile>(
    "SELECT * FROM users WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE",
    [`%${escaped}%`]
  );
  return result.results;
}

/** Exact lookup by phone */
export async function findUserByPhone(phone: string): Promise<UserProfile | null> {
  return getUser(phone);
}

// --- Pending invite helpers ---

export async function createPendingInvite(
  inviterPhone: string,
  inviteePhone: string,
  sessionId: string
) {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  await query(
    `INSERT INTO pending_invites (id, inviter_phone, invitee_phone, session_id, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, inviterPhone, inviteePhone, sessionId, expiresAt]
  );
  return id;
}

/** Check if someone has been invited — returns the active invite if any */
export async function getPendingInviteForPhone(phone: string) {
  const result = await query<{
    id: string;
    inviter_phone: string;
    invitee_phone: string;
    session_id: string;
    status: string;
    expires_at: string;
  }>(
    `SELECT * FROM pending_invites
     WHERE invitee_phone = ? AND status = 'PENDING' AND expires_at > datetime('now')
     ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  return result.results[0] ?? null;
}

/** Update invite status (ACCEPTED, EXPIRED, CANCELLED) */
export async function updateInviteStatus(id: string, status: string) {
  await query(
    "UPDATE pending_invites SET status = ? WHERE id = ?",
    [status, id]
  );
}
