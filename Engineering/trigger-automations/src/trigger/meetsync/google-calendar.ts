// Google Calendar API client — creates events using stored OAuth tokens
// Requires user to complete OAuth flow via Worker /auth/google endpoint first

import { getGoogleToken, saveGoogleToken } from "./d1-client.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

interface CalendarEvent {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  description?: string;
  attendees?: Array<{ email: string }>;
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
  const token = await getGoogleToken(chatId);
  if (!token) return false;

  let accessToken = token.access_token;
  if (new Date(token.expires_at) <= new Date()) {
    const refreshed = await refreshAccessToken(token.refresh_token);
    if (refreshed === "invalid_grant") return "token_expired";
    if (!refreshed) return false;
    accessToken = refreshed.access_token;
    await saveGoogleToken(chatId, refreshed.access_token, token.refresh_token, refreshed.expires_at);
  }

  const event: CalendarEvent = {
    summary,
    start: { dateTime: `${date}T${startTime}:00`, timeZone: timezone },
    end: { dateTime: `${date}T${endTime}:00`, timeZone: timezone },
    description: "Scheduled via MeetSync",
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
): Promise<Array<{ date: string; start_time: string; end_time: string; label: string }>> {
  const token = await getGoogleToken(chatId);
  if (!token) return [];

  let accessToken = token.access_token;
  // Refresh proactively if within 60s of expiry — avoids races where the
  // call starts valid but the response check sees an expired token.
  const expiresInMs = new Date(token.expires_at).getTime() - Date.now();
  if (expiresInMs <= 60_000) {
    const refreshed = await refreshAccessToken(token.refresh_token);
    if (refreshed === "invalid_grant" || !refreshed) {
      console.warn(
        `[google-calendar] token refresh failed for chat=${chatId} (` +
          (refreshed === "invalid_grant"
            ? "invalid_grant — user revoked or grant expired; ask them to /connect again"
            : "null — likely missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in Trigger.dev env vars") +
          ")",
      );
      return [];
    }
    accessToken = refreshed.access_token;
    await saveGoogleToken(chatId, refreshed.access_token, token.refresh_token, refreshed.expires_at);
  }

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
  const out: Array<{ date: string; start_time: string; end_time: string; label: string }> = [];

  for (const calId of calendarIds) {
    const url =
      `${CALENDAR_API}/calendars/${encodeURIComponent(calId)}/events?` +
      `singleEvents=true&orderBy=startTime&` +
      `timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&` +
      `timeZone=${encodeURIComponent(timezone)}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      continue;
    }
    if (!response.ok) continue;
    const data = (await response.json()) as {
      items?: Array<{
        summary?: string;
        status?: string;
        transparency?: string;
        location?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        attendees?: Array<{ self?: boolean; responseStatus?: string }>;
      }>;
    };
    for (const e of data.items ?? []) {
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

      const summary = e.summary?.slice(0, 40) ?? "busy";
      const locPart = e.location ? ` @ ${e.location.slice(0, 40)}` : "";
      const label = `calendar: ${summary}${locPart}`;

      // Timed event (standard meeting).
      const startDT = e.start?.dateTime;
      const endDT = e.end?.dateTime;
      if (startDT && endDT) {
        const sMatch = startDT.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
        const eMatch = endDT.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
        if (!sMatch || !eMatch) continue;
        out.push({
          date: sMatch[1],
          start_time: `${sMatch[2]}:${sMatch[3]}`,
          end_time: sMatch[1] === eMatch[1] ? `${eMatch[2]}:${eMatch[3]}` : "23:59",
          label,
        });
        continue;
      }

      // All-day event (vacation, conference day, holiday). Google encodes
      // start.date = first busy day, end.date = day AFTER last busy day
      // (RFC5545 exclusive-end). Emit one 00:00–23:59 block per day in
      // that range. Cap at 14 days to bound the output for long vacations.
      const startDate = e.start?.date;
      const endDate = e.end?.date;
      if (startDate && endDate) {
        const MAX_DAYS = 14;
        for (let i = 0, cursor = startDate; cursor < endDate && i < MAX_DAYS; i++) {
          out.push({
            date: cursor,
            start_time: "00:00",
            end_time: "23:59",
            label: `all-day ${label}`,
          });
          const d = new Date(cursor + "T12:00:00Z");
          d.setUTCDate(d.getUTCDate() + 1);
          cursor = d.toISOString().slice(0, 10);
        }
      }
    }
  }
  return out;
}

/**
 * Fetch the IDs of every calendar the user sees in their calendarList,
 * with `selected: true` (i.e. visible in the user's own Calendar UI) and
 * a readable access role. Falls back to just ["primary"] on any failure.
 *
 * We deliberately read every selected calendar — if the user has it
 * visible in their own Calendar, they care about it. A "Work" calendar
 * with meetings must block scheduling the same way a "Personal" one does.
 */
async function listUserCalendarIds(accessToken: string): Promise<string[]> {
  try {
    const r = await fetch(`${CALENDAR_API}/users/me/calendarList?minAccessRole=reader`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return ["primary"];
    const data = (await r.json()) as {
      items?: Array<{ id: string; selected?: boolean; primary?: boolean }>;
    };
    const ids = (data.items ?? [])
      .filter((c) => c.primary === true || c.selected !== false)
      .map((c) => c.id);
    return ids.length > 0 ? ids : ["primary"];
  } catch {
    return ["primary"];
  }
}

/**
 * Find events on the caller's PRIMARY calendar for a given date, with an
 * optional substring title filter. Returns id + display fields so a caller
 * can pick from a list and a follow-up tool call can delete the right one.
 * Primary-only by design: book_meetup only creates on primary, so cancel
 * stays scoped there. Secondary-calendar events should be cancelled in
 * the user's Calendar UI directly.
 */
export async function findCalendarEventsOnDate(
  chatId: string,
  date: string, // YYYY-MM-DD
  titleHint: string,
): Promise<Array<{ id: string; summary: string; start_time: string; end_time: string; attendee_emails: string[] }>> {
  const token = await getGoogleToken(chatId);
  if (!token) return [];
  let accessToken = token.access_token;
  const expiresInMs = new Date(token.expires_at).getTime() - Date.now();
  if (expiresInMs <= 60_000) {
    const refreshed = await refreshAccessToken(token.refresh_token);
    if (refreshed === "invalid_grant" || !refreshed) return [];
    accessToken = refreshed.access_token;
    await saveGoogleToken(chatId, refreshed.access_token, token.refresh_token, refreshed.expires_at);
  }
  const qs = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: `${date}T00:00:00Z`,
    timeMax: `${date}T23:59:59Z`,
  }).toString();
  let response: Response;
  try {
    response = await fetch(`${CALENDAR_API}/calendars/primary/events?${qs}`, {
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
  const hint = titleHint.trim().toLowerCase();
  const out: Array<{ id: string; summary: string; start_time: string; end_time: string; attendee_emails: string[] }> = [];
  for (const e of data.items ?? []) {
    if (e.status === "cancelled") continue;
    const summary = e.summary ?? "(no title)";
    if (hint && !summary.toLowerCase().includes(hint)) continue;
    const sMatch = e.start?.dateTime?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
    const eMatch = e.end?.dateTime?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
    if (!sMatch || !eMatch) continue;
    out.push({
      id: e.id,
      summary,
      start_time: `${sMatch[1]}:${sMatch[2]}`,
      end_time: `${eMatch[1]}:${eMatch[2]}`,
      attendee_emails: (e.attendees ?? []).filter((a) => !a.self).map((a) => a.email),
    });
  }
  return out;
}

/**
 * Delete an event from the caller's PRIMARY calendar. sendUpdates=all so
 * Google notifies any attendees of the cancellation. Returns true on
 * success, "not_found" if the event doesn't exist (already deleted, or
 * wrong id), false on other failures.
 */
export async function deleteCalendarEvent(
  chatId: string,
  eventId: string,
): Promise<boolean | "not_found"> {
  const token = await getGoogleToken(chatId);
  if (!token) return false;
  let accessToken = token.access_token;
  const expiresInMs = new Date(token.expires_at).getTime() - Date.now();
  if (expiresInMs <= 60_000) {
    const refreshed = await refreshAccessToken(token.refresh_token);
    if (refreshed === "invalid_grant" || !refreshed) return false;
    accessToken = refreshed.access_token;
    await saveGoogleToken(chatId, refreshed.access_token, token.refresh_token, refreshed.expires_at);
  }
  const url = `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
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

async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expires_at: string } | "invalid_grant" | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

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
    console.error(`Google token refresh failed (${response.status}): ${errBody}`);
    if (errBody.includes("invalid_grant")) return "invalid_grant";
    return null;
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}
