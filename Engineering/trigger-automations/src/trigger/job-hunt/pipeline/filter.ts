// filter.ts — analytical-role + part-time hard gate.
// Rules (all must pass):
//   1. Malta-gate — handled separately in malta-gate.ts upstream
//   2. Part-time — partTime !== "no". "unknown" passes with note.
//   3. Analytical:
//        title.hasAny(CORE) OR
//        (desc.hasAny(CORE ∪ TOOLS ∪ DOMAIN) AND NOT anyField.hasAny(EXCLUDE))
//
// Returns { pass, reasons } so the orchestrator can log why a job was dropped.

import {
  CORE_KEYWORDS,
  TOOL_KEYWORDS,
  DOMAIN_KEYWORDS,
  EXCLUDE_KEYWORDS,
} from "../config.js";
import type { Job } from "../types.js";

export interface FilterResult {
  pass: boolean;
  reasons: string[];
}

export function runFilter(job: Job): FilterResult {
  const reasons: string[] = [];
  const titleLower = job.title.toLowerCase();
  const descLower = job.descriptionMd.toLowerCase();
  const allFields = `${titleLower} ${job.company.toLowerCase()} ${descLower}`;

  // Rule 2 — part-time gate
  if (job.partTime === "no") {
    reasons.push("explicitly full-time");
    return { pass: false, reasons };
  }

  // Exclude rule (strongest signal — run before positive match)
  for (const kw of EXCLUDE_KEYWORDS) {
    if (allFields.includes(kw)) {
      reasons.push(`excluded: "${kw}"`);
      return { pass: false, reasons };
    }
  }

  // Rule 3 — analytical match
  const titleHasCore = CORE_KEYWORDS.some((k) => titleLower.includes(k));
  if (titleHasCore) {
    reasons.push("title has core keyword");
    return { pass: true, reasons };
  }

  const descHasCore = CORE_KEYWORDS.some((k) => descLower.includes(k));
  const descHasTool = TOOL_KEYWORDS.some((k) => descLower.includes(k));
  const descHasDomain = DOMAIN_KEYWORDS.some((k) => descLower.includes(k));
  if (descHasCore || (descHasTool && descHasDomain)) {
    reasons.push(
      descHasCore ? "desc has core keyword" : "desc has tool + domain keywords",
    );
    return { pass: true, reasons };
  }

  reasons.push("no analytical signal found");
  return { pass: false, reasons };
}
