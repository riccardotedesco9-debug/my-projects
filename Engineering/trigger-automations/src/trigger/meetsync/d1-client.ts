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

export async function getParticipantByChatId(chatId: string) {
  const result = await query<{
    id: string;
    session_id: string;
    chat_id: string;
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
     WHERE p.chat_id = ?
       AND s.status NOT IN ('EXPIRED', 'COMPLETED')
       AND s.expires_at > datetime('now')
     ORDER BY p.created_at DESC LIMIT 1`,
    [chatId]
  );
  return result.results[0] ?? null;
}

export async function getSessionParticipants(sessionId: string) {
  const result = await query<{
    id: string;
    chat_id: string;
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

/**
 * Build a ground-truth snapshot of the session's state for injection into
 * response-generator prompts. The AI was hallucinating about schedule
 * ownership and participant count because it only saw conversation history
 * — which includes names mentioned in passing ("Diego") that the AI then
 * confidently claimed were real participants with real schedules. This
 * snapshot gives the AI the actual DB state so it can ground replies in
 * reality instead of pattern-matching from chat history.
 *
 * Call this from the response context builder — it's one extra D1 round
 * trip per reply (two SELECTs on small indexed tables), acceptable in
 * exchange for eliminating hallucinated-state bugs.
 */
export async function getSessionSnapshot(
  sessionId: string,
  selfChatId: string,
): Promise<string> {
  // Participants with schedule presence flag + names from users join
  const participantsResult = await query<{
    chat_id: string;
    state: string;
    has_schedule: number;
    name: string | null;
  }>(
    `SELECT p.chat_id, p.state,
            CASE WHEN p.schedule_json IS NOT NULL AND p.schedule_json != '' THEN 1 ELSE 0 END as has_schedule,
            u.name
     FROM participants p
     LEFT JOIN users u ON u.chat_id = p.chat_id
     WHERE p.session_id = ?
     ORDER BY p.created_at ASC`,
    [sessionId],
  );

  // Pending invites — people the creator has invited but who haven't
  // joined yet. These are NOT participants and have no schedule, but the
  // AI needs to know they exist so it doesn't confidently claim a
  // pending-invite person's schedule is "already in the system".
  const invitesResult = await query<{
    id: string;
    invitee_chat_id: string | null;
    status: string;
  }>(
    `SELECT id, invitee_chat_id, status
     FROM pending_invites
     WHERE session_id = ? AND status = 'PENDING'
     ORDER BY created_at ASC`,
    [sessionId],
  );

  const participants = participantsResult.results;
  const withSchedules = participants.filter((p) => p.has_schedule === 1);
  const pendingInvites = invitesResult.results;

  const lines: string[] = [];
  lines.push("[SESSION SNAPSHOT — ground your answer in THESE facts. Never claim to have data not listed here. Do not invent schedules, participants, or state.]");
  lines.push(`- Session id: ${sessionId.slice(0, 8)}`);
  lines.push(`- Schedules present: ${withSchedules.length} of ${participants.length + pendingInvites.length} total people`);
  lines.push(`- Participants in session (${participants.length}):`);
  for (const p of participants) {
    const who = p.chat_id === selfChatId ? `${p.name ?? "user"} (YOU)` : (p.name ?? `person ${p.chat_id.slice(-4)}`);
    const sched = p.has_schedule === 1 ? "schedule: ✓ UPLOADED" : "schedule: ✗ NOT YET";
    lines.push(`    • ${who} — state: ${p.state}, ${sched}`);
  }
  if (pendingInvites.length > 0) {
    lines.push(`- Pending invites (${pendingInvites.length}) — these people were mentioned but have NOT joined the session and have NO schedule:`);
    for (const inv of pendingInvites) {
      const who = inv.invitee_chat_id ? `person ${inv.invitee_chat_id.slice(-4)}` : "awaiting invite tap";
      lines.push(`    • ${who} — invite status: ${inv.status}`);
    }
  }

  // Actionable summary at the end so the AI sees the bottom line clearly.
  const needed = Math.max(2, participants.length + pendingInvites.length);
  const missing = needed - withSchedules.length;
  if (missing > 0) {
    lines.push(`- MISSING for a match: ${missing} more schedule${missing === 1 ? "" : "s"} needed before free-time can be computed.`);
  } else {
    lines.push(`- All schedules present — ready to compute free time.`);
  }

  return lines.join("\n");
}

/** Clear all data for a chat ID (reset) — expires sessions where user is a participant */
export async function resetUserData(chatId: string) {
  // Expire sessions where this user is creator
  await query(
    "UPDATE sessions SET status = 'EXPIRED' WHERE creator_chat_id = ? AND status NOT IN ('EXPIRED', 'COMPLETED')",
    [chatId]
  );
  // Expire sessions where this user is a participant
  await query(
    `UPDATE sessions SET status = 'EXPIRED' WHERE id IN (
      SELECT session_id FROM participants WHERE chat_id = ?
    ) AND status NOT IN ('EXPIRED', 'COMPLETED')`,
    [chatId]
  );
}

// --- Google Calendar token helpers ---

export async function getGoogleToken(chatId: string) {
  const result = await query<{
    access_token: string;
    refresh_token: string;
    expires_at: string;
  }>(
    "SELECT * FROM google_tokens WHERE chat_id = ?",
    [chatId]
  );
  return result.results[0] ?? null;
}

export async function saveGoogleToken(
  chatId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: string
) {
  await query(
    `INSERT INTO google_tokens (chat_id, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET access_token = ?, refresh_token = ?, expires_at = ?`,
    [chatId, accessToken, refreshToken, expiresAt, accessToken, refreshToken, expiresAt]
  );
}

// --- User knowledge base helpers ---

export interface UserProfile {
  chat_id: string;
  phone: string | null;
  username: string | null;
  name: string | null;
  preferred_language: string;
  context: string | null;
  timezone: string;
  first_seen: string;
  last_seen: string;
}

/** Update user's timezone */
export async function updateUserTimezone(chatId: string, timezone: string) {
  await query(
    "UPDATE users SET timezone = ?, last_seen = datetime('now') WHERE chat_id = ?",
    [timezone, chatId]
  );
}

/**
 * Best-effort IANA timezone from a Telegram language_code. Only covers
 * a handful of common cases; everything else falls back to Europe/Malta
 * (MeetSync's origin). Users can always override with an explicit tz.
 *
 * Intentionally NOT exhaustive — building a language→region→tz table is
 * out of scope. The goal is "don't silently put a Tokyo user on Malta
 * time"; for everyone else the default is fine until we learn otherwise.
 */
export function guessTimezoneFromLocale(languageCode?: string | null): string {
  if (!languageCode) return "Europe/Malta";
  const lc = languageCode.toLowerCase().split("-")[0];
  const map: Record<string, string> = {
    it: "Europe/Rome",
    en: "Europe/Malta",
    de: "Europe/Berlin",
    fr: "Europe/Paris",
    es: "Europe/Madrid",
    pt: "Europe/Lisbon",
    nl: "Europe/Amsterdam",
    pl: "Europe/Warsaw",
    sv: "Europe/Stockholm",
    fi: "Europe/Helsinki",
    ru: "Europe/Moscow",
    uk: "Europe/Kyiv",
    tr: "Europe/Istanbul",
    ja: "Asia/Tokyo",
    ko: "Asia/Seoul",
    zh: "Asia/Shanghai",
    vi: "Asia/Ho_Chi_Minh",
    th: "Asia/Bangkok",
    id: "Asia/Jakarta",
    hi: "Asia/Kolkata",
    ar: "Asia/Dubai",
    he: "Asia/Jerusalem",
  };
  return map[lc] ?? "Europe/Malta";
}

/**
 * Register or update a user — called on every inbound message.
 *
 * `telegramLanguageCode` is the `language_code` field from Telegram's
 * `from` payload (e.g. "en", "it", "ja-JP"). When present on the
 * first-insert path, we use it to guess an IANA timezone via
 * guessTimezoneFromLocale so calendar events render at the correct
 * wall-clock time for non-Malta users. On the ON-CONFLICT update we
 * deliberately do NOT touch timezone — once the row exists, only an
 * explicit updateUserTimezone call changes it, so users who override
 * their tz don't get reset by a new message with a different locale.
 */
export async function registerUser(
  chatId: string,
  name?: string,
  language?: string,
  telegramLanguageCode?: string,
) {
  const tz = guessTimezoneFromLocale(telegramLanguageCode);
  await query(
    `INSERT INTO users (chat_id, name, preferred_language, timezone)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       last_seen = datetime('now'),
       name = COALESCE(?, users.name),
       preferred_language = COALESCE(?, users.preferred_language)`,
    [chatId, name ?? null, language ?? "en", tz, name ?? null, language ?? null]
  );
}

/** Get full user profile */
export async function getUser(chatId: string): Promise<UserProfile | null> {
  const result = await query<UserProfile>(
    "SELECT * FROM users WHERE chat_id = ?",
    [chatId]
  );
  return result.results[0] ?? null;
}

/** Update user's display name */
export async function updateUserName(chatId: string, name: string) {
  await query(
    "UPDATE users SET name = ?, last_seen = datetime('now') WHERE chat_id = ?",
    [name, chatId]
  );
}

/** Store user's phone number (from Telegram contact sharing) */
export async function updateUserPhone(chatId: string, phone: string) {
  await query(
    "UPDATE users SET phone = ?, last_seen = datetime('now') WHERE chat_id = ?",
    [phone, chatId]
  );
}

/** Store user's Telegram username */
export async function updateUserUsername(chatId: string, username: string) {
  await query(
    "UPDATE users SET username = ?, last_seen = datetime('now') WHERE chat_id = ?",
    [username, chatId]
  );
}

/** Append learned facts to user's context (newline-separated, capped at 2000 chars) */
export async function appendUserContext(chatId: string, facts: string) {
  // Sanitize: reject facts that look like prompt injection attempts
  const lower = facts.toLowerCase();
  if (lower.includes("ignore") && lower.includes("instruction")) return;
  if (lower.includes("system prompt")) return;

  // Cap individual fact length
  const sanitized = facts.slice(0, 300);

  // Append and trim to 2000 chars total (keeps most recent facts)
  await query(
    `UPDATE users SET context = substr(CASE
       WHEN context IS NULL THEN ?
       ELSE context || char(10) || ?
     END, -2000), last_seen = datetime('now') WHERE chat_id = ?`,
    [sanitized, sanitized, chatId]
  );
}

/** Update user's preferred language */
export async function updateUserLanguage(chatId: string, language: string) {
  await query(
    "UPDATE users SET preferred_language = ?, last_seen = datetime('now') WHERE chat_id = ?",
    [language, chatId]
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

/** Exact lookup by phone (for partner matching via shared contacts) */
export async function findUserByPhone(phone: string): Promise<UserProfile | null> {
  const result = await query<UserProfile>(
    "SELECT * FROM users WHERE phone = ?",
    [phone]
  );
  return result.results[0] ?? null;
}

// --- Pending invite helpers ---

export async function createPendingInvite(
  inviterChatId: string,
  inviteeChatId: string | null,
  sessionId: string,
  inviteePhone?: string
) {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  await query(
    `INSERT INTO pending_invites (id, inviter_chat_id, invitee_chat_id, invitee_phone, session_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, inviterChatId, inviteeChatId, inviteePhone ?? null, sessionId, expiresAt]
  );
  return id;
}

/** Check if someone has been invited — returns the active invite if any */
export async function getPendingInviteForChatId(chatId: string) {
  const result = await query<{
    id: string;
    inviter_chat_id: string;
    invitee_chat_id: string | null;
    invitee_phone: string | null;
    session_id: string;
    status: string;
    expires_at: string;
  }>(
    `SELECT * FROM pending_invites
     WHERE invitee_chat_id = ? AND status = 'PENDING' AND expires_at > datetime('now')
     ORDER BY created_at DESC LIMIT 1`,
    [chatId]
  );
  return result.results[0] ?? null;
}

/** Update invite status (ACCEPTED, EXPIRED, CANCELLED, OUTREACH_SENT) */
export async function updateInviteStatus(id: string, status: string) {
  await query(
    "UPDATE pending_invites SET status = ? WHERE id = ?",
    [status, id]
  );
}

// --- Session helpers ---

/** Fetch a session by ID */
export async function getSessionById(sessionId: string) {
  const result = await query<{
    id: string;
    code: string;
    creator_chat_id: string;
    status: string;
    mode: string | null;
    expires_at: string;
    both_confirmed_token_id: string | null;
    both_preferred_token_id: string | null;
  }>(
    "SELECT * FROM sessions WHERE id = ?",
    [sessionId]
  );
  return result.results[0] ?? null;
}

/** Get all non-creator participants for a session */
export async function getOtherParticipants(sessionId: string, excludeChatId: string) {
  const result = await query<{
    id: string;
    chat_id: string;
    role: string;
    state: string;
  }>(
    "SELECT * FROM participants WHERE session_id = ? AND chat_id != ?",
    [sessionId, excludeChatId]
  );
  return result.results;
}

/** Count participants in a session */
export async function getParticipantCount(sessionId: string): Promise<number> {
  const result = await query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM participants WHERE session_id = ?",
    [sessionId]
  );
  return result.results[0]?.cnt ?? 0;
}

