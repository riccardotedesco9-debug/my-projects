// nudge-stale-schedules — daily cron that nudges users whose latest_schedule
// has drifted entirely into the past. Without this, a user uploads a week's
// shifts on Monday, and by the next Monday the schedule is 7 days stale;
// compute_overlap returns "no overlap" and the user has no idea why.
//
// Policy: one nudge per user per 14 days max (tracked via users.last_stale_nudge_at).
// Silent for users with no schedule yet, or with any future-dated entry.

import { schedules } from "@trigger.dev/sdk";
import { query } from "./d1-client.js";
import { sendTextMessage } from "./telegram-client.js";

const NUDGE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export const nudgeStaleSchedules = schedules.task({
  id: "meetsync-nudge-stale-schedules",
  cron: "0 9 * * *", // 09:00 UTC daily (~10:00 / 11:00 Europe/Malta)
  run: async () => {
    const todayISO = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() - NUDGE_COOLDOWN_MS).toISOString();
    const candidates = await query<{
      chat_id: string;
      name: string | null;
      preferred_language: string;
      latest_schedule_json: string;
    }>(
      `SELECT chat_id, name, preferred_language, latest_schedule_json
         FROM users
        WHERE latest_schedule_json IS NOT NULL
          AND latest_schedule_json != ''
          AND (last_stale_nudge_at IS NULL OR last_stale_nudge_at < ?)`,
      [cutoff],
    );

    let nudged = 0;
    for (const u of candidates.results) {
      let shifts: Array<{ date?: string }> = [];
      try {
        const parsed = JSON.parse(u.latest_schedule_json);
        if (Array.isArray(parsed)) shifts = parsed;
      } catch {
        continue;
      }
      if (shifts.length === 0) continue;
      // Stale if EVERY dated entry is strictly in the past.
      const hasFuture = shifts.some((s) => typeof s.date === "string" && s.date >= todayISO);
      if (hasFuture) continue;

      const lang = u.preferred_language ?? "en";
      const name = u.name ?? "hey";
      const msg =
        lang === "it"
          ? `👋 ${name}, il tuo orario nel bot è scaduto. Mandami quello aggiornato quando puoi — così posso trovare orari liberi con i tuoi contatti.`
          : lang === "es"
            ? `👋 ${name}, tu horario en el bot ya está desactualizado. Envíame el nuevo cuando puedas — así puedo encontrar horarios libres con tus contactos.`
            : lang === "fr"
              ? `👋 ${name}, ton planning est expiré dans le bot. Envoie-moi la version à jour dès que tu peux — je pourrai trouver des créneaux avec tes contacts.`
              : lang === "de"
                ? `👋 ${name}, dein Zeitplan im Bot ist veraltet. Schick mir den aktuellen, sobald du kannst — dann finde ich freie Zeiten mit deinen Kontakten.`
                : `👋 ${name}, your schedule in the bot is out of date. Send me the current one when you have a sec — then I can find free times with your contacts.`;

      try {
        await sendTextMessage(u.chat_id, msg);
        await query("UPDATE users SET last_stale_nudge_at = datetime('now') WHERE chat_id = ?", [u.chat_id]);
        nudged++;
      } catch (err) {
        console.warn(`[nudge-stale] send failed for ${u.chat_id}:`, err);
      }
    }

    return { examined: candidates.results.length, nudged };
  },
});
