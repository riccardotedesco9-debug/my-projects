// Google Calendar API client — creates events using stored OAuth tokens
// Requires user to complete OAuth flow via Worker /auth/google endpoint first

import { getGoogleToken, saveGoogleToken, markGoogleTokenInvalid } from "./d1-client.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/**
 * Resolve the IANA timezone's UTC offset on a specific date as an ISO
 * 8601 designator like "+02:00" / "-05:00" / "Z". Used to format
 * timeMin/timeMax bounds for Google Calendar queries so the wall-clock
 * day in the caller's tz matches the query window.
 *
 * Why date-specific: DST means the offset isn't constant for a given
 * tz — Malta is +01:00 in winter and +02:00 in summer. Picking the
 * offset based on noon-of-the-target-date is robust against the rare
 * spring-forward/fall-back day overlap (the offset still points
 * unambiguously to that day's working part).
 */
function isoOffsetForDate(dateIso: string, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(new Date(dateIso + "T12:00:00Z"));
    const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    if (raw === "GMT" || raw === "UTC") return "Z";
    // Intl emits "GMT+02:00" / "GMT-05:00".
    return raw.replace("GMT", "");
  } catch {
    // Bad timezone string — fall back to UTC.
    return "Z";
  }
}

/**
 * Strip the personally-identifying parts of a calendar event before it
 * reaches Claude. Drops the literal title (e.g. "Therapy with Dr X") and
 * `@ location`, keeps the time geometry plus the all-day marker emitted
 * by `listCalendarEventsInWindow`. Used wherever a CONTACT's calendar
 * (i.e. someone other than the caller) is being merged into the snapshot
 * or fed into a tool result. The privacy rule in the system prompt asks
 * Claude to abstract sensitive cross-person titles, but that's prompt-
 * only — sanitising at the data boundary makes the boundary real.
 *
 * Conventions preserved:
 *   "all-day calendar: …" → "all-day calendar (busy)"
 *   "calendar: …"         → "calendar (busy)"
 */
export function sanitiseContactCalendarEvent<
  T extends { date: string; start_time: string; end_time: string; label?: string },
>(ev: T): T {
  const label = ev.label ?? "";
  const isAllDay = label.startsWith("all-day ");
  const opaque = isAllDay ? "all-day calendar (busy)" : "calendar (busy)";
  return { ...ev, label: opaque };
}

/**
 * A calendar event read back as a shift-shaped busy block. `origin`
 * distinguishes events MeetSync itself created (tagged via extendedProperties
 * on write) from events the user booked elsewhere. The bot's own events are
 * already represented in D1, so the enrichment/display layers drop them to
 * avoid double-showing; only `external` events are genuinely new information.
 */
export interface CalendarBusyBlock {
  date: string;
  start_time: string;
  end_time: string;
  label: string;
  origin: "bot" | "external";
}

/** The private extendedProperties key MeetSync stamps on every event it
 *  creates, so it can recognise its own mirror when reading the calendar back. */
const MEETSYNC_ORIGIN_KEY = "meetsync";

/**
 * Reduce a calendar read to just the events worth ADDING to a stored
 * schedule — i.e. genuinely external ones the user booked elsewhere:
 *   - drop the bot's own mirrored events (origin "bot") — already in D1;
 *   - drop any remaining event whose (date,start,end) already matches a
 *     stored entry. This is the belt-and-braces fallback for events the bot
 *     created BEFORE the origin marker shipped (they read as "external").
 * Compares on the time-tuple only, never the label: a booked meetup is
 * stored in D1 as "meetup: X" but read back from Google as "calendar: X".
 */
export function filterExternalCalendarEvents(
  events: CalendarBusyBlock[],
  existingShifts: Array<{ date: string; start_time: string; end_time: string }>,
): CalendarBusyBlock[] {
  const existingTuples = new Set(
    existingShifts.map((s) => `${s.date}|${s.start_time}|${s.end_time}`),
  );
  return events.filter((ev) => {
    if (ev.origin === "bot") return false;
    return !existingTuples.has(`${ev.date}|${ev.start_time}|${ev.end_time}`);
  });
}

