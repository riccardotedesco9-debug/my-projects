/**
 * Live Hike API probe (READ-ONLY) — Phase-0 reality check.
 *
 * Reads HIKE_* from the workspace .env (written by hike-oauth-local.mjs), pulls a few
 * real products, and:
 *   1. dumps the actual JSON shape of the first product (real field names),
 *   2. reports the checks our field-map depends on (primary_image URL vs identifier,
 *      real outlet field names, variants, the bran_name/brand_name spelling),
 *   3. runs src/hike-field-map.js against the real products using the store's real
 *      outlet name, and prints the mapped row + any mapper warnings.
 *
 * Never writes to Hike; only GET + (if needed) a token refresh. Run:  node tools/hike-api-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HikeFieldMap = require('../src/hike-field-map.js');

const BASE = 'https://api.hikeup.com';
const dir = path.dirname(fileURLToPath(import.meta.url));

function findEnv() {
  let d = dir;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'CLAUDE.md')) && fs.existsSync(path.join(d, '.gitignore'))) break;
    d = path.dirname(d);
  }
  return path.join(d, '.env');
}

function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

async function getJson(url, token) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
  return { status: r.status, ok: r.ok, text: await r.text() };
}

async function refresh(env) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: env.HIKE_REFRESH_TOKEN || '',
    client_id: env.HIKE_CLIENT_ID || '', client_secret: env.HIKE_CLIENT_SECRET || ''
  });
  const r = await fetch(BASE + '/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body
  });
  if (!r.ok) throw new Error('Token refresh failed: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return JSON.parse(await r.text()).access_token;
}

// The non-outlet headers of the real DATA SHEET (from test1); outlet-prefixed headers
// are appended using the store's ACTUAL outlet name discovered from the API.
const BASE_HEADERS = ['Name', 'Description', 'SKU', 'Barcode', 'Product type', 'Product tag', 'Brand name',
  'Season name', 'Supplier code', 'Supplier name', 'Loyalty', 'Visible eCommerce', 'Track inventory',
  'Allow out of stock', 'Is variant product', 'Image URL', 'Active'];
const OUTLET_SUFFIXES = ['Tax', 'Cost price', 'Retail price', 'Stock', 'Stock on hand', 'Reorder level',
  'Reorder value', 'Price Excluding Tax', 'Outlet visibility'];

(async () => {
  const env = parseEnv(findEnv());
  if (!env.HIKE_ACCESS_TOKEN && !env.HIKE_REFRESH_TOKEN) {
    console.error('No HIKE_ tokens in .env yet — connect once at http://localhost:8080/ first.');
    process.exit(1);
  }

  let token = env.HIKE_ACCESS_TOKEN;
  let res = token ? await getJson(BASE + '/api/v1/products/get_all?page_size=3&Skip_count=0', token) : { status: 401 };
  if (res.status === 401 || res.status === 403) {
    console.log('Access token missing/expired — refreshing…');
    token = await refresh(env);
    res = await getJson(BASE + '/api/v1/products/get_all?page_size=3&Skip_count=0', token);
  }
  if (!res.ok) { console.error('products/get_all → HTTP ' + res.status + ': ' + res.text.slice(0, 400)); process.exit(1); }

  const data = JSON.parse(res.text);
  const items = data.items || [];
  console.log('=== products/get_all ===');
  console.log('totalCount:', data.totalCount, '| items this page:', items.length, '| has next:', !!data.next);
  if (!items.length) {
    console.log('\nStore has no products yet. Add 2-3 dummy products in Hike, then re-run this probe.');
    return;
  }

  const p = items[0];
  console.log('\n=== FIRST PRODUCT (raw JSON) ===');
  console.log(JSON.stringify(p, null, 2).slice(0, 4000));

  console.log('\n=== FIELD-MAP CHECKS ===');
  console.log('name:', JSON.stringify(p.name));
  console.log('brand field present: bran_name=', JSON.stringify(p.bran_name), '| brand_name=', JSON.stringify(p.brand_name));
  console.log('primary_image:', JSON.stringify(p.primary_image),
    '→', /^https?:\/\//i.test(String(p.primary_image || '')) ? 'looks like a URL ✅' : 'NOT a URL (identifier?) — image-url guard will skip it');
  const outlets = p.product_outlets || [];
  console.log('product_outlets count:', outlets.length);
  if (outlets[0]) { console.log('outlet[0].outlet_name:', JSON.stringify(outlets[0].outlet_name)); console.log('outlet[0] keys:', Object.keys(outlets[0]).join(', ')); }
  console.log('has_variants:', p.has_variants, '| product_variants:', (p.product_variants || []).length);

  // Run the real mapper using the store's actual outlet name.
  const outletName = (outlets[0] && outlets[0].outlet_name) || 'Pet Centre';
  const headers = BASE_HEADERS.concat(OUTLET_SUFFIXES.map((s) => outletName + '_' + s));
  const mapped = HikeFieldMap.productsToIncoming(items, headers);
  console.log('\n=== MAPPER OUTPUT (first product, non-empty cells) ===');
  console.log('outlet prefix in use:', JSON.stringify(outletName)); // (detectOutletPrefix is module-internal now)
  const row = mapped.rows[0] || [];
  headers.forEach((h, i) => { if (row[i] !== null && row[i] !== undefined && String(row[i]) !== '') console.log('  ' + h + ' = ' + JSON.stringify(row[i])); });
  if (mapped.warnings.length) console.log('mapper warnings:', mapped.warnings.join(' | '));
})().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
