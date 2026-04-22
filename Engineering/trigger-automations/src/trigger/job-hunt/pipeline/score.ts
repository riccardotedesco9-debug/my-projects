// score.ts — soft score + confidence. Score is only used to sort the digest,
// NOT to gate. Confidence flags jobs where several positive signals align
// (or conversely a lot of uncertainty) so the digest can badge them.

import {
  CORE_KEYWORDS,
  TOOL_KEYWORDS,
  DOMAIN_KEYWORDS,
  DRIVE_30MIN,
  SCORE_WEIGHTS,
  SOURCE_PRIORITY,
} from "../config.js";
import type { Job, Confidence } from "../types.js";

export function scoreJob(job: Job): Job {
  const w = SCORE_WEIGHTS;
  let score = 0;
  const signals: string[] = [];

  const titleLower = job.title.toLowerCase();
  const descLower = job.descriptionMd.toLowerCase();

  if (CORE_KEYWORDS.some((k) => titleLower.includes(k))) {
    score += w.titleCore;
    signals.push("titleCore");
  } else if (CORE_KEYWORDS.some((k) => descLower.includes(k))) {
    score += w.descCore;
    signals.push("descCore");
  }

  // Tool keywords — cap at 3 to avoid keyword-stuffing dominating
  let toolHits = 0;
  for (const tool of TOOL_KEYWORDS) {
    if (descLower.includes(tool)) toolHits++;
    if (toolHits >= 3) break;
  }
  score += toolHits * w.tool;
  if (toolHits > 0) signals.push(`tools:${toolHits}`);

  if (/\b(i[-\s]?gaming|gambling|casino|sportsbook|betting)\b/.test(descLower)) {
    score += w.domainIGaming;
    signals.push("iGaming");
  } else if (DOMAIN_KEYWORDS.some((k) => descLower.includes(k))) {
    score += w.domainOther;
    signals.push("domain");
  }

  if (job.workMode === "hybrid") score += w.workModeHybrid;
  else if (job.workMode === "remote") score += w.workModeRemote;

  if (job.partTime === "yes") {
    score += w.partTimeConfirmed;
    signals.push("ptConfirmed");
  }

  if (job.locality) {
    score += w.inMalta;
    const norm = job.locality.toLowerCase();
    if (DRIVE_30MIN.has(norm)) {
      score += w.drive30min;
      signals.push("drive30");
    }
  }

  if (job.postedAt) {
    const ageDays = (Date.now() - new Date(job.postedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays <= 7) {
      score += w.recentPost;
      signals.push("recent");
    }
  }

  // Priority bonus — tiny nudge so specialist recruiters surface above
  // aggregators when everything else is equal.
  score += Math.round(SOURCE_PRIORITY[job.source] / 20);

  const confidence = computeConfidence(signals, job);
  return { ...job, score, confidence };
}

function computeConfidence(signals: string[], job: Job): Confidence {
  // High: confirmed part-time + core title match + some locality/domain signal
  if (
    signals.includes("ptConfirmed") &&
    signals.includes("titleCore") &&
    (signals.includes("drive30") || signals.includes("iGaming") || signals.includes("domain"))
  ) {
    return "high";
  }
  // Medium: has core keyword match + enough metadata to be actionable
  if (
    (signals.includes("titleCore") || signals.includes("descCore")) &&
    job.company.length > 0
  ) {
    return "medium";
  }
  return "low";
}
