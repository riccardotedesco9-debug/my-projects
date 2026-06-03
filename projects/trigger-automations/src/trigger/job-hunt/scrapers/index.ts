// scrapers/index.ts — per-track scraper registries.
// Malta registry fuels `job-hunt-daily-scan` (07:00 Europe/Malta).
// Global registry fuels `job-hunt-global-scan` (07:05 Europe/Malta).
// All active scrapers route through the Firecrawl `/v1/search` helper or a
// direct sitemap/API fetch — see individual files for source-specific logic.

import { scrapeLinkedIn } from "./linkedin.js";
import { scrapeKeepmeposted } from "./keepmeposted.js";
import { scrapeKonnekt } from "./konnekt.js";
import { scrapeCastille } from "./castille.js";
import { scrapeMaltajobsboard } from "./maltajobsboard.js";
import { scrapeArcher } from "./archer.js";
import { scrapeJooble } from "./jooble.js";
import { scrapeMfsa } from "./mfsa.js";
import { scrapeGreenhouseMalta } from "./greenhouse-malta.js";
import { scrapeLinkedInIe } from "./linkedin-ie.js";
import { scrapeIrishJobs } from "./irishjobs.js";
import { scrapeIndeedIe } from "./indeed-ie.js";
import { scrapeRemoteok } from "./remoteok.js";
import { scrapeJoobleIe } from "./jooble-ie.js";
import { scrapeLinkedInRemote } from "./linkedin-remote.js";
import type { Job, Source, Track } from "../types.js";

export type ScraperFn = () => Promise<Partial<Job>[]>;

export const MALTA_SCRAPERS: Partial<Record<Source, ScraperFn>> = {
  linkedin: scrapeLinkedIn,
  keepmeposted: scrapeKeepmeposted,
  konnekt: scrapeKonnekt,
  castille: scrapeCastille,
  maltajobsboard: scrapeMaltajobsboard,
  archer: scrapeArcher,
  jooble: scrapeJooble,
  mfsa: scrapeMfsa,
  "greenhouse-malta": scrapeGreenhouseMalta,
};

export const GLOBAL_SCRAPERS: Partial<Record<Source, ScraperFn>> = {
  "linkedin-ie": scrapeLinkedInIe,
  irishjobs: scrapeIrishJobs,
  "indeed-ie": scrapeIndeedIe,
  remoteok: scrapeRemoteok,
  "jooble-ie": scrapeJoobleIe,
  "linkedin-remote": scrapeLinkedInRemote,
};

export function scrapersForTrack(track: Track): Partial<Record<Source, ScraperFn>> {
  return track === "malta" ? MALTA_SCRAPERS : GLOBAL_SCRAPERS;
}
