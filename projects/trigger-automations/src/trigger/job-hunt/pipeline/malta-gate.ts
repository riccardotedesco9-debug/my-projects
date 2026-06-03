// malta-gate.ts — hard geographic filter.
// A job passes if any of:
//   (1) locality resolved to a Malta/Gozo town
//   (2) location or description contains "malta" / "mt" word boundary
//   (3) verified remote (workMode === "remote") AND title/desc mentions Malta
//       time zone, Maltese companies, or EU work authorization Malta — otherwise
//       pure remote/global jobs get rejected (we want a Malta-resident fit)

import type { Job } from "../types.js";

export function passesMaltaGate(job: Job): boolean {
  if (job.locality) return true;
  const blob = `${job.location} ${job.descriptionMd}`.toLowerCase();
  if (/\bmalta\b|\bmaltese\b|\bmt\b/.test(blob)) return true;

  // Remote-and-Malta-adjacent: Europe/Malta timezone, EU work authorization
  // in Malta, etc. Pure remote without Malta signal is rejected.
  if (job.workMode === "remote") {
    if (/europe\/malta|central european time|cet\b/i.test(job.descriptionMd)) return true;
  }
  return false;
}