interface CalendarEvent {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  description?: string;
  attendees?: Array<{ email: string }>;
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * Create a Google Calendar event on the given chat's primary calendar.
 *
 * When `attendeeEmails` is non-empty, Google auto-sends invites to those
 * addresses — the single event shows up on each attendee's calendar with
 * them listed as attendees, so later RSVP / edit / delete semantics work
 * properly. Without attendees, falls back to a local-only event on the
 * organizer's calendar (used for people without a captured email).
 */
export async function createCalendarEvent(
  chatId: string,
  date: string, // YYYY-MM-DD
  startTime: string, // HH:MM
  endTime: string, // HH:MM
  summary: string = "Meetup",
  timezone: string = "Europe/Malta",
  attendeeEmails: string[] = [],
): Promise<boolean | "token_expired"> {
  const auth = await getFreshAccessToken(chatId);
  if (!auth.ok) return auth.reason === "token_expired" ? "token_expired" : false;
  const accessToken = auth.accessToken;

  const event: CalendarEvent = {
    summary,
    start: { dateTime: `${date}T${startTime}:00`, timeZone: timezone },
    end: { dateTime: `${date}T${endTime}:00`, timeZone: timezone },
    description: "Scheduled via MeetSync",
    // Tag so we can tell our own mirror apart from externally-booked events
    // when reading the calendar back (see listCalendarEventsInWindow).
    extendedProperties: { private: { [MEETSYNC_ORIGIN_KEY]: "1" } },
  };
  if (attendeeEmails.length > 0) {
    event.attendees = attendeeEmails.map((email) => ({ email }));
  }

  // sendUpdates=all → Google emails each attendee the invite.
  const qs = attendeeEmails.length > 0 ? "?sendUpdates=all" : "";
  const response = await fetch(`${CALENDAR_API}/calendars/primary/events${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    console.error(`Google Calendar API error (${response.status}):`, await response.text());
    return false;
  }
  return true;
}


/**
 * List the user's calendar events that fall within [startDateISO, endDateISO].
 * Returns a shift-shaped busy-block list so it merges cleanly with the
 * bot's schedule_json. Silently returns [] for users without a connected
 * calendar, for token_expired, or on any API error — reading the calendar
 * is an enhancement, not a requirement.
 *
 * Each event becomes one busy block with start/end times in the event's
 * timezone (Google always returns dateTime with offset — we keep the
 * HH:MM portion since downstream matching lives in the user's local tz).
 */
export async function listCalendarEventsInWindow(
  chatId: string,
  startDateISO: string, // YYYY-MM-DD
  endDateISO: string, // YYYY-MM-DD (inclusive)
  timezone: string = "Europe/Malta",
): Promise<CalendarBusyBlock[]> {
  const auth = await getFreshAccessToken(chatId);
  if (!auth.ok) return [];
  const accessToken = auth.accessToken;

  // Fan out across every calendar the user sees in their calendarList —
  // primary PLUS secondary calendars like "Personal", "Health", shared
  // family calendars, subscribed calendars. Many users put therapy /
  // medical / workout slots on a separate calendar.
  const calendarIds = await listUserCalendarIds(accessToken);
  // Google rejects timeMin/timeMax without a timezone designator with
  // 400 Bad Request. Use Z (UTC). The window is already whole-day so
  // the timezone nuance doesn't actually move the boundary meaningfully.
  const timeMin = `${startDateISO}T00:00:00Z`;
  const timeMax = `${endDateISO}T23:59:59Z`;
  // Parallelise across calendars with a per-call timeout so one slow
  // secondary calendar can't stall the whole enrichment. Each calendar
  // follows Google's nextPageToken up to MAX_PAGES so power users with
  // >250 events in a 21d window don't silently lose events past page 1.
  const PER_CALL_TIMEOUT_MS = 5000;
  const MAX_PAGES = 5; // 5 * 250 = 1250 events per calendar. Cap to bound latency.
  type EventItem = {
    summary?: string;
    status?: string;
    transparency?: string;
    location?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    attendees?: Array<{ self?: boolean; responseStatus?: string }>;
    extendedProperties?: { private?: Record<string, string> };
  };
  const perCalendarResults = await Promise.all(
    calendarIds.map(async (calId): Promise<CalendarBusyBlock[]> => {
      const baseUrl =
        `${CALENDAR_API}/calendars/${encodeURIComponent(calId)}/events?` +
        `singleEvents=true&orderBy=startTime&maxResults=250&` +
        `timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&` +
        `timeZone=${encodeURIComponent(timezone)}`;
      const allItems: EventItem[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = pageToken ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}` : baseUrl;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal });
        } catch (err) {
          console.warn(`[google-calendar] fetch failed for cal=${calId} page=${page}:`, err instanceof Error ? err.message : err);
          break;
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) {
          console.warn(`[google-calendar] ${response.status} for cal=${calId} page=${page}`);
          break;
        }
        const data = (await response.json()) as { items?: EventItem[]; nextPageToken?: string };
        allItems.push(...(data.items ?? []));
        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
      }
      const calOut: CalendarBusyBlock[] = [];
      for (const e of allItems) {
        if (e.status === "cancelled") continue;
        // Previously filtered transparency==="transparent", but Gmail auto-
        // extracted events (eventType: fromGmail — therapy bookings, flights,
        // dinner reservations) default to transparent even though they're
        // real commitments. Removing the filter: anything on the calendar
        // is treated as busy. If the user wants something to not block
        // scheduling, they can delete it.
        // Skip events the user declined — the event exists on their calendar
        // but they've said no, so it shouldn't count as busy.
        const selfAttendee = e.attendees?.find((a) => a.self === true);
        if (selfAttendee?.responseStatus === "declined") continue;

        // Treat any non-declined event as plain busy. We used to surface
        // "📩 awaiting RSVP" / "❓ tentative" prefixes so Claude could nag
        // the user about un-answered invites, but the user explicitly
        // asked us to assume-accepted — events on the calendar count as
        // busy whether or not the RSVP is filled in. selfAttendee is
        // still inspected above for the declined skip.
        const summary = e.summary?.slice(0, 40) ?? "busy";
        const locPart = e.location ? ` @ ${e.location.slice(0, 40)}` : "";
        const label = `calendar: ${summary}${locPart}`;
        // Distinguish our own mirrored events from externally-booked ones.
        // Events created before the marker shipped read as "external"; the
        // enrichment/display layers tuple-dedupe those against D1 as a fallback.
        const origin: "bot" | "external" =
          e.extendedProperties?.private?.[MEETSYNC_ORIGIN_KEY] === "1" ? "bot" : "external";

        // Timed event (standard meeting).
        const startDT = e.start?.dateTime;
        const endDT = e.end?.dateTime;
        if (startDT && endDT) {
          const sMatch = startDT.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
          const eMatch = endDT.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
          if (!sMatch || !eMatch) continue;
          if (sMatch[1] === eMatch[1]) {
            // Same-day timed event — emit one block.
            calOut.push({
              date: sMatch[1],
              start_time: `${sMatch[2]}:${sMatch[3]}`,
              end_time: `${eMatch[2]}:${eMatch[3]}`,
              label,
              origin,
            });
            continue;
          }
          // Cross-day timed event (e.g. 22:00 Mon → 06:00 Tue, or a
          // 3-day timed retreat). Previously emitted ONE block on
          // sDate with end=23:59, silently losing the next-day spill —
          // so a 22:00–06:00 overnight on Mon would not block 00:00–
          // 06:00 on Tue's free/busy view. Emit one block per day in
          // the range, matching the all-day path's iteration shape.
          const startTime = `${sMatch[2]}:${sMatch[3]}`;
          const endTime = `${eMatch[2]}:${eMatch[3]}`;
          const MAX_DAYS = 28;
          let cursor = sMatch[1];
          for (let i = 0; cursor <= eMatch[1] && i < MAX_DAYS; i++) {
            const isFirst = cursor === sMatch[1];
            const isLast = cursor === eMatch[1];
            calOut.push({
              date: cursor,
              start_time: isFirst ? startTime : "00:00",
              end_time: isLast ? endTime : "23:59",
              label,
              origin,
            });
            const d = new Date(cursor + "T12:00:00Z");
            d.setUTCDate(d.getUTCDate() + 1);
            cursor = d.toISOString().slice(0, 10);
          }
          continue;
        }

        // All-day event (vacation, conference day, holiday). Google encodes
        // start.date = first busy day, end.date = day AFTER last busy day
        // (RFC5545 exclusive-end). Emit one 00:00–23:59 block per day in
        // that range. Cap at 14 days to bound the output for long vacations.
        const startDate = e.start?.date;
        const endDate = e.end?.date;
        if (startDate && endDate) {
          // Cap multi-day all-day events (long vacations, multi-week
          // conferences) at 28 days of expansion to bound output size.
          // Snapshot window is 60d — anything past that is windowed off
          // by the renderer anyway.
          const MAX_DAYS = 28;
          for (let i = 0, cursor = startDate; cursor < endDate && i < MAX_DAYS; i++) {
            calOut.push({
              date: cursor,
              start_time: "00:00",
              end_time: "23:59",
              label: `all-day ${label}`,
              origin,
            });
            const d = new Date(cursor + "T12:00:00Z");
            d.setUTCDate(d.getUTCDate() + 1);
            cursor = d.toISOString().slice(0, 10);
          }
        }
      }
      return calOut;
    }),
  );
  return perCalendarResults.flat();
}

