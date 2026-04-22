// scrapers/index.ts — per-track scraper registries.
// Malta registry → fed into `job-hunt-daily-scan` (07:00 Europe/Malta).
// Global registry → fed into `job-hunt-global-scan` (07:05 Europe/Malta).
// Shared: all scrapers below use the same `searchJobs` helper + pipeline.

import { scrapeLinkedIn } from "./linkedin.js";
import { scrapeJobsplus } from "./jobsplus.js";
import { scrapeIndeedMt } from "./indeed-mt.js";
import { scrapeKeepmeposted } from "./keepmeposted.js";
import { scrapeCareerjet } from "./careerjet.js";
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
  jobsplus: scrapeJobsplus,
  "indeed-mt": scrapeIndeedMt,
  keepmeposted: scrapeKeepmeposted,
  careerjet: scrapeCareerjet,
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

// Backward-compat export for any remaining imports
export const SCRAPERS = MALTA_SCRAPERS;
