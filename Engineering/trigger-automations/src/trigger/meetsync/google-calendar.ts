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

/** Create a Google Calendar event for a user. Returns true if successful. */
export async function createCalendarEvent(
  chatId: string,
  date: string, // YYYY-MM-DD
  startTime: string, // HH:MM
  endTime: string, // HH:MM
  summary: string = "Meetup",
  timezone: string = "Europe/Malta",
): Promise<boolean> {
  const token = await getGoogleToken(chatId);
  if (!token) return false; // user hasn't connected Google Calendar

  let accessToken = token.access_token;

  // Refresh if expired
  if (new Date(token.expires_at) <= new Date()) {
    const refreshed = await refreshAccessToken(token.refresh_token);
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


async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expires_at: string } | null> {
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

  if (!response.ok) return null;

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}
