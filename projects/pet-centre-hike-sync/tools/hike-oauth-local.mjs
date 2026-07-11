/**
 * Local Hike OAuth helper — Phase-0 API smoke test.
 *
 * Stands up http://localhost:8080/ so it can act as the Redirect URI registered on a
 * Hike developer app. Flow entirely in your browser, no terminal needed:
 *   1. Save your Hike app (Redirect URI = http://localhost:8080/) and copy its
 *      App Id + App Secret from developer.hikeup.com.
 *   2. Open http://localhost:8080/, paste them, click "Connect Hike".
 *   3. Approve on Hike. Hike redirects back here with a ?code; this server exchanges it
 *      for tokens and fetches one product to PROVE the API works (and that the store's
 *      plan includes API access — a gated plan returns 401/403 here).
 *
 * Nothing is written to disk. Credentials/tokens live in memory for this run only.
 * Stop it with Ctrl-C (or kill the background task).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const PORT = 8080;
const BASE = 'https://api.hikeup.com';
const REDIRECT_URI = process.env.HIKE_REDIRECT_URI || 'http://localhost:8080/';

// Resolve the gitignored workspace-root .env (the workspace's primary secrets store):
// walk up from this script until a dir holds both CLAUDE.md and .gitignore.
const ENV_PATH = process.env.HIKE_ENV_PATH || (function () {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'CLAUDE.md')) && fs.existsSync(path.join(dir, '.gitignore'))) break;
    dir = path.dirname(dir);
  }
  return path.join(dir, '.env');
})();

/**
 * Upsert HIKE_* keys into the workspace .env, preserving all other lines.
 * These are LOCAL DEV tokens only — the Apps Script tool does its own OAuth and does
 * not read them. Returns the list of key names written (never logs values).
 */
function saveToEnv(vars) {
  const keys = Object.keys(vars);
  let lines = [];
  if (fs.existsSync(ENV_PATH)) {
    lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  }
  const marker = '# --- Hike API (local dev tokens; added by hike-oauth-local.mjs; NOT used by the Apps Script) ---';
  const drop = new Set(keys);
  lines = lines.filter((l) => l !== marker && !keys.some((k) => l.startsWith(k + '=')));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push(marker);
  keys.forEach((k) => lines.push(k + '=' + String(vars[k] == null ? '' : vars[k])));
  lines.push('');
  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
  return keys;
}