/**
 * Fetch the IDs of every calendar the user owns, writes to, or has visible
 * in their own Calendar UI. Falls back to just ["primary"] on any failure.
 *
 * Filter rationale: we want anything the user has real stakes in.
 *   - primary=true always (their main calendar)
 *   - accessRole ∈ {owner, writer} always (they can delete/edit — real stake,
 *     even if they've unchecked it in the UI)
 *   - selected !== false as a lenient fallback (keeps shared calendars the
 *     user has visible but doesn't own, like a family calendar)
 *
 * The old filter (`selected !== false` only) was dropping "From Gmail" auto-
 * imported calendars where Gmail-extracted events (therapy, flights,
 * reservations) sometimes land with `selected: false`.
 */
async function listUserCalendarIds(accessToken: string): Promise<string[]> {
  try {
    const r = await fetch(`${CALENDAR_API}/users/me/calendarList?minAccessRole=reader`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return ["primary"];
    const data = (await r.json()) as {
      items?: Array<{ id: string; selected?: boolean; primary?: boolean; accessRole?: string }>;
    };
    const ids = (data.items ?? [])
      .filter((c) =>
        c.primary === true ||
        c.accessRole === "owner" ||
        c.accessRole === "writer" ||
        c.selected !== false,
      )
      .map((c) => c.id);
    return ids.length > 0 ? ids : ["primary"];
  } catch {
    return ["primary"];
  }
}

/**
 * Find events for a given date across ALL of the caller's readable calendars
 * (owner/writer + anything selected in their UI), with an optional substring
 * title filter. Returns id + calendar_id + display fields so the caller can
 * pick from a list and a follow-up tool call can delete the right one — the
 * calendar_id must flow back to deleteCalendarEvent or the delete will 404.
 *
 * Previously primary-only, which silently failed on events booked in
 * secondary calendars (work, personal, shared-family). Matches the expanded
 * read scope in listCalendarEventsInWindow.
 */
export async function findCalendarEventsOnDate(
  chatId: string,
  date: string, // YYYY-MM-DD (interpreted in `timezone` below)
  titleHint: string,
  timezone: string = "UTC",
): Promise<Array<{ id: string; calendar_id: string; summary: string; start_time: string; end_time: string; attendee_emails: string[] }>> {
  const auth = await getFreshAccessToken(chatId);
  if (!auth.ok) return [];
  const accessToken = auth.accessToken;
  const calendarIds = await listUserCalendarIds(accessToken);
  // Anchor the day window in the caller's tz, not UTC. Previously
  // `${date}T00:00:00Z` / `${date}T23:59:59Z` was used regardless of
  // tz, so a Malta user querying May 5 actually saw UTC May 5 — i.e.
  // Malta May 5 02:00 → May 6 01:59. The user's "23:30 the night
  // before" event silently slipped out of the window.
  const offset = isoOffsetForDate(date, timezone);
  const qs = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: `${date}T00:00:00${offset}`,
    timeMax: `${date}T23:59:59${offset}`,
  }).toString();
  const hint = titleHint.trim().toLowerCase();
  const perCalendar = await Promise.all(
    calendarIds.map(async (calId): Promise<Array<{ id: string; calendar_id: string; summary: string; start_time: string; end_time: string; attendee_emails: string[] }>> => {
      let response: Response;
      try {
        response = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calId)}/events?${qs}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        return [];
      }
      if (!response.ok) return [];
      const data = (await response.json()) as {
        items?: Array<{
          id: string;
          summary?: string;
          status?: string;
          start?: { dateTime?: string };
          end?: { dateTime?: string };
          attendees?: Array<{ email: string; self?: boolean; responseStatus?: string }>;
        }>;
      };
      const calOut: Array<{ id: string; calendar_id: string; summary: string; start_time: string; end_time: string; attendee_emails: string[] }> = [];
      for (const e of data.items ?? []) {
        if (e.status === "cancelled") continue;
        const summary = e.summary ?? "(no title)";
        if (hint && !summary.toLowerCase().includes(hint)) continue;
        const sMatch = e.start?.dateTime?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
        const eMatch = e.end?.dateTime?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
        if (!sMatch || !eMatch) continue;
        calOut.push({
          id: e.id,
          calendar_id: calId,
          summary,
          start_time: `${sMatch[1]}:${sMatch[2]}`,
          end_time: `${eMatch[1]}:${eMatch[2]}`,
          attendee_emails: (e.attendees ?? []).filter((a) => !a.self).map((a) => a.email),
        });
      }
      return calOut;
    }),
  );
  return perCalendar.flat();
}

