// google-sheets-lib.mjs — shared Google Sheets plumbing (OAuth + create + write).
//
// The three billing-sheet scripts each carry their own copy of the refresh-token dance and the
// v4 fetch calls. This is that logic extracted once so a new writer does not become a fourth copy.
// Those scripts still work as-is and are deliberately left untouched; they can adopt this whenever
// one of them is next edited.
//
// Auth reuses the same Google account as the daily digest emails
// (op://AI-Stack/google-jobhunt-oauth/*), resolved through secret-lib — .env first, 1Password only
// as a fallback, so the normal path never triggers an approval prompt.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readSecretByRef } from "./secret-lib.mjs";

const OAUTH_REF = "op://AI-Stack/google-jobhunt-oauth";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

function requireRef(ref) {
  const value = readSecretByRef(ref);
  if (value === null || value === undefined || value === "") {
    throw new Error(`Secret ${ref} not found in .env and 1Password read failed.`);
  }
  return value;
}

/** Exchange the stored refresh token for a short-lived access token. */
export async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: requireRef(`${OAUTH_REF}/client-id`),
    client_secret: requireRef(`${OAUTH_REF}/client-secret`),
    refresh_token: requireRef(`${OAUTH_REF}/refresh-token`),
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

/**
 * Access token from clasp's stored credentials (~/.clasprc.json) instead of the AI-Stack OAuth pair.
 * Why both exist: the AI-Stack token carries only gmail.send + spreadsheets, so it can create and
 * write a Sheet but cannot touch Drive. clasp's login carries drive.file, which is what an
 * xlsx-to-Sheet conversion (a Drive upload) needs. Same Google account either way.
 */
export async function getClaspAccessToken() {
  const rc = path.join(os.homedir(), ".clasprc.json");
  if (!fs.existsSync(rc)) throw new Error(`clasp credentials not found at ${rc} — run \`clasp login\`.`);
  const t = (JSON.parse(fs.readFileSync(rc, "utf8")).tokens || {}).default;
  if (!t?.refresh_token) throw new Error("clasp credentials carry no refresh token — run `clasp login`.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: t.client_id,
      client_secret: t.client_secret,
      refresh_token: t.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`clasp token refresh failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

/**
 * Upload an .xlsx and let Drive convert it to a native Google Sheet, preserving ANCHORED images.
 * This is how a workbook full of embedded product thumbnails becomes a Sheet showing those photos
 * with no image hosting at all — no public links, no =IMAGE() formulas, nothing to expire.
 * Needs a Drive-scoped token (see getClaspAccessToken).
 */
export async function uploadXlsxAsSheet(token, { filePath, title, folderId }) {
  const boundary = "gsheetlib" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({
    name: title,
    mimeType: "application/vnd.google-apps.spreadsheet", // target type => Drive converts on ingest
    ...(folderId ? { parents: [folderId] } : {}),
  });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
    fs.readFileSync(filePath),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`xlsx->Sheet upload failed (${res.status}): ${await res.text()}`);
  return res.json();
}

/**
 * Replace an EXISTING Google Sheet's content from an .xlsx, keeping its file id, URL and sharing.
 * Without this, re-publishing spawns a new sheet every run and the owner accumulates duplicates
 * while any link already shared points at a stale copy.
 */
export async function updateSheetFromXlsx(token, fileId, filePath) {
  const boundary = "gsheetlib" + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
    fs.readFileSync(filePath),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,name,webViewLink`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Sheet update failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function api(token, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method || "GET"} ${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Create a spreadsheet with the given tab titles. Returns {spreadsheetId, spreadsheetUrl}. */
export async function createSpreadsheet(token, title, tabTitles = ["Sheet1"]) {
  return api(token, SHEETS_API, {
    method: "POST",
    body: JSON.stringify({
      properties: { title },
      sheets: tabTitles.map((t) => ({ properties: { title: t } })),
    }),
  });
}

/** Overwrite a range with a 2D array of values (USER_ENTERED, so formulas/links render). */
export async function writeValues(token, spreadsheetId, range, values) {
  return api(token, `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
}

/** Apply raw batchUpdate requests (formatting, column widths, freezing, conditional formats). */
export async function batchUpdate(token, spreadsheetId, requests) {
  if (!requests.length) return null;
  return api(token, `${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

/**
 * Tab info by title -> {sheetId, hasBanding}. batchUpdate addresses tabs by numeric id, not name.
 * `hasBanding` matters for idempotency: addBanding hard-errors on a range that is already banded, so
 * a re-run of an otherwise repeatable push would fail purely because it succeeded the first time.
 */
export async function getTabInfo(token, spreadsheetId, tabTitle) {
  const meta = await api(token, `${SHEETS_API}/${spreadsheetId}?fields=sheets(properties,bandedRanges)`);
  const found = (meta.sheets || []).find((s) => s.properties?.title === tabTitle);
  if (!found) throw new Error(`Tab "${tabTitle}" not found in ${spreadsheetId}`);
  return { sheetId: found.properties.sheetId, hasBanding: (found.bandedRanges || []).length > 0 };
}

/** Back-compat shorthand when only the numeric id is needed. */
export async function getSheetId(token, spreadsheetId, tabTitle) {
  return (await getTabInfo(token, spreadsheetId, tabTitle)).sheetId;
}

/** Find a Drive folder by name, or create it. Returns the folder id. */
export async function ensureFolder(token, name, parentId = null) {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    ...(parentId ? [`'${parentId}' in parents`] : []),
  ].join(" and ");
  const found = await api(token, `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name)`);
  if (found.files?.length) return found.files[0].id;
  const made = await api(token, `${DRIVE_API}?fields=id`, {
    method: "POST",
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  return made.id;
}

/** Existing files in a folder as {name: id} — lets an upload skip what is already there. */
export async function listFolder(token, folderId) {
  const q = `'${folderId}' in parents and trashed = false`;
  const res = await api(token, `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1000`);
  return Object.fromEntries((res.files || []).map((f) => [f.name, f.id]));
}

/**
 * Upload bytes to Drive via multipart, returning the new file id.
 * `anyoneRead` publishes the file to anyone-with-the-link. That is REQUIRED for a Sheets =IMAGE()
 * to render: Google's image fetcher is anonymous, so a private Drive file renders as an error. Only
 * pass it for assets that are safe to expose by unguessable link (e.g. product photos).
 */
export async function uploadFile(token, { name, mimeType, bytes, folderId, anyoneRead = false }) {
  const boundary = "gsheetlib" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name, ...(folderId ? { parents: [folderId] } : {}) });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload of ${name} failed (${res.status}): ${await res.text()}`);
  const { id } = await res.json();
  if (anyoneRead) {
    await api(token, `${DRIVE_API}/${id}/permissions`, {
      method: "POST",
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
  }
  return id;
}

/** The URL form of a Drive image that Sheets =IMAGE() actually renders. */
export const driveImageUrl = (fileId, width = 400) =>
  `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`;

/**
 * Move a file into a Drive folder. Optional: without it the sheet lands in My Drive root, which is
 * fine — this exists so a project can file its deliverable alongside the rest of its assets.
 */
export async function moveToFolder(token, fileId, folderId) {
  const meta = await api(token, `${DRIVE_API}/${fileId}?fields=parents`);
  const previous = (meta.parents || []).join(",");
  return api(
    token,
    `${DRIVE_API}/${fileId}?addParents=${folderId}${previous ? `&removeParents=${previous}` : ""}&fields=id,parents`,
    { method: "PATCH" },
  );
}