/** Count pending invites for a session (people invited via deep link who haven't joined yet) */
export async function getPendingInviteCount(sessionId: string): Promise<number> {
  const result = await query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM pending_invites WHERE session_id = ? AND status = 'PENDING'",
    [sessionId]
  );
  return result.results[0]?.cnt ?? 0;
}

/**
 * Look up a user's stored name + preferred language in one call.
 * Used by every task that sends replies on behalf of a specific chat_id
 * so outbound messages stay personalized and in the user's language.
 */
export async function getReplyContext(chatId: string): Promise<{ userName?: string; userLanguage?: string }> {
  const user = await getUser(chatId);
  return {
    userName: user?.name ?? undefined,
    userLanguage: user?.preferred_language ?? undefined,
  };
}

/**
 * Look up a user's timezone (IANA string, e.g. "Europe/Rome"), falling
 * back to Europe/Malta when the user row is missing or the column is
 * null. Used by schedule-parser (weekday-lookup "today" computation)
 * and deliver-results (.ics + Google Calendar timezone fields) so
 * non-Malta users don't get dates drifted by 1+ hours.
 */
export async function getUserTimezone(chatId: string): Promise<string> {
  const user = await getUser(chatId);
  return user?.timezone ?? "Europe/Malta";
}

/** Find pending invite for a session */
export async function getPendingInviteForSession(sessionId: string) {
  const result = await query<{
    id: string;
    inviter_chat_id: string;
    invitee_chat_id: string | null;
    invitee_phone: string | null;
    session_id: string;
    status: string;
    expires_at: string;
  }>(
    "SELECT * FROM pending_invites WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
    [sessionId]
  );
  return result.results[0] ?? null;
}