/**
 * Delete an event from the given calendar (defaults to primary for back-
 * compat). Pass the calendar_id that came back from findCalendarEventsOnDate
 * so secondary-calendar events are handled correctly. sendUpdates=all so
 * Google notifies any attendees of the cancellation. Returns true on
 * success, "not_found" if the event doesn't exist, false on other failures.
 */
export async function deleteCalendarEvent(
  chatId: string,
  eventId: string,
  calendarId: string = "primary",
): Promise<boolean | "not_found"> {
  const auth = await getFreshAccessToken(chatId);
  if (!auth.ok) return false;
  const accessToken = auth.accessToken;
  const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return false;
  }
  if (response.status === 404 || response.status === 410) return "not_found";
  return response.ok || response.status === 204;
}

/**
 * Single entry point for "give me a usable access token for this chat".
 * Handles getGoogleToken → proactive-expiry check (60s buffer) → refresh →
 * markGoogleTokenInvalid on hard failure → saveGoogleToken on success.
 * Replaces four near-identical inline blocks that had drifted on the
 * expiry threshold (one was reactive, three proactive).
 */
type FreshTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "not_connected" | "token_expired" | "refresh_failed" };

export async function probeCallerCalendarHealth(chatId: string): Promise<FreshTokenResult> {
  return getFreshAccessToken(chatId);
}

