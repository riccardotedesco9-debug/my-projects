#!/usr/bin/env node
// mint-token.mjs — one-shot OAuth2 consent flow to mint a refresh token scoped
// for gmail.send + spreadsheets. Runs a loopback HTTP server on localhost to
// catch the redirect, exchanges the auth code, prints the refresh token.
//
// Prerequisites:
//   1. GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET already in meetsync/.env
//      — copy them into job-hunt/.env (or symlink). They're reused.
//   2. The OAuth client in Google Cloud Console must have
//      http://localhost:53682/callback listed as an authorized redirect URI.
//      → Go to console.cloud.google.com/apis/credentials → edit the client
//        used by meetsync → add redirect URI → save.
//
// Usage:
//   node --env-file=.env tools/mint-token.mjs
//
// The script:
//   - opens the default browser to Google's consent screen
//   - waits for the callback on localhost:53682
//   - swaps the code for tokens
//   - prints the refresh token (add to .env as Google_Refresh_Token)

import http from "node:http";
import { URL } from "node:url";
import { exec } from "node:child_process";

const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/spreadsheets",
];

const clientId = process.env.OAuth_Client_ID_Desktop;
const clientSecret = process.env.OAuth_Client_Secret_Desktop;
if (!clientId || !clientSecret) {
  console.error("✗ OAuth_Client_ID_Desktop and OAuth_Client_Secret_Desktop must be set in .env");
  console.error("  Create a Desktop-type OAuth client at console.cloud.google.com/apis/credentials");
  process.exit(1);
}

const consentUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
consentUrl.searchParams.set("client_id", clientId);
consentUrl.searchParams.set("redirect_uri", REDIRECT_URI);
consentUrl.searchParams.set("response_type", "code");
consentUrl.searchParams.set("scope", SCOPES.join(" "));
consentUrl.searchParams.set("access_type", "offline");
consentUrl.searchParams.set("prompt", "consent"); // force refresh_token return

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/callback")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(`OAuth failed: ${error ?? "no code"}`);
    console.error(`✗ OAuth callback failed: ${error ?? "no code"}`);
    server.close();
    process.exit(2);
  }

  // Exchange code for tokens
  try {
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResp.ok) {
      throw new Error(`Token exchange failed (${tokenResp.status}): ${await tokenResp.text()}`);
    }
    const tokens = await tokenResp.json();
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>✓ Token minted. Check your terminal.</h2>");

    console.log("");
    console.log("✓ Refresh token minted");
    console.log("");
    console.log("Add these to your .env:");
    console.log(`  Google_Refresh_Token=${tokens.refresh_token}`);
    console.log("");
    console.log("And add to the Trigger.dev dashboard (cloud.trigger.dev → project → Environment Variables):");
    console.log(`  Google_Refresh_Token   (above)`);
    console.log(`  — GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET already set by meetsync`);
    console.log("");
    server.close();
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(`Exchange failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error("✗", err);
    server.close();
    process.exit(3);
  }
});

server.listen(REDIRECT_PORT, () => {
  console.log(`→ Listening on ${REDIRECT_URI}`);
  console.log(`→ Opening consent URL in browser...`);
  console.log(`  (if it doesn't open, paste this into your browser:)`);
  console.log(`  ${consentUrl.toString()}`);
  console.log("");
  openBrowser(consentUrl.toString());
});

function openBrowser(url) {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` :
    process.platform === "darwin" ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd);
}
