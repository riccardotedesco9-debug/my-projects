#!/usr/bin/env node
// publish-workbook.mjs — put the engine's curation workbook into Google Sheets, photos and all.
//
// The catalogue engine's real deliverable is assemble.py's curation workbook: an embedded thumbnail
// per row, every enriched field beside its own source cell, per-field GREEN/YELLOW/RED colouring and
// a worst-field READY/REVIEW/HOLD status. Uploading that .xlsx and letting Drive convert it keeps ALL
// of that, including the anchored photos — which is why this needs no image hosting, no public links
// and no =IMAGE() formulas (those fail: Google's image fetcher is anonymous and retailer hosts
// refuse it). Same route Riccardo's July marketplace-listings sheet used.
//
// Auth: clasp's stored login, the only credential here with a Drive scope (drive.file).
//
// Run from projects/splashstore/catalog:
// First run creates the Sheet and caches its id in .tmp/workbook-sheet-id.txt; later runs REPLACE
// that sheet's contents in place, so the link the owner already has keeps working and no duplicate
// sheets pile up in Drive. Pass --new to deliberately create a separate one.
//
//   node publish-workbook.mjs [path/to/workbook.xlsx] [--new]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getClaspAccessToken, updateSheetFromXlsx, uploadXlsxAsSheet } from "../../../tools/google-sheets-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_XLSX = path.join(HERE, "..", "docs", "splashstore-scan-curation-260816.xlsx");
const ID_FILE = path.join(HERE, "..", ".tmp", "workbook-sheet-id.txt");
const TITLE = "SplashStore — scanned stock curation";

async function main() {
  const xlsx = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_XLSX;
  if (!fs.existsSync(xlsx)) {
    throw new Error(`Workbook not found: ${xlsx}\nBuild it first with assemble.py --preview --embed --imgdir ../.tmp/normalized`);
  }
  const kb = Math.round(fs.statSync(xlsx).size / 1024);
  console.log(`Uploading ${path.basename(xlsx)} (${kb} KB) as a Google Sheet…`);

  const token = await getClaspAccessToken();
  const cached = !process.argv.includes("--new") && fs.existsSync(ID_FILE)
    ? fs.readFileSync(ID_FILE, "utf8").trim() : "";

  let file;
  if (cached) {
    file = await updateSheetFromXlsx(token, cached, xlsx);
    console.log(`Updated in place: ${file.name}`);
  } else {
    file = await uploadXlsxAsSheet(token, { filePath: xlsx, title: TITLE });
    console.log(`Created: ${file.name}`);
  }

  // Only the canonical sheet owns the cache. A --new copy is a one-off; writing its id here would
  // silently redirect every later publish and strand the link the owner already has.
  if (!process.argv.includes("--new")) fs.writeFileSync(ID_FILE, file.id, "utf8");
  console.log(file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`);
  console.log(`(id cached in ${path.relative(process.cwd(), ID_FILE)})`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
