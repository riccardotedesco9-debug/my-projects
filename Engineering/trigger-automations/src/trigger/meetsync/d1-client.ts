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
//
// Session-layer helpers were removed when the shared-hub refactor landed.
// See migration 0018 and the turn-handler for the new flow: schedules live
// on users, contacts on person_notes, no sessions gating visibility.

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
  hidden: number;
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
 *  AI sees who the user has talked to the bot about before.
 *
 *  By default, hidden rows are excluded so the snapshot stays focused on
 *  the caller's active pool. Pass `{ includeHidden: true }` when a
 *  management path (e.g. "show me everyone including hidden") needs them. */
export async function getPersonNotesForOwner(
  ownerChatId: string,
  opts: { includeHidden?: boolean } = {},
): Promise<PersonNote[]> {
  const sql = opts.includeHidden
    ? `SELECT * FROM person_notes WHERE owner_chat_id = ? ORDER BY updated_at DESC`
    : `SELECT * FROM person_notes WHERE owner_chat_id = ? AND hidden = 0 ORDER BY updated_at DESC`;
  const result = await query<PersonNote>(sql, [ownerChatId]);
  return result.results;
}

/** Mark a contact hidden/unhidden in the caller's pool. Returns true iff a
 *  row was actually updated — caller can use the false case to tell the
 *  user "I don't have anyone called that". */
export async function setPersonNoteHidden(
  ownerChatId: string,
  name: string,
  hidden: boolean,
): Promise<boolean> {
  const normalized = normalizePersonName(name);
  if (!normalized) return false;
  const result = await query(
    `UPDATE person_notes SET hidden = ?, updated_at = datetime('now')
     WHERE owner_chat_id = ? AND name_normalized = ?`,
    [hidden ? 1 : 0, ownerChatId, normalized],
  );
  return (result.meta?.changes ?? 0) > 0;
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

/** Clear all data for a chat ID (reset) — expires sessions where user is a participant */
// --- Google Calendar token helpers ---

/** Cheap existence check for Google Calendar connection. */
export async function hasGoogleToken(chatId: string): Promise<boolean> {
  const r = await query<{ c: number }>("SELECT COUNT(*) AS c FROM google_tokens WHERE chat_id = ?", [chatId]);
  return (r.results[0]?.c ?? 0) > 0;
}

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
  latest_schedule_json: string | null;
  email: string | null;
  last_stale_nudge_at: string | null;
}

/** Update user's timezone */
export async function updateUserTimezone(chatId: string, timezone: string) {
  await query(
    "UPDATE users SET timezone = ?, last_seen = datetime('now') WHERE chat_id = ?",
    [timezone, chatId]
  );
}

/**
 * When a phone becomes known for a user (they /start with contact share, or
 * a caller adds them by phone, or they update their profile), any existing
 * person_notes that were shadow-stored with this same phone — by any owner
 * — get auto-linked to this chat_id. This is the "shadow knowledge graph"
 * the product is built around: the bot tracks name+phone silently; the
 * moment that number joins, everyone who mentioned it sees the link.
 *
 * Returns the owner_chat_ids that had a shadow person_note resolved so
 * callers can notify those owners.
 */
