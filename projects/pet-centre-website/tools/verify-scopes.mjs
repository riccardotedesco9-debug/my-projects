#!/usr/bin/env node
/**
 * Verify which Admin API access scopes the current custom-app token carries.
 * Mirrors seed-catalog.mjs auth (client-credentials via 1Password), then calls
 * the access_scopes endpoint and prints the granted list.
 *
 * Run: node verify-scopes.mjs
 */
import { execSync } from 'node:child_process';

const STORE = 'dsgncm-nw.myshopify.com';
const OP_ITEM = 'id74dkmgixs6byl6lqnfgpfoai';

async function getToken() {
  const raw = execSync(`op item get ${OP_ITEM} --format json`, { encoding: 'utf8' });
  const vals = [...new Set(JSON.parse(raw).fields.filter((f) => f.value && f.value.length >= 10).map((f) => f.value))];
  for (const client_id of vals) {
    for (const client_secret of vals) {
      if (client_id === client_secret) continue;
      const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id, client_secret }),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.access_token) return d.access_token;
      }
    }
  }
  throw new Error(`No working client_credentials pair found in 1Password item ${OP_ITEM}`);
}

const token = await getToken();
const r = await fetch(`https://${STORE}/admin/oauth/access_scopes.json`, {
  headers: { 'X-Shopify-Access-Token': token },
});
const { access_scopes } = await r.json();
const handles = access_scopes.map((s) => s.handle).sort();
console.log(`Token carries ${handles.length} scopes:\n`);
console.log(handles.join('\n'));
