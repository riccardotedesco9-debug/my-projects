// contact.ts — pull an email / phone / application URL out of the description
// when present. Useful for small employers that invite direct applications.
// Called after filter+score but before writing to sheet.

import type { Job } from "../types.js";

export function extractContact(job: Job): string | null {
  const text = job.descriptionMd;
  if (!text) return null;

  // Email — prefer corporate emails over freemail
  const emails = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0]);
  const corporate = emails.find((e) => !/gmail\.com|hotmail\.com|outlook\.com|yahoo\.com/i.test(e));
  if (corporate) return corporate;
  if (emails.length > 0) return emails[0];

  // Malta phone numbers: +356 XXXXXXXX or 8-digit starting with 2/7/9
  const phoneMatch = text.match(/\+?356[\s-]?\d{4}[\s-]?\d{4}/) ?? text.match(/\b[279]\d{7}\b/);
  if (phoneMatch) return phoneMatch[0];

  // Application URL (apply button text links)
  const applyMatch = text.match(/\[(?:apply[^\]]*)\]\((https?:\/\/[^)]+)\)/i);
  if (applyMatch) return applyMatch[1];

  return null;
}
