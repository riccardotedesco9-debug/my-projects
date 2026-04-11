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

// --- Per-person knowledge notes ---
//
// person_notes stores structured data about people a user has mentioned but
// who may or may not have joined the bot yet. Enables schedule-on-behalf
// uploads, accumulated learned facts per person, and cross-session reuse
// ("schedule with Diego again — use his saved schedule").

export interface PersonNote {
  id: number;
  owner_chat_id: string;
  name: string;
  name_normalized: string;
  phone: string | null;
  linked_chat_id: string | null;
  schedule_json: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function normalizePersonName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Upsert a person_notes row. First mention creates the row with just the
 * display name. Subsequent mentions with optional fields (phone, notes)
 * update those fields without clobbering anything set by a previous call.
 * The unique constraint on (owner_chat_id, name_normalized) makes repeat
 * mentions idempotent.
 */
export async function upsertPersonNote(
  ownerChatId: string,
  name: string,
  opts: { phone?: string; notes?: string } = {},
): Promise<void> {
  const normalized = normalizePersonName(name);
  if (!normalized) return; // Guard against empty / whitespace-only names

  const noteFragment = opts.notes ? opts.notes.trim() : null;
  const phone = opts.phone ? opts.phone.replace(/[^0-9+]/g, "") : null;

  // INSERT first — if the row already exists the UNIQUE constraint will fire
  // and we fall through to UPDATE. Doing it in this order means a fresh
  // mention always creates a row with exactly the data from the current turn,
  // while repeat mentions preserve any previously-accumulated fields.
  await query(
    `INSERT INTO person_notes (owner_chat_id, name, name_normalized, phone, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(owner_chat_id, name_normalized) DO UPDATE SET
       name = CASE WHEN excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name ELSE person_notes.name END,
       phone = COALESCE(excluded.phone, person_notes.phone),
       notes = CASE
         WHEN excluded.notes IS NULL THEN person_notes.notes
         WHEN person_notes.notes IS NULL THEN excluded.notes
         ELSE person_notes.notes || char(10) || excluded.notes
       END,
       updated_at = datetime('now')`,
    [ownerChatId, name.trim(), normalized, phone, noteFragment],
  );
}

/** Look up a person_note by owner + name. Returns null if not found. */
export async function findPersonNote(
  ownerChatId: string,
  name: string,
): Promise<PersonNote | null> {
  const normalized = normalizePersonName(name);
  if (!normalized) return null;
  const result = await query<PersonNote>(
    `SELECT * FROM person_notes WHERE owner_chat_id = ? AND name_normalized = ? LIMIT 1`,
    [ownerChatId, normalized],
  );
  return result.results[0] ?? null;
}

/** All people known to a given owner. Used by the session snapshot so the
 *  AI sees who the user has talked to the bot about before. */
export async function getPersonNotesForOwner(
  ownerChatId: string,
): Promise<PersonNote[]> {
  const result = await query<PersonNote>(
    `SELECT * FROM person_notes WHERE owner_chat_id = ? ORDER BY updated_at DESC`,
    [ownerChatId],
  );
  return result.results;
}

/** Store/overwrite a pre-parsed schedule on a person_note (schedule-on-behalf path).
 *  Called by schedule-parser when the uploader explicitly attributes a photo
 *  to a named third party ("here's Diego's schedule"). */
export async function setPersonNoteSchedule(
  ownerChatId: string,
  name: string,
  scheduleJson: string,
): Promise<void> {
  const normalized = normalizePersonName(name);
  if (!normalized) return;
  await query(
    `UPDATE person_notes SET schedule_json = ?, updated_at = datetime('now')
     WHERE owner_chat_id = ? AND name_normalized = ?`,
    [scheduleJson, ownerChatId, normalized],
  );
}

/**
 * Link an existing person_note to a real chat_id (e.g. when Diego taps the
 * invite link and becomes a real user). Preserves the original row rather
 * than creating a duplicate under users. Returns the pre-existing notes row
 * if one was found and linked, or null if no prior notes exist for this name.
 *
 * Why lookup by name not chat_id: when Diego joins, we don't know which
 * owner had notes about him until we check. In practice the caller passes
 * the inviter's chat_id (from the pending_invite that triggered the join).
 */
export async function linkPersonNoteToChat(
  ownerChatId: string,
  name: string,
  linkedChatId: string,
): Promise<PersonNote | null> {
  const normalized = normalizePersonName(name);
  if (!normalized) return null;

  const existing = await findPersonNote(ownerChatId, name);
  if (!existing) return null;

  // Already linked to a different chat_id — someone else with the same name
  // already joined. Leave the old link alone and return null to signal the
  // caller should not transfer the schedule (would be wrong data).
  if (existing.linked_chat_id && existing.linked_chat_id !== linkedChatId) {
    return null;
  }

  await query(
    `UPDATE person_notes SET linked_chat_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [linkedChatId, existing.id],
  );
  return { ...existing, linked_chat_id: linkedChatId };
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
  // joined yet. These are NOT participants and have no schedule of their
  // own, but may have a person_notes row with a schedule uploaded on their
  // behalf, so the AI needs to know they exist either way.
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

  // Person notes owned by the asking user — the third parties they've told
  // the bot about. Used to enrich pending-invite lines (if Riccardo uploaded
  // Diego's schedule on behalf, the snapshot should say so) and to list
  // people the user has mentioned historically even if no invite exists yet.
  const personNotes = await getPersonNotesForOwner(selfChatId);

  const participants = participantsResult.results;
  const withSchedules = participants.filter((p) => p.has_schedule === 1);
  const pendingInvites = invitesResult.results;
  // A pending-invite person counts as "has schedule" if their person_notes
  // row carries a schedule_json (uploaded on behalf). We track this so the
  // "missing schedules" summary at the bottom reflects reality.
  const pendingInvitesWithNotes = pendingInvites.filter((_inv) => {
    // We don't store the intended name on the invite row itself, so we
    // can't match 1:1 here. Instead, check if the user has ANY person_notes
    // with schedule_json populated. This is an approximation — for a single
    // pending invite it's usually correct.
    return personNotes.some((pn) => pn.schedule_json && !pn.linked_chat_id);
  }).length;

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
    lines.push(`- Pending invites (${pendingInvites.length}) — mentioned but not yet joined. The user may have uploaded their schedule on their behalf (see person notes below).`);
    for (const inv of pendingInvites) {
      const who = inv.invitee_chat_id ? `person ${inv.invitee_chat_id.slice(-4)}` : "awaiting invite tap";
      lines.push(`    • ${who} — invite status: ${inv.status}`);
    }
  }

  // People the user has told the bot about (with or without a session). The
  // AI uses this to answer "what do you know about Diego?" and to avoid
  // duplicating data it already has.
  const notesWithSchedule = personNotes.filter((pn) => pn.schedule_json);
  if (personNotes.length > 0) {
    lines.push(`- People you know about this user (${personNotes.length} person notes):`);
    for (const pn of personNotes) {
      const parts: string[] = [pn.name];
      if (pn.linked_chat_id) parts.push("joined the bot");
      else parts.push("not joined");
      if (pn.schedule_json) parts.push("schedule: ✓ UPLOADED on their behalf");
      else parts.push("schedule: ✗");
      if (pn.phone) parts.push(`phone: ${pn.phone.slice(-4)}`);
      if (pn.notes) parts.push(`notes: ${pn.notes.slice(0, 100)}`);
      lines.push(`    • ${parts.join(" — ")}`);
    }
  }

  // Actionable summary at the end so the AI sees the bottom line clearly.
  // A pending-invite person counts as "covered" if there's a person_note
  // with schedule_json for them.
  const needed = Math.max(2, participants.length + pendingInvites.length);
  const effectivelyCovered = withSchedules.length + pendingInvitesWithNotes;
  const missing = Math.max(0, needed - effectivelyCovered);
  if (missing > 0) {
    lines.push(`- MISSING for a match: ${missing} more schedule${missing === 1 ? "" : "s"} needed before free-time can be computed.`);
  } else {
    lines.push(`- All schedules present (including on-behalf uploads in person notes) — ready to compute free time.`);
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

// --- Agentic turn-handler snapshot loader (new) ---
//
// Single entry point for building the [STATE] block the turn handler passes
// to Claude Sonnet at the start of every turn. Returns a structured snapshot
// containing the caller's user profile, ALL their active sessions (plural —
// Riccardo may be coordinating two meetups in parallel), per-session
// participants with resolved names and schedule flags, pending invites,
// caller-owned person_notes (privacy: strictly owner-scoped via
// getPersonNotesForOwner, other users cannot see these), recent
// conversation history, and IANA timezone.
//
// Parallelises independent reads with Promise.all. Total ~4-10 D1 round
// trips depending on how many active sessions the caller has (0-3 typical).

export interface SnapshotSessionEntry {
  session: {
    id: string;
    code: string;
    creator_chat_id: string;
    status: string;
    mode: string | null;
    created_at: string;
    expires_at: string;
  };
  participants: Array<{
    id: string;
    chat_id: string;
    role: string;
    state: string;
    schedule_json: string | null;
    preferred_slots: string | null;
    name: string | null;
    has_schedule: boolean;
  }>;
  pendingInvites: Array<{
    id: string;
    invitee_chat_id: string | null;
    invitee_phone: string | null;
    status: string;
  }>;
}

export interface Snapshot {
  user: UserProfile;
  activeSessions: SnapshotSessionEntry[];
  personNotes: PersonNote[];
  recentHistory: Array<{ role: string; message: string; created_at: string }>;
  timezone: string;
}

/**
 * Load the complete conversational state for a caller in one round.
 * Guarantees: `user` is never null (registerUser must have been called
 * before this, which the turn handler does at turn start). `activeSessions`
 * contains EVERY non-terminal, non-expired session this user participates
 * in, most-recent first. `personNotes` is owner-scoped to this caller only.
 */
export async function loadSnapshot(chatId: string): Promise<Snapshot> {
  const [userRow, sessionRows, personNotes, recentHistory] = await Promise.all([
    getUser(chatId),
    query<{
      id: string;
      code: string;
      creator_chat_id: string;
      status: string;
      mode: string | null;
      created_at: string;
      expires_at: string;
    }>(
      `SELECT DISTINCT s.id, s.code, s.creator_chat_id, s.status, s.mode, s.created_at, s.expires_at
         FROM sessions s
         JOIN participants p ON p.session_id = s.id
        WHERE p.chat_id = ?
          AND s.status NOT IN ('EXPIRED', 'COMPLETED')
          AND s.expires_at > datetime('now')
        ORDER BY s.created_at DESC`,
      [chatId],
    ),
    getPersonNotesForOwner(chatId),
    getRecentMessages(chatId),
  ]);

  // User row should always exist — turn handler calls registerUser before
  // loadSnapshot. If it doesn't, something is wrong; fall back to a minimal
  // synthetic profile so the turn handler doesn't crash on a cold user.
  const user: UserProfile = userRow ?? {
    chat_id: chatId,
    phone: null,
    username: null,
    name: null,
    preferred_language: "en",
    context: null,
    timezone: "Europe/Malta",
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };

  // For each active session, fetch participants + pending invites in
  // parallel. For 0-3 sessions this is 0-6 extra D1 calls.
  const activeSessions: SnapshotSessionEntry[] = await Promise.all(
    sessionRows.results.map(async (session) => {
      const [participantsResult, invitesResult] = await Promise.all([
        query<{
          id: string;
          chat_id: string;
          role: string;
          state: string;
          schedule_json: string | null;
          preferred_slots: string | null;
          name: string | null;
        }>(
          `SELECT p.id, p.chat_id, p.role, p.state, p.schedule_json, p.preferred_slots, u.name
             FROM participants p
             LEFT JOIN users u ON u.chat_id = p.chat_id
            WHERE p.session_id = ?
            ORDER BY p.created_at ASC`,
          [session.id],
        ),
        query<{
          id: string;
          invitee_chat_id: string | null;
          invitee_phone: string | null;
          status: string;
        }>(
          `SELECT id, invitee_chat_id, invitee_phone, status
             FROM pending_invites
            WHERE session_id = ? AND status = 'PENDING'
            ORDER BY created_at ASC`,
          [session.id],
        ),
      ]);

      return {
        session,
        participants: participantsResult.results.map((p) => ({
          ...p,
          has_schedule: p.schedule_json !== null && p.schedule_json !== "",
        })),
        pendingInvites: invitesResult.results,
      };
    }),
  );

  return {
    user,
    activeSessions,
    personNotes,
    recentHistory,
    timezone: user.timezone ?? "Europe/Malta",
  };
}

/**
 * Save a parsed schedule to a participant row WITHOUT changing state.
 * The old flow transitioned AWAITING_SCHEDULE → AWAITING_CONFIRMATION
 * as a side effect of saving; the new flow has no state machine and
 * confirmation is just a conversation thread. Turn handler decides
 * whether to ask the user to confirm.
 */
export async function saveParticipantSchedule(
  participantId: string,
  scheduleJson: string,
): Promise<void> {
  await query(
    "UPDATE participants SET schedule_json = ?, updated_at = datetime('now') WHERE id = ?",
    [scheduleJson, participantId],
  );
}

/**
 * Cancel a session — marks it EXPIRED, notifies observability. The turn
 * handler's session_action tool calls this when the user says "cancel"
 * or "nvm". Does NOT send Telegram messages to other participants —
 * that's the turn handler's job, so it can use the agentic reply tool
 * with proper per-recipient language handling.
 */
export async function cancelSession(sessionId: string): Promise<void> {
  await query("UPDATE sessions SET status = 'EXPIRED' WHERE id = ?", [sessionId]);
  await query(
    "UPDATE pending_invites SET status = 'CANCELLED' WHERE session_id = ? AND status = 'PENDING'",
    [sessionId],
  );
  await emitSessionEvent(sessionId, "session_cancelled");
}

/**
 * Reopen the most-recent COMPLETED session for a user so they can amend
 * after a match was already delivered. Flips status OPEN, does NOT touch
 * schedule_json (preserving the existing uploads), does NOT create new
 * waitpoint tokens. Returns the reopened session id, or null if the user
 * has no completed session to reopen.
 */
export async function reopenLastCompletedSession(chatId: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT s.id FROM sessions s
       JOIN participants p ON p.session_id = s.id
      WHERE p.chat_id = ? AND s.status = 'COMPLETED'
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [chatId],
  );
  const sessionId = result.results[0]?.id;
  if (!sessionId) return null;
  // Reset to OPEN + extend expiry 7 days from now so the reopened session
  // doesn't immediately time out. Leave schedule_json and preferred_slots
  // intact — the user is amending, not restarting.
  const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await query(
    "UPDATE sessions SET status = 'OPEN', expires_at = ? WHERE id = ?",
    [newExpiry, sessionId],
  );
  await emitSessionEvent(sessionId, "session_reopened");
  return sessionId;
}
