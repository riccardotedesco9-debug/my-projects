// llm-rank.ts — CV-aware fit assessment via Claude.
//
// Two-stage hybrid:
//   Stage 1 (Haiku): batch every filtered job, rank 0-100 + one-liner + tags.
//     Cheap per-job scoring — replaces the old keyword-based `score.ts`.
//   Stage 2 (Sonnet): re-rank the top-N Stage-1 survivors for the digest.
//     Sonnet reads each job carefully and produces a sharper fit line + better
//     redFlags detection. Only called on digest-bound jobs (≤ cap), not on
//     full pipeline volume — keeps cost predictable.
//
// Input: user profile (markdown) + array of jobs with title/company/loc/desc.
// Output: per-job { fitScore, fit, redFlags, tags } plus the prompt hash used
//   so dedup-reuse doesn't re-score the same job twice on retries.

import type { Job } from "../types.js";

const API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const HAIKU_MODEL = "claude-haiku-4-5";
const SONNET_MODEL = "claude-sonnet-4-6";

export interface LlmAssessment {
  fitScore: number;         // 0-100
  fit: string;              // one-sentence reasoning
  redFlags: string[];
  tags: string[];
}

interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Stage 1: quick triage of every filtered job. Batches of ~15 for Haiku.
 * Returns Map<sourceId, assessment>.
 */
export async function rankBatchHaiku(
  profile: string,
  jobs: Job[],
  batchSize = 15,
): Promise<Map<string, LlmAssessment>> {
  return rankWithModel(profile, jobs, batchSize, HAIKU_MODEL, /* depth */ "triage");
}

/**
 * Stage 2: deeper re-rank of the top-N digest candidates using Sonnet.
 * Smaller batches (~10) since Sonnet cost/tokens justify tighter context.
 */
export async function rerankSonnet(
  profile: string,
  jobs: Job[],
  batchSize = 10,
): Promise<Map<string, LlmAssessment>> {
  return rankWithModel(profile, jobs, batchSize, SONNET_MODEL, /* depth */ "deep");
}

async function rankWithModel(
  profile: string,
  jobs: Job[],
  batchSize: number,
  model: string,
  depth: "triage" | "deep",
): Promise<Map<string, LlmAssessment>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const results = new Map<string, LlmAssessment>();
  // Chunk into batches, run sequentially. Could parallelise but Anthropic's
  // rate limits plus keeping per-run cost predictable favours serial.
  for (let i = 0; i < jobs.length; i += batchSize) {
    const batch = jobs.slice(i, i + batchSize);
    try {
      const assessed = await assessBatch(apiKey, profile, batch, model, depth);
      for (const [id, a] of assessed) results.set(id, a);
    } catch (err) {
      console.warn(`[llm-rank/${model}] batch ${i / batchSize + 1} failed:`, err instanceof Error ? err.message : err);
      // Degrade gracefully — leave those jobs unranked; orchestrator falls back to neutral 50.
    }
  }
  return results;
}

async function assessBatch(
  apiKey: string,
  profile: string,
  batch: Job[],
  model: string,
  depth: "triage" | "deep",
): Promise<Map<string, LlmAssessment>> {
  const systemPrompt = buildSystemPrompt(profile, depth);
  const userContent = buildUserContent(batch);
  // Triage budget raised from 1200 → 2500: at batchSize=15 and ~120 out-tokens/job
  // the response was truncating at ~1150 tokens, leaving jobs unscored and
  // defaulted to score=0 (which cascades into auto-reject at orchestrator).
  const maxTokens = depth === "deep" ? 2000 : 2500;

  const resp = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Claude API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const body = (await resp.json()) as ClaudeResponse;
  const text = body.content?.find((c) => c.type === "text")?.text ?? "";
  return parseResponse(text, batch, body.stop_reason);
}

function buildSystemPrompt(profile: string, depth: "triage" | "deep"): string {
  // Cheap defence: scrub the closing tag so a typo'd profile cell can't
  // prematurely close our `<candidate_profile>` block and leak instructions
  // into the LLM's interpretation context.
  const safeProfile = profile.replace(/<\/?candidate_profile>/gi, "");
  const depthNote = depth === "deep"
    ? `You are doing a deep second-pass assessment. The jobs below were pre-screened. Sharpen fit reasoning and catch subtle red flags (required languages, hidden full-time, rotation shifts).

When a job includes a "reputation" field (Glassdoor / Indeed ratings, summary, flags), you MUST incorporate it:
- If rating is strong (4.0★+): reflect positively in the fit line ("well-rated employer on Glassdoor")
- If rating is mediocre (3.0–3.9): neutral mention only when relevant
- If rating is weak (<3.0) or reputation.redFlags is non-empty: MUST add a concern to redFlags
- If a company is famous in your training data (major iGaming, fintech, logistics, insurance, etc.), add reputation context even if no live data present.

DATA-THIN HANDLING (critical):
When a job has: no company name AND no description AND no reputation, the data is too sparse to confidently rank.
- Cap fitScore at 45 (Adjacent tier maximum). Do NOT give these 60–80 scores.
- The "fit" line should acknowledge the gap: "Minimal data — title suggests X but full scope unclear without employer or description".
- For redFlags: put ONE concise flag like "insufficient listing data — click through to verify". Do NOT pad with 3-4 generic concerns ("part-time status unknown", "salary not disclosed", "no description") — those are obvious from the absent data.

RED-FLAG DISCIPLINE:
- Maximum 3 redFlags per job.
- Each flag must add information the reader couldn't infer from an empty field.
- Never say "salary not disclosed" unless the role context makes salary genuinely critical to flag.`
    : `You are doing first-pass triage. Be decisive. Lean on the profile's scoring rubric.

DATA-THIN HANDLING: if a job has no company + no description, cap fitScore at 45 and keep redFlags to one entry max.`;

  return `You evaluate job postings for a specific candidate and return STRICT JSON.

${depthNote}

<candidate_profile>
${safeProfile}
</candidate_profile>

<output_format>
Return ONLY a JSON array (no prose, no markdown fence). One object per job, in the SAME ORDER as input. Each object must have exactly these keys:
- sourceId: string — copy from input
- fitScore: integer 0-100 — use the rubric in the profile
- fit: string — ONE crisp sentence explaining why the role matches (or why it doesn't). Cite specific skills/domain continuity when possible. Max 140 chars.
- redFlags: array of short strings — concerns the candidate should see before clicking. Empty array if none.
- tags: array of 2-5 short strings — domain + work type tags (e.g. "iGaming", "part-time", "hybrid", "Power BI").
</output_format>

Do not add fields. Do not wrap in an object. Just the array. If fit is unknown, use null; redFlags and tags are always arrays (possibly empty).`;
}

