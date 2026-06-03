// MeetSync app-level usage metrics for the monthly billing pulse.
// Single-shot: builds 4 COUNT queries against D1 and returns the totals.
// Fail-open — any provider's error is captured, never thrown.
//
// Schema notes (see meetsync/migrations/0010 + 0017):
//   users.first_seen / last_seen  → TEXT, SQLite default `YYYY-MM-DD HH:MM:SS`
//   conversation_log.role         → 'user' | 'bot'
//   conversation_log.created_at   → TEXT, same format
//   reminders.status              → 'PENDING' | 'FIRED' | 'CANCELLED'
//   reminders.fired_at            → TEXT (nullable until fired)
//
// Date filter: month bounds are passed as ISO strings; we slice to the
// `YYYY-MM` prefix and use LIKE for clean lexicographic match against
// SQLite's default datetime format (which sorts the same way).

import { query } from "../../trigger/meetsync/d1-client.js";

export interface MeetsyncAppMetrics {
  active_users: number | null;
  new_users: number | null;
  turns: number | null;
  reminders_fired: number | null;
  error: string | null;
}

export async function fetchMeetsyncAppMetrics(monthStartISO: string): Promise<MeetsyncAppMetrics> {
  // monthStartISO is `2026-04-01T00:00:00.000Z` → prefix `2026-04`.
  const monthPrefix = monthStartISO.slice(0, 7);
  const like = `${monthPrefix}%`;

  try {
    const [active, fresh, turns, reminders] = await Promise.all([
      query<{ c: number }>(
        "SELECT COUNT(DISTINCT chat_id) AS c FROM users WHERE last_seen LIKE ?",
        [like],
      ),
      query<{ c: number }>(
        "SELECT COUNT(*) AS c FROM users WHERE first_seen LIKE ?",
        [like],
      ),
      query<{ c: number }>(
        "SELECT COUNT(*) AS c FROM conversation_log WHERE role = 'user' AND created_at LIKE ?",
        [like],
      ),
      query<{ c: number }>(
        "SELECT COUNT(*) AS c FROM reminders WHERE status = 'FIRED' AND fired_at LIKE ?",
        [like],
      ),
    ]);

    return {
      active_users: active.results[0]?.c ?? 0,
      new_users: fresh.results[0]?.c ?? 0,
      turns: turns.results[0]?.c ?? 0,
      reminders_fired: reminders.results[0]?.c ?? 0,
      error: null,
    };
  } catch (err) {
    return {
      active_users: null,
      new_users: null,
      turns: null,
      reminders_fired: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