export async function linkShadowedPersonNotesByPhone(
  chatId: string,
  phone: string,
): Promise<Array<{ owner_chat_id: string; name: string }>> {
  const variants = phone.startsWith("+") ? [phone, phone.slice(1)] : [phone, `+${phone}`];
  // Read the rows that WILL be linked BEFORE the update, so the caller can
  // notify each owner. Otherwise we lose the "who was waiting" info.
  const toLink = await query<{ owner_chat_id: string; name: string }>(
    `SELECT owner_chat_id, name FROM person_notes
      WHERE linked_chat_id IS NULL
        AND phone IN (?, ?)
        AND owner_chat_id != ?`,
    [variants[0], variants[1], chatId],
  );
  if (toLink.results.length === 0) return [];
  await query(
    `UPDATE person_notes
        SET linked_chat_id = ?, updated_at = datetime('now')
      WHERE linked_chat_id IS NULL
        AND phone IN (?, ?)
        AND owner_chat_id != ?`,
    [chatId, variants[0], variants[1], chatId],
  );
  return toLink.results;
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
/**
 * Update a user's phone AND resolve any shadow person_notes that were
 * waiting on this number. Returns the list of owners whose shadow-tracked
 * contact just got linked to this user, so the caller can notify them.
 * Empty list means no shadows were pending.
 */
export async function updateUserPhone(
  chatId: string,
  phone: string,
): Promise<Array<{ owner_chat_id: string; name: string }>> {
  await query(
    "UPDATE users SET phone = ?, last_seen = datetime('now') WHERE chat_id = ?",
    [phone, chatId]
  );
  return linkShadowedPersonNotesByPhone(chatId, phone);
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

/**
 * The user's canonical current schedule. Shared-hub model: a schedule lives
 * on users.latest_schedule_json — not inside any session or participant row.
 * Any caller who has this user in their person_notes automatically sees
 * this schedule via loadSnapshot enrichment.
 *
 * Falls back to the most-recent participants.schedule_json so users who
 * uploaded before migration 0018 still resolve. Can be removed once the
 * participants table is dropped.
 *
 * Consent model: uploading a schedule to MeetSync implies consent to use it
 * for matches — that's the bot's entire purpose.
 */
export async function getLatestScheduleForUser(chatId: string): Promise<string | null> {
  const userRow = await query<{ latest_schedule_json: string | null }>(
    "SELECT latest_schedule_json FROM users WHERE chat_id = ?",
    [chatId],
  );
  const fromUser = userRow.results[0]?.latest_schedule_json;
  if (fromUser) return fromUser;

  // Legacy fallback — participant rows pre-0018.
  const legacy = await query<{ schedule_json: string | null }>(
    `SELECT schedule_json FROM participants
     WHERE chat_id = ? AND schedule_json IS NOT NULL AND schedule_json != ''
     ORDER BY created_at DESC LIMIT 1`,
    [chatId],
  );
  return legacy.results[0]?.schedule_json ?? null;
}

/**
 * The single write point for a user's own schedule. Replaces the old
 * "save to participant row" flow. Parse_schedule tool calls this when the
 * caller is describing their own availability.
 */
export async function updateUserLatestSchedule(chatId: string, scheduleJson: string): Promise<void> {
  await query(
    "UPDATE users SET latest_schedule_json = ?, last_seen = datetime('now') WHERE chat_id = ?",
    [scheduleJson, chatId],
  );
}

/**
 * Remove any busy block matching (date, exact label) from a user's
 * latest_schedule_json. Used by cancel_meetup so the in-memory schedule
 * tracks the cancellation. Silently no-ops if no schedule or no match.
 */
export async function removeBusyBlockFromUser(
  chatId: string,
  date: string,
  labelMatch: string,
): Promise<number> {
  const user = await getUser(chatId);
  if (!user?.latest_schedule_json) return 0;
  let shifts: Array<{ date: string; start_time: string; end_time: string; label?: string }> = [];
  try {
    const parsed = JSON.parse(user.latest_schedule_json);
    if (Array.isArray(parsed)) shifts = parsed;
  } catch {
    return 0;
  }
  const before = shifts.length;
  shifts = shifts.filter((s) => !(s.date === date && (s.label ?? "") === labelMatch));
  const removed = before - shifts.length;
  if (removed > 0) {
    await updateUserLatestSchedule(chatId, JSON.stringify(shifts));
  }
  return removed;
}

/** Reverse-lookup chat_ids by email — cancel_meetup uses this to clear
 *  busy blocks on the bot side for each attendee whose email we've captured.
 *  Returns chat_ids of users whose email matches any of the provided list. */
export async function findChatIdsByEmails(emails: string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const placeholders = emails.map(() => "?").join(",");
  const result = await query<{ chat_id: string }>(
    `SELECT chat_id FROM users WHERE email IN (${placeholders})`,
    emails,
  );
  return result.results.map((r) => r.chat_id);
}

/**
 * Append a single busy block to a user's latest_schedule_json. Used by
 * book_meetup so a booked event becomes part of the user's "memory schedule"
 * — future overlap compute will see the slot as busy and won't suggest it
 * again. Idempotent-ish: appends regardless, since duplicate busy blocks
 * don't break the matcher (they just overlap).
 *
 * If the user has no schedule yet, creates one with just this block.
 */
export async function appendBusyBlockToUser(
  chatId: string,
  date: string,
  startTime: string,
  endTime: string,
  label: string,
): Promise<void> {
  const user = await getUser(chatId);
  if (!user) return;
  let shifts: Array<{ date: string; start_time: string; end_time: string; label?: string }> = [];
  if (user.latest_schedule_json) {
    try {
      const parsed = JSON.parse(user.latest_schedule_json);
      if (Array.isArray(parsed)) shifts = parsed;
    } catch {
      // Corrupted schedule — overwrite with just the new block below.
    }
  }
  shifts.push({ date, start_time: startTime, end_time: endTime, label });
  await updateUserLatestSchedule(chatId, JSON.stringify(shifts));
}

// --- Schedule-upload watches ---

export interface ScheduleWatch {
  id: string;
  watcher_chat_id: string;
  target_chat_id: string;
  created_at: string;
}

/** Register a one-shot watch. Idempotent via UNIQUE(watcher,target). */
export async function createScheduleWatch(
  watcherChatId: string,
  targetChatId: string,
): Promise<void> {
  await query(
    `INSERT OR IGNORE INTO user_schedule_watches (id, watcher_chat_id, target_chat_id)
     VALUES (?, ?, ?)`,
    [crypto.randomUUID(), watcherChatId, targetChatId],
  );
}

/** All pending watches waiting on a given user's next schedule upload. */
export async function listWatchesForTarget(targetChatId: string): Promise<ScheduleWatch[]> {
  const result = await query<ScheduleWatch>(
    "SELECT * FROM user_schedule_watches WHERE target_chat_id = ?",
    [targetChatId],
  );
  return result.results;
}

/** Delete by id — watches are one-shot; called right after firing. */
export async function deleteScheduleWatch(id: string): Promise<void> {
  await query("DELETE FROM user_schedule_watches WHERE id = ?", [id]);
}

/** Phone lookup that matches both E.164 ("+356...") and legacy bare-digit
 *  ("356...") storage. The tool now preserves the leading "+" when
 *  normalizing caller input, but historical rows may still have either
 *  shape, so we query both forms. */
export async function findUserByPhone(phone: string): Promise<UserProfile | null> {
  const withPlus = phone.startsWith("+") ? phone : `+${phone}`;
  const noPlus = phone.replace(/^\+/, "");
  const result = await query<UserProfile>(
    "SELECT * FROM users WHERE phone = ? OR phone = ? LIMIT 1",
    [withPlus, noPlus],
  );
  return result.results[0] ?? null;
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
  const trimmed = message.slice(0, 1000);
  const result = await query(
    "INSERT INTO conversation_log (chat_id, role, message) VALUES (?, ?, ?)",
    [chatId, role, trimmed]
  );
  // Keep only last 50 messages per user (best-effort cleanup)
  query(
    `DELETE FROM conversation_log WHERE chat_id = ? AND id NOT IN (
      SELECT id FROM conversation_log WHERE chat_id = ? ORDER BY created_at DESC LIMIT 50
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
  callerCalendarConnected: boolean;
}

/**
 * Load the complete conversational state for a caller in one round.
 * Guarantees: `user` is never null (registerUser must have been called
 * before this, which the turn handler does at turn start). `activeSessions`
 * contains EVERY non-terminal, non-expired session this user participates
 * in, most-recent first. `personNotes` is owner-scoped to this caller only.
 */
export async function loadSnapshot(chatId: string): Promise<Snapshot> {
  // Shared-hub model (migration 0018+): sessions are not part of runtime.
  // Snapshot = user profile + their contacts (person_notes) + recent chat.
  // Schedules live on users.latest_schedule_json; person_notes for linked
  // contacts get enriched below so Claude sees every contact's live schedule
  // regardless of which chat they uploaded from.
  const [userRow, rawPersonNotes, recentHistory, callerCalendarConnected] = await Promise.all([
    getUser(chatId),
    getPersonNotesForOwner(chatId),
    getRecentMessages(chatId),
    hasGoogleToken(chatId),
  ]);

  // Enrich each linked person_note with the contact's live data:
  //   1. Their latest self-uploaded schedule (users.latest_schedule_json)
  //      so the caller sees it without needing a re-upload in-context.
  //   2. Their freeform context (users.context — "lives in Gozo",
  //      "commutes from Valletta", "not a night owl"). Folded into the
  //      notes field in-memory only (never written back) so Claude can
  //      reason about meet-up logistics: "Kurt works till 4, lives far
  //      from town centre — 5pm meetup is tight on commute".
  const personNotes: PersonNote[] = await Promise.all(
    rawPersonNotes.map(async (n) => {
      if (!n.linked_chat_id) return n;
      const [latestSched, linkedUser] = await Promise.all([
        n.schedule_json ? Promise.resolve(null) : getLatestScheduleForUser(n.linked_chat_id),
        getUser(n.linked_chat_id),
      ]);
      const mergedSched = n.schedule_json ?? latestSched;
      const linkedCtx = linkedUser?.context?.trim() ?? "";
      const linkedLang = linkedUser?.preferred_language ?? null;
      const profileParts: string[] = [];
      if (linkedLang) profileParts.push(`lang=${linkedLang}`);
      if (linkedCtx) profileParts.push(linkedCtx);
      const profileLine = profileParts.length > 0 ? `[their profile] ${profileParts.join(" · ")}` : "";
      const mergedNotes = profileLine
        ? (n.notes ? `${n.notes}\n${profileLine}` : profileLine)
        : n.notes;
      return { ...n, schedule_json: mergedSched, notes: mergedNotes };
    }),
  );

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
    latest_schedule_json: null,
    email: null,
    last_stale_nudge_at: null,
  };

  // Sessions are no longer part of the runtime model (see migration 0018
  // and the shared-hub plan). Always empty; field retained on the Snapshot
  // type so downstream code that iterates it remains valid.
  const activeSessions: SnapshotSessionEntry[] = [];

  return {
    user,
    activeSessions,
    personNotes,
    recentHistory,
    timezone: user.timezone ?? "Europe/Malta",
    callerCalendarConnected,
  };
}


// --- Reminders ---
//
// User-scheduled reminders that the bot fires as Telegram messages at a
// chosen time. fire_at is a UTC epoch (integer seconds). One-shot by
// default; recurrence='daily'|'weekly'|'monthly' advances fire_at on each
// fire instead of marking FIRED.

export interface Reminder {
  id: string;
  chat_id: string;
  text: string;
  fire_at: number;
  status: string;
  recurrence: string | null;
  timezone: string;
  created_at: string;
  fired_at: string | null;
}

export type ReminderRecurrence = "daily" | "weekly" | "monthly";

/**
 * Convert a local wall-clock ISO string (no timezone suffix, e.g. "2026-04-15T06:00")
 * into UTC Unix epoch seconds, given the user's IANA timezone. Handles DST
 * correctly by asking Intl what that exact instant would display as in the
 * target tz and subtracting the observed offset.
 *
 * Returns null if isoLocal fails to parse. Accepts formats with or without
 * seconds ("2026-04-15T06:00" or "2026-04-15T06:00:00").
 */
export function localIsoToUtcEpoch(isoLocal: string, timezone: string): number | null {
  // Strip any trailing Z/offset — the caller said "local" so we interpret it as such.
  const cleaned = isoLocal.trim().replace(/[zZ]$|[+-]\d\d:?\d\d$/, "");
  // Reject date-only input like "2026-04-15" — reminders always need HH:MM.
  // Without this guard Date.parse silently accepts the date and defaults to
  // midnight, which means "remind me on Friday" fires at 00:00 instead of
  // whatever the user meant. Force the caller (Claude) to include a time.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(cleaned)) return null;
  // Parse as if the string were UTC to get a reference instant.
  const asUtcMs = Date.parse(cleaned + "Z");
  if (Number.isNaN(asUtcMs)) return null;
  // What does that instant *actually* show as in the target tz?
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(asUtcMs));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const shownUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  // shownUtcMs - asUtcMs = the tz offset for that instant (positive east of UTC).
  // Subtract that offset from the original "as-if-UTC" parse to get the real UTC instant.
  const offset = shownUtcMs - asUtcMs;
  return Math.floor((asUtcMs - offset) / 1000);
}

/** Create a new reminder row. Returns the id. */
export async function createReminder(
  chatId: string,
  text: string,
  fireAtEpoch: number,
  timezone: string,
  recurrence: ReminderRecurrence | null = null,
): Promise<string> {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO reminders (id, chat_id, text, fire_at, status, recurrence, timezone)
     VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
    [id, chatId, text, fireAtEpoch, recurrence, timezone],
  );
  return id;
}

/** Pending reminders owned by a user, soonest-first. Used for list/cancel UX. */
export async function listUserReminders(
  chatId: string,
  { limit = 20 }: { limit?: number } = {},
): Promise<Reminder[]> {
  const result = await query<Reminder>(
    `SELECT * FROM reminders
     WHERE chat_id = ? AND status = 'PENDING'
     ORDER BY fire_at ASC
     LIMIT ?`,
    [chatId, limit],
  );
  return result.results;
}

/** Mark a reminder as cancelled. Owner-scoped so users can only cancel their own. */
export async function cancelReminder(chatId: string, reminderId: string): Promise<boolean> {
  const result = await query(
    `UPDATE reminders SET status = 'CANCELLED'
     WHERE id = ? AND chat_id = ? AND status = 'PENDING'`,
    [reminderId, chatId],
  );
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * All reminders that are due right now. The firer caps the batch so one
 * run can't blow up if lots are backlogged. Sorted by fire_at so the
 * earliest overdue reminder wins if we can only process some this minute.
 */
export async function getDueReminders(nowEpoch: number, limit = 50): Promise<Reminder[]> {
  const result = await query<Reminder>(
    `SELECT * FROM reminders
     WHERE status = 'PENDING' AND fire_at <= ?
     ORDER BY fire_at ASC
     LIMIT ?`,
    [nowEpoch, limit],
  );
  return result.results;
}

/** One-shot reminder hit its time — mark it done so the firer doesn't re-trigger. */
export async function markReminderFired(id: string): Promise<void> {
  await query(
    `UPDATE reminders SET status = 'FIRED', fired_at = datetime('now') WHERE id = ?`,
    [id],
  );
}

/** Recurring reminder fired — advance fire_at to the next occurrence. */
export async function advanceRecurringReminder(id: string, nextFireAtEpoch: number): Promise<void> {
  await query(
    `UPDATE reminders SET fire_at = ?, fired_at = datetime('now') WHERE id = ?`,
    [nextFireAtEpoch, id],
  );
}

/**
 * Compute the next fire time for a recurring reminder by adding 1 unit of its interval.
 *
 * TODO: uses UTC arithmetic, so across a DST transition the wall-clock time
 * drifts by an hour (e.g. a "daily 9am" reminder set in winter will fire
 * at 10am once summer time hits, until the user nudges it). Acceptable for
 * v1 — fix when we add the user-timezone field to the Date math here.
 */
export function computeNextRecurrence(currentEpoch: number, recurrence: ReminderRecurrence): number {
  const d = new Date(currentEpoch * 1000);
  if (recurrence === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (recurrence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (recurrence === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  return Math.floor(d.getTime() / 1000);
}