/** Update session mode (NULL = classic, 'MEDIATED' = share availability) */
export async function updateSessionMode(sessionId: string, mode: string | null) {
  await query("UPDATE sessions SET mode = ? WHERE id = ?", [mode, sessionId]);
}

// --- Conversation log helpers ---

/**
 * Log a message to the conversation history. Returns the inserted row id —
 * callers that need to know "which row is mine" (e.g. the consolidation race
 * guard in message-router) rely on this to avoid confusing their own insert
 * with a concurrent run's insert.
 */
export async function logMessage(
  chatId: string,
  role: "user" | "bot",
  message: string
): Promise<number> {
  // Cap message length to prevent bloat
  const trimmed = message.slice(0, 500);
  const result = await query(
    "INSERT INTO conversation_log (chat_id, role, message) VALUES (?, ?, ?)",
    [chatId, role, trimmed]
  );
  // Keep only last 20 messages per user (best-effort cleanup)
  query(
    `DELETE FROM conversation_log WHERE chat_id = ? AND id NOT IN (
      SELECT id FROM conversation_log WHERE chat_id = ? ORDER BY created_at DESC LIMIT 20
    )`,
    [chatId, chatId]
  ).catch(() => {});
  return result.meta.last_row_id;
}

/** Get recent conversation history for a user (last 12 messages) */
export async function getRecentMessages(chatId: string) {
  const result = await query<{ role: string; message: string; created_at: string }>(
    "SELECT role, message, created_at FROM conversation_log WHERE chat_id = ? ORDER BY created_at DESC LIMIT 12",
    [chatId]
  );
  // Reverse so oldest first (chronological order)
  return result.results.reverse();
}

/**
 * Log a session-level event for observability. Fire-and-forget — if the
 * insert fails we swallow the error rather than blow up the happy path.
 * The round-8 audit found stuck sessions were invisible until users
 * complained; emitting an event at every material transition means the
 * stuck-session query is:
 *   SELECT session_id, MAX(created_at) FROM session_events
 *    GROUP BY session_id
 *    HAVING MAX(created_at) < datetime('now','-10 minutes')
 *
 * `data` is a free-form JSON string (caller's choice of payload).
 */
export async function emitSessionEvent(
  sessionId: string,
  event: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    await query(
      "INSERT INTO session_events (session_id, event, data) VALUES (?, ?, ?)",
      [sessionId, event, data ? JSON.stringify(data) : null]
    );
  } catch (err) {
    console.warn(`[session-events] emit failed for ${sessionId}/${event}:`, err);
  }
}