// In-memory only. Seeded from env if present, else entered via the browser form.
const state = {
  clientId: process.env.HIKE_CLIENT_ID || '',
  clientSecret: process.env.HIKE_CLIENT_SECRET || '',
  oauthState: ''
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,Arial;max-width:680px;margin:40px auto;padding:0 16px;color:#1a2b3c}
h1{color:#12a5a5}code,pre{background:#f3f5f7;padding:2px 6px;border-radius:4px}
pre{padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-all}
input{width:100%;padding:8px;margin:4px 0 12px;box-sizing:border-box;border:1px solid #ccc;border-radius:6px}
button,.btn{display:inline-block;background:#12a5a5;color:#fff;border:0;padding:10px 18px;border-radius:6px;font-size:15px;text-decoration:none;cursor:pointer}
.ok{color:#137333}.err{color:#c5221f}.muted{color:#777}</style></head><body>${body}</body></html>`;
}

function homePage(msg) {
  const ready = state.clientId && state.clientSecret;
  return page('Hike OAuth helper', `
<h1>Hike OAuth helper</h1>
<p class="muted">Running at <code>${esc(REDIRECT_URI)}</code> — use this exact value as the Redirect URI on your Hike app.</p>
${msg || ''}
<form method="POST" action="/set-creds">
  <label>App Id (client_id)</label>
  <input name="clientId" value="${esc(state.clientId)}" placeholder="from developer.hikeup.com → your app">
  <label>App Secret (client_secret)</label>
  <input name="clientSecret" value="${esc(state.clientSecret)}" placeholder="App Secret">
  <button type="submit">Save credentials</button>
</form>
<p>${ready
    ? '<a class="btn" href="/connect">Connect Hike →</a> <span class="muted">(log into your Hike store first, then approve)</span>'
    : '<span class="muted">Enter the App Id &amp; Secret above, then a "Connect Hike" button appears.</span>'}</p>
<hr><p class="muted">Reminder: Hike API access requires the <b>Plus</b> plan or higher. If your store is on Essential you'll see an auth error after approving — that tells us Lane A (auto-sync) needs a plan upgrade, while the manual export lane works on any plan.</p>`);
}

async function exchangeAndTest(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: state.clientId,
    client_secret: state.clientSecret,
    code,
    redirect_uri: REDIRECT_URI
  });
  const tokRes = await fetch(BASE + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  });
  const tokText = await tokRes.text();
  if (!tokRes.ok) throw new Error(`Token exchange failed (HTTP ${tokRes.status}): ${tokText.slice(0, 400)}`);
  let tok;
  try { tok = JSON.parse(tokText); } catch { throw new Error('Token response was not JSON: ' + tokText.slice(0, 300)); }

  // Persist the durable, reusable credentials to the gitignored workspace .env.
  let savedKeys = [];
  try {
    savedKeys = saveToEnv({
      HIKE_CLIENT_ID: state.clientId,
      HIKE_CLIENT_SECRET: state.clientSecret,
      HIKE_REFRESH_TOKEN: tok.refresh_token || '',
      HIKE_ACCESS_TOKEN: tok.access_token || '',
      HIKE_TOKEN_OBTAINED_AT: new Date().toISOString(),
      HIKE_REDIRECT_URI: REDIRECT_URI
    });
    console.log('[hike-oauth] saved ' + savedKeys.length + ' HIKE_* keys to ' + ENV_PATH + ' (values not logged)');
  } catch (e) {
    console.error('[hike-oauth] could not write .env: ' + e.message);
  }

  // Prove the API works: fetch one product.
  let smoke = '';
  try {
    const pRes = await fetch(BASE + '/api/v1/products/get_all?page_size=1&Skip_count=0', {
      headers: { Authorization: 'Bearer ' + tok.access_token, Accept: 'application/json' }
    });
    const pText = await pRes.text();
    if (pRes.ok) {
      let count = '?'; let sample = '';
      try { const j = JSON.parse(pText); count = j.totalCount != null ? j.totalCount : (j.items ? j.items.length : '?'); sample = j.items && j.items[0] ? (j.items[0].name || '(unnamed)') : ''; } catch {}
      smoke = `<p class="ok">✅ Product API works. Total products in store: <b>${esc(count)}</b>${sample ? ` (first: “${esc(sample)}”)` : ''}.</p>`;
    } else {
      smoke = `<p class="err">⚠️ Token OK, but products call returned HTTP ${pRes.status} — likely the store's plan does not include API access (needs Hike Plus+), or a permissions/scope issue.</p><pre>${esc(pText.slice(0, 400))}</pre>`;
    }
  } catch (e) {
    smoke = `<p class="err">Products call error: ${esc(e.message)}</p>`;
  }

  return page('Hike connected', `
<h1 class="ok">Hike connected ✅</h1>
${smoke}
<p>Your store's API is reachable. This proves Phase-0: credentials + plan + endpoints all work.</p>
<h3>Saved to <code>.env</code> 💾</h3>
<p class="ok">${savedKeys.length ? 'Wrote ' + esc(savedKeys.join(', ')) + ' to the workspace .env (git-ignored).' : '(nothing saved — check the server log)'}</p>
<pre>${esc(ENV_PATH)}</pre>
<p class="muted">These are LOCAL DEV tokens for testing the API + field mapping. The final Apps Script tool does its own OAuth inside the sheet and does not read them. You never had to paste them to anyone. Close this tab and tell Claude "saved".</p>
<p><a class="btn" href="/">← back</a></p>`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  try {
    if (req.method === 'POST' && url.pathname === '/set-creds') {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on('end', () => {
        const f = new URLSearchParams(raw);
        state.clientId = (f.get('clientId') || '').trim();
        state.clientSecret = (f.get('clientSecret') || '').trim();
        console.log('[hike-oauth] credentials set for client_id ' + (state.clientId.slice(0, 6) || '(empty)') + '…');
        res.writeHead(302, { Location: '/' }); res.end();
      });
      return;
    }

    if (url.pathname === '/connect') {
      if (!state.clientId || !state.clientSecret) { res.writeHead(302, { Location: '/' }); res.end(); return; }
      state.oauthState = randomUUID();
      const auth = BASE + '/oauth/authorize?' + new URLSearchParams({
        response_type: 'code', client_id: state.clientId, redirect_uri: REDIRECT_URI, scope: 'all', state: state.oauthState
      }).toString();
      res.writeHead(302, { Location: auth }); res.end();
      return;
    }

    // Redirect target: Hike sends ?code (success) or ?error (denied) back here.
    const code = url.searchParams.get('code');
    const err = url.searchParams.get('error');
    if (err) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(homePage(`<p class="err">Hike returned "${esc(err)}" — connection not approved. Try "Connect Hike" again.</p>`));
      return;
    }
    if (code) {
      const returned = url.searchParams.get('state');
      if (state.oauthState && returned !== state.oauthState) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(homePage('<p class="err">State mismatch — ignored for safety. Start again from "Connect Hike".</p>'));
        return;
      }
      console.log('[hike-oauth] received authorization code, exchanging for tokens…');
      try {
        const html = await exchangeAndTest(code);
        res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html);
        console.log('[hike-oauth] token exchange + product smoke test complete.');
      } catch (e) {
        console.error('[hike-oauth] ' + e.message);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('Hike error', `<h1 class="err">Connection failed</h1><pre>${esc(e.message)}</pre><p><a class="btn" href="/">← back</a></p>`));
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(homePage());
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Error: ' + e.message);
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`[hike-oauth] port ${PORT} is already in use — stop the other process or free the port.`);
  else console.error('[hike-oauth] server error: ' + e.message);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[hike-oauth] listening on ${REDIRECT_URI}  (Redirect URI for your Hike app)`);
});
