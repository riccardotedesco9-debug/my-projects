// Round-9 observability dashboard — one-page HTML view of MeetSync's
// session_events table. Answers two common ops questions:
//   1. "Which sessions are stuck?"        → table at top
//   2. "What just happened in session X?"  → timeline below
//
// Served at GET /dashboard?token=<webhook-secret>. Not a full
// observability platform — zero deps, no JS, no charts, just SQL
// query results rendered as HTML tables. If you need more, add it;
// don't let the simplicity here become a cargo cult.

import type { Env } from "./types.js";

const STUCK_THRESHOLD_MIN = 15;

interface SessionRow {
  id: string;
  status: string;
  match_attempt: number;
  created_at: string;
  creator_chat_id: string;
}

interface EventRow {
  id: number;
  session_id: string;
  event: string;
  data: string | null;
  created_at: string;
}

interface StuckRow {
  session_id: string;
  last_event: string;
  last_seen: string;
  minutes_ago: number;
}

export async function renderDashboard(env: Env): Promise<Response> {
  // Pull the three datasets in parallel.
  const [stuck, recentEvents, recentSessions] = await Promise.all([
    findStuckSessions(env),
    fetchRecentEvents(env, 50),
    fetchRecentSessions(env, 20),
  ]);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MeetSync — session events</title>
<style>
  body { font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #222; max-width: 1200px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin-top: 28px; margin-bottom: 8px; color: #444; }
  .sub { color: #888; font-size: 12px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
  th { background: #f7f7f7; font-weight: 600; color: #555; }
  tr:hover td { background: #fafafa; }
  .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }
  .dim { color: #888; }
  .stuck { background: #fff3e0 !important; }
  .event { font-family: ui-monospace, monospace; font-size: 11px; background: #eef2ff; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
  .status-COMPLETED { color: #2e7d32; }
  .status-EXPIRED { color: #888; }
  .status-MATCHED, .status-MATCHING { color: #f57c00; }
  .status-PAIRED, .status-OPEN { color: #1976d2; }
  .empty { color: #aaa; font-style: italic; padding: 12px; }
</style>
</head>
<body>
  <h1>MeetSync — session events</h1>
  <div class="sub">Generated ${new Date().toISOString()} UTC · threshold ${STUCK_THRESHOLD_MIN}m</div>

  <h2>Stuck sessions <span class="dim">(in-flight, no activity for ${STUCK_THRESHOLD_MIN}+ minutes)</span></h2>
  ${stuck.length === 0
    ? `<div class="empty">No stuck sessions 🎉</div>`
    : `<table>
        <tr><th>Session</th><th>Last event</th><th>Last seen</th><th>Minutes ago</th></tr>
        ${stuck.map((r) => `
          <tr class="stuck">
            <td class="mono">${escapeHtml(r.session_id)}</td>
            <td><span class="event">${escapeHtml(r.last_event)}</span></td>
            <td class="mono dim">${escapeHtml(r.last_seen)}</td>
            <td>${r.minutes_ago}</td>
          </tr>`).join("")}
      </table>`
  }

  <h2>Recent sessions <span class="dim">(last 20)</span></h2>
  ${recentSessions.length === 0
    ? `<div class="empty">No sessions yet</div>`
    : `<table>
        <tr><th>Session</th><th>Status</th><th>Attempt</th><th>Creator</th><th>Created</th></tr>
        ${recentSessions.map((s) => `
          <tr>
            <td class="mono">${escapeHtml(s.id)}</td>
            <td class="status-${escapeHtml(s.status)}">${escapeHtml(s.status)}</td>
            <td>${s.match_attempt}</td>
            <td class="mono dim">${escapeHtml(s.creator_chat_id)}</td>
            <td class="mono dim">${escapeHtml(s.created_at)}</td>
          </tr>`).join("")}
      </table>`
  }

  <h2>Recent session events <span class="dim">(last 50)</span></h2>
  ${recentEvents.length === 0
    ? `<div class="empty">No session events yet — emit some via the trigger tasks.</div>`
    : `<table>
        <tr><th>When</th><th>Session</th><th>Event</th><th>Data</th></tr>
        ${recentEvents.map((e) => `
          <tr>
            <td class="mono dim">${escapeHtml(e.created_at)}</td>
            <td class="mono">${escapeHtml(e.session_id.slice(0, 8))}…</td>
            <td><span class="event">${escapeHtml(e.event)}</span></td>
            <td class="mono dim">${e.data ? escapeHtml(e.data) : ""}</td>
          </tr>`).join("")}
      </table>`
  }
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Don't let CDNs or browsers cache the dashboard — we want live data.
      "Cache-Control": "no-store",
    },
  });
}

// --- queries ---

/**
 * Sessions whose most recent event is older than STUCK_THRESHOLD_MIN
 * minutes AND whose last event isn't a terminal one. A session with a
 * terminal event (match_delivered, no_overlap_final, session_expired)
 * is "done" even if it's been a long time since the event fired.
 */
async function findStuckSessions(env: Env): Promise<StuckRow[]> {
  const result = await env.DB.prepare(`
    SELECT
      session_id,
      event AS last_event,
      created_at AS last_seen,
      CAST((julianday('now') - julianday(created_at)) * 24 * 60 AS INTEGER) AS minutes_ago
    FROM session_events se
    WHERE se.id = (
      SELECT MAX(id) FROM session_events WHERE session_id = se.session_id
    )
    AND event NOT IN ('match_delivered', 'no_overlap_final', 'session_expired')
    AND (julianday('now') - julianday(created_at)) * 24 * 60 > ?
    ORDER BY minutes_ago DESC
    LIMIT 50
  `).bind(STUCK_THRESHOLD_MIN).all<StuckRow>();
  return result.results ?? [];
}

async function fetchRecentEvents(env: Env, limit: number): Promise<EventRow[]> {
  const result = await env.DB.prepare(`
    SELECT id, session_id, event, data, created_at
      FROM session_events
      ORDER BY id DESC
      LIMIT ?
  `).bind(limit).all<EventRow>();
  return result.results ?? [];
}

async function fetchRecentSessions(env: Env, limit: number): Promise<SessionRow[]> {
  const result = await env.DB.prepare(`
    SELECT id, status, match_attempt, created_at, creator_chat_id
      FROM sessions
      ORDER BY created_at DESC
      LIMIT ?
  `).bind(limit).all<SessionRow>();
  return result.results ?? [];
}

// --- util ---

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