function buildUserContent(batch: Job[]): string {
  // Include only the fields the LLM needs — keep input compact.
  const payload = batch.map((j) => {
    const item: Record<string, unknown> = {
      sourceId: j.sourceId,
      source: j.source,
      title: j.titleRaw || j.title,
      company: j.companyRaw || j.company,
      location: j.location,
      workMode: j.workMode,
      partTime: j.partTime,
      estSalary: j.estSalary ?? null,
      description: j.descriptionMd.slice(0, 700),
    };
    // Reputation attached via orchestrator (Sonnet pass only). Include for
    // citation in fit/redFlags when present.
    if (j.reputation) {
      const r = j.reputation;
      item.reputation = {
        summary: r.summary,
        glassdoor: r.glassdoor ? `${r.glassdoor.rating}★ (${r.glassdoor.reviews} reviews)` : undefined,
        indeed: r.indeed ? `${r.indeed.rating}★ (${r.indeed.reviews} reviews)` : undefined,
        redFlags: r.redFlags,
      };
    }
    return item;
  });
  return `Score the following ${batch.length} jobs. Return JSON array.\n\n${JSON.stringify(payload, null, 2)}`;
}

function parseResponse(text: string, batch: Job[], stopReason?: string): Map<string, LlmAssessment> {
  const out = new Map<string, LlmAssessment>();
  const trimmed = text.trim();
  // Strip accidental ```json fences if the model added them despite instructions.
  const cleaned = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: try to extract a JSON array substring
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) {
      console.warn(`[llm-rank] could not parse JSON (stop=${stopReason}):`, cleaned.slice(0, 300));
      return out;
    }
    try {
      parsed = JSON.parse(match[0]);
    } catch (err) {
      // If the response was truncated at max_tokens, try to salvage complete
      // objects from the start of the array rather than losing the whole batch.
      if (stopReason === "max_tokens") {
        const salvaged = salvageCompleteObjects(match[0]);
        if (salvaged.length > 0) {
          console.warn(`[llm-rank] response truncated (max_tokens), salvaged ${salvaged.length}/${batch.length} complete objects`);
          parsed = salvaged;
        } else {
          console.warn(`[llm-rank] truncated + unsalvageable (stop=${stopReason}):`, err instanceof Error ? err.message : err);
          return out;
        }
      } else {
        console.warn(`[llm-rank] JSON extract failed (stop=${stopReason}):`, err instanceof Error ? err.message : err);
        return out;
      }
    }
  }
  if (!Array.isArray(parsed)) {
    console.warn("[llm-rank] response not an array, skipping");
    return out;
  }
  const knownIds = new Set(batch.map((j) => j.sourceId));
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const sourceId = String(obj.sourceId ?? "");
    if (!sourceId || !knownIds.has(sourceId)) continue;
    const fitScore = clamp(Number(obj.fitScore ?? 50), 0, 100);
    const fit = String(obj.fit ?? "").slice(0, 180);
    const redFlags = Array.isArray(obj.redFlags) ? obj.redFlags.map(String).slice(0, 5) : [];
    const tags = Array.isArray(obj.tags) ? obj.tags.map(String).slice(0, 5) : [];
    out.set(sourceId, { fitScore, fit, redFlags, tags });
  }
  return out;
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return 50;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Walk a truncated JSON array and keep only the fully-closed objects at the
 * start. Tolerates missing trailing `]` and partial last-object content.
 * Brace-balance aware — ignores `{`/`}` inside strings.
 */
function salvageCompleteObjects(raw: string): unknown[] {
  const out: unknown[] = [];
  let i = raw.indexOf("[");
  if (i < 0) return out;
  i++; // step past [
  while (i < raw.length) {
    // skip whitespace + commas between objects
    while (i < raw.length && /[\s,]/.test(raw[i])) i++;
    if (raw[i] !== "{") break;
    const start = i;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (; i < raw.length; i++) {
      const ch = raw[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    if (depth !== 0) break; // unterminated object at tail → stop
    try {
      out.push(JSON.parse(raw.slice(start, i)));
    } catch {
      break;
    }
  }
  return out;
}
