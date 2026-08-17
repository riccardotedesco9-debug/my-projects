// Default event durations — so the bot never has to ask "how long will it be?".
//
// The caller almost never says how long something lasts ("dinner with Sofia
// Friday 8pm"). Asking every time is friction, so add_personal_event and
// book_meetup both treat end_time as OPTIONAL: when it's omitted, the length is
// assumed from the event's own words. Claude still passes an explicit end_time
// whenever the caller stated or implied a length — this table is the fallback,
// not an override.
//
// Matching runs against the label/title, which by prompt convention starts with
// one emoji ("🍽️ dinner with Sofia"). The emoji are matched too, so the table
// still fires on labels written in the caller's own language (it/es/fr/de).

/** Fallback when nothing in the table matches: a plain one-hour block. */
export const DEFAULT_EVENT_MINUTES = 60;

/** First match wins, so longer/more specific events sit above shorter ones. */
const DURATION_RULES: ReadonlyArray<{ minutes: number; match: RegExp }> = [
  { minutes: 480, match: /💒|\bwedding\b|\bmatrimonio\b|\bboda\b|\bmariage\b|\bhochzeit\b/i },
  { minutes: 360, match: /✈️|\bflight\b|\bairport\b|\bvolo\b|\bvuelo\b/i },
  { minutes: 240, match: /🥾|⛰️|🏖️|\bhik(e|ing)\b|\bbeach\b|\bday trip\b|\broad trip\b|\bexcursion\b/i },
  { minutes: 180, match: /🎉|🎂|🎸|🎤|🏟️|\bparty\b|\bbirthday\b|\bfesta\b|\bfiesta\b|\bconcert\b|\bgig\b|\bfestival\b/i },
  { minutes: 150, match: /🎬|🍿|\bmovie\b|\bcinema\b|\bfilm\b/i },
  { minutes: 120, match: /🍽️|🍕|🍝|🍻|🍷|\bdinner\b|\bsupper\b|\bdrinks\b|\bbbq\b|\bcena\b|\bdîner\b/i },
  { minutes: 90, match: /🥐|\blunch\b|\bbrunch\b|\bpranzo\b|\balmuerzo\b/i },
];

/** How long an event with this label most likely runs, in minutes. */
export function inferEventMinutes(label: string): number {
  const text = typeof label === "string" ? label.trim() : "";
  if (!text) return DEFAULT_EVENT_MINUTES;
  for (const rule of DURATION_RULES) {
    if (rule.match.test(text)) return rule.minutes;
  }
  return DEFAULT_EVENT_MINUTES;
}

/**
 * end_time for an event that only gave us a start. Clamped to 23:59 on the same
 * day: an end_time numerically below start_time reads as an OVERNIGHT shift
 * everywhere else in the schedule, and a personal event is never that.
 */
export function defaultEndTime(startTime: string, label: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(typeof startTime === "string" ? startTime.trim() : "");
  if (!m) return startTime;
  const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const end = Math.min(start + inferEventMinutes(label), 23 * 60 + 59);
  const hh = Math.floor(end / 60).toString().padStart(2, "0");
  const mm = (end % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}