async function getFreshAccessToken(chatId: string): Promise<FreshTokenResult> {
  const token = await getGoogleToken(chatId);
  if (!token) return { ok: false, reason: "not_connected" };

  const expiresInMs = new Date(token.expires_at).getTime() - Date.now();
  if (expiresInMs > 60_000) {
    return { ok: true, accessToken: token.access_token };
  }

  const refreshed = await refreshAccessToken(token.refresh_token);
  if (refreshed === "invalid_grant") {
    console.warn(
      `[google-calendar] token refresh failed for chat=${chatId} (invalid_grant — user revoked or grant expired; ask them to /connect again)`,
    );
    await markGoogleTokenInvalid(chatId, true).catch(() => {});
    return { ok: false, reason: "token_expired" };
  }
  if (refreshed === "missing_env") {
    // Already logged with key-presence detail inside refreshAccessToken.
    return { ok: false, reason: "refresh_failed" };
  }
  if (!refreshed) {
    console.warn(
      `[google-calendar] token refresh returned null for chat=${chatId} — fetch to oauth2.googleapis.com/token returned non-OK; see prior console.error for status + body`,
    );
    return { ok: false, reason: "refresh_failed" };
  }
  await saveGoogleToken(chatId, refreshed.access_token, token.refresh_token, refreshed.expires_at);
  return { ok: true, accessToken: refreshed.access_token };
}

