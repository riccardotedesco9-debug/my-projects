// Google Calendar API client — creates events using stored OAuth tokens
// Requires user to complete OAuth flow via Worker /auth/google endpoint first

import { getGoogleToken, saveGoogleToken } from "./d1-client.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

interface CalendarEvent {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  description?: string;
}

/**
 * Create a Google Calendar event for a user.
 * Returns true on success, false on unknown failure, "token_expired" when
 * the refresh token is revoked/expired (user needs to /connect again).
 */
export async function createCalendarEvent(
  chatId: string,
  date: string, // YYYY-MM-DD
  startTime: string, // HH:MM
  endTime: string, // HH:MM
  summary: string = "Meetup",
  timezone: string = "Europe/Malta",
): Promise<boolean | "token_expired"> {
  const token = await getGoogleToken(chatId);
  if (!token) return false; // user hasn't connected Google Calendar

  let accessToken = token.access_token;

  // Refresh if expired
  if (new Date(token.expires_at) <= new Date()) {
    const refreshed = await refreshAccessToken(token.refresh_token);
    if (refreshed === "invalid_grant") return "token_expired";
    if (!refreshed) return false;
    accessToken = refreshed.access_token;
    await saveGoogleToken(chatId, refreshed.access_token, token.refresh_token, refreshed.expires_at);
  }

  const event: CalendarEvent = {
    summary,
    start: {
      dateTime: `${date}T${startTime}:00`,
      timeZone: timezone,
    },
    end: {
      dateTime: `${date}T${endTime}:00`,
      timeZone: timezone,
    },
    description: "Scheduled via MeetSync",
  };

  const response = await fetch(`${CALENDAR_API}/calendars/primary/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
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
  if (new Date(token.expires_at) <= new Date()) {
    const refreshed = await refreshAccessToken(token.refresh_token);
    if (refreshed === "invalid_grant" || !refreshed) return [];
    accessToken = refreshed.access_token;
    await saveGoogleToken(chatId, refreshed.access_token, token.refresh_token, refreshed.expires_at);
  }

  const timeMin = `${startDateISO}T00:00:00`;
  const timeMax = `${endDateISO}T23:59:59`;
  const url =
    `${CALENDAR_API}/calendars/primary/events?` +
    `singleEvents=true&orderBy=startTime&` +
    `timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&` +
    `timeZone=${encodeURIComponent(timezone)}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    return [];
  }
  if (!response.ok) return [];
  const data = (await response.json()) as {
    items?: Array<{
      summary?: string;
      status?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  };
  const out: Array<{ date: string; start_time: string; end_time: string; label: string }> = [];
  for (const e of data.items ?? []) {
    if (e.status === "cancelled") continue;
    const startDT = e.start?.dateTime;
    const endDT = e.end?.dateTime;
    // Skip all-day events (only have `date`) — we don't have a clean way
    // to represent "blocked this whole day at a specific timezone" without
    // more plumbing, and most such events are travel/holiday rather than
    // hard-busy for scheduling.
    if (!startDT || !endDT) continue;
    const sMatch = startDT.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    const eMatch = endDT.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (!sMatch || !eMatch) continue;
    // Use the start date; if the event crosses midnight we still only
    // block from start to end-of-day-start-date. Multi-day events are
    // rare for social meetups and the cost of under-blocking them is
    // smaller than the cost of over-blocking.
    out.push({
      date: sMatch[1],
      start_time: `${sMatch[2]}:${sMatch[3]}`,
      end_time: sMatch[1] === eMatch[1] ? `${eMatch[2]}:${eMatch[3]}` : "23:59",
      label: `calendar: ${e.summary?.slice(0, 40) ?? "busy"}`,
    });
  }
  return out;
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
