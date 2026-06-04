#!/usr/bin/env node
// Promote the genuinely marketing-specific skills from the local marketing kit
// (agents/Marketing/.claude/skills) into the global library (~/.claude/skills),
// so every project can reach marketing tools on demand.
//
// Why this exists: ClaudeKit ships skills monolithically per kit and `ck init`
// re-installs them locally; there is no native "install these skills globally"
// selector. This is the re-runnable bridge. Run it again after a marketing-kit
// update (`ck init --kit marketing` in agents/Marketing) to refresh the global
// copies. Skill bodies load on demand (progressive disclosure), so the cost of a
// large global library is just lightweight metadata.
//
// Usage:
//   node tools/promote-marketing-skills.mjs            # add any missing skills
//   node tools/promote-marketing-skills.mjs --force    # also overwrite existing (refresh after a kit update)

import { cpSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(repoRoot, "agents", "Marketing", ".claude", "skills");
const DEST = join(homedir(), ".claude", "skills");
const force = process.argv.includes("--force");

// Genuinely marketing-capability skills. Excludes generic/workflow dups that
// global already covers (plan, debugging, code-review, write, analyze, test,
// init, hub, dashboard, storage) and scaffolding/junk (template-skill, play).
const MARKETING_SKILLS = [
  "ab-test-setup", "ads-management", "affiliate-marketing", "analytics",
  "assets-organizing", "banner-design", "brand-guidelines", "campaign-management",
  "campaign", "cip-design", "competitor-alternatives", "competitor", "content-hub",
  "content-marketing", "creativity", "design-system", "email-marketing", "email",
  "form-cro", "free-tool-strategy", "funnel", "gamification-marketing",
  "launch-strategy", "logo-design", "marketing-dashboard", "marketing-ideas",
  "marketing-planning", "marketing-psychology", "marketing-research", "onboarding-cro",
  "paid-ads", "persona", "pricing-strategy", "referral-program-building",
  "seo-optimization", "seo", "slides-design", "slides", "social-media", "social",
  "video-production", "video", "youtube-handling", "youtube-thumbnail-design", "youtube",
];

if (!existsSync(SRC)) {
  console.error(`Source not found: ${SRC}\nIs the marketing kit installed in agents/Marketing? (ck init --kit marketing)`);
  process.exit(1);
}

let added = 0, refreshed = 0, skipped = 0, missing = 0;
for (const name of MARKETING_SKILLS) {
  const src = join(SRC, name);
  const dest = join(DEST, name);
  if (!existsSync(src)) { missing++; console.warn(`  ! source missing: ${name}`); continue; }
  if (existsSync(dest)) {
    if (!force) { skipped++; continue; }
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
    refreshed++;
  } else {
    cpSync(src, dest, { recursive: true });
    added++;
  }
}

console.log(`marketing skills → global: ${added} added, ${refreshed} refreshed, ${skipped} already present, ${missing} missing-in-source`);