async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expires_at: string } | "invalid_grant" | "missing_env" | null> {
  // Try every plausible (clientId, clientSecret) pair the user may have set
  // under the various names that appear across their Trigger.dev prod env.
  // We attempt them in order and return the first successful refresh — Google
  // returns 401 unauthorized_client when the pair doesn't match the client
  // that issued the refresh_token, so non-matching pairs cleanly fall through.
  // Order matters: GOOGLE_CLIENT_* (canonical) → OAuth_*_Web (most likely for
  // the redirect-based /connect flow) → OAuth_*_Desktop (last-resort, usually
  // wrong for a Worker-side OAuth but cheap to try).
  const candidates: Array<{ label: string; id?: string; secret?: string }> = [
    { label: "GOOGLE_CLIENT_*", id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET },
    { label: "OAuth_*_Web", id: process.env.OAuth_Client_ID_Web, secret: process.env.OAuth_Client_Secret_Web },
    { label: "OAuth_*_Desktop", id: process.env.OAuth_Client_ID_Desktop, secret: process.env.OAuth_Client_Secret_Desktop },
  ].filter((c) => c.id && c.secret);

  if (candidates.length === 0) {
    console.warn(
      `[google-calendar] refreshAccessToken aborted — no Google OAuth client env vars set on Trigger.dev prod. Need either GOOGLE_CLIENT_ID/SECRET, OAuth_Client_ID_Web/Secret_Web, or OAuth_Client_ID_Desktop/Secret_Desktop.`,
    );
    return "missing_env";
  }

  // We delegate the actual fetch into a helper so we can loop. Inline the
  // request building here was easier when there was just one candidate.
  let lastInvalidGrant = false;
  for (const c of candidates) {
    const r = await tryRefreshWithClient(refreshToken, c.id!, c.secret!, c.label);
    if (r === "invalid_grant") {
      lastInvalidGrant = true;
      continue; // try other candidates — invalid_grant on one might be OK on another
    }
    if (r && typeof r === "object") {
      console.log(`[google-calendar] token refresh succeeded using env pair: ${c.label}`);
      return r;
    }
    // r === null (HTTP non-OK without invalid_grant — typically unauthorized_client) → try next pair
  }

  return lastInvalidGrant ? "invalid_grant" : null;
}

async function tryRefreshWithClient(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  label: string,
): Promise<{ access_token: string; expires_at: string } | "invalid_grant" | null> {

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
    const errBody = await response.text();
    console.error(`Google token refresh failed for env pair ${label} (${response.status}): ${errBody}`);
    if (errBody.includes("invalid_grant")) return "invalid_grant";
    return null;
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}
