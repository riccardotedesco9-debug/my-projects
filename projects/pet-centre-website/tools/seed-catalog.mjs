#!/usr/bin/env node
/**
 * Seed the Pet Centre Shopify store with a starter catalog.
 *
 * Auth: fetches a fresh Admin API token via the client-credentials grant,
 * reading the custom app's Client ID + Secret from a 1Password item (op CLI).
 * The token is short-lived (~24h) so it is re-fetched on every run — this is
 * the permanent, repeatable way to talk to the Admin API headlessly.
 *
 * Run:  node seed-catalog.mjs
 * Needs: 1Password CLI available + unlocked (desktop integration), and the
 * custom app scoped with write_products + write_publications.
 */
import { execSync } from 'node:child_process';
import { hydrateProcessEnv } from '../../../tools/secret-lib.mjs';
hydrateProcessEnv(); // load the workspace .env — the source of record — before any lookup

const STORE = 'dsgncm-nw.myshopify.com';
const API = '2026-04';
// 1Password "Shopify ID & Secret" — holds the custom app's client_id + client_secret.
const OP_ITEM = 'id74dkmgixs6byl6lqnfgpfoai';
let TOKEN = '';

/** Exchange the app's client credentials (pulled from 1Password) for an Admin token. */
async function getToken() {
  // .env is the source of record; only fall back to 1Password (which prompts) when it lacks them.
  const envPair = [process.env.SHOPIFY_CLIENT_ID, process.env.SHOPIFY_CLIENT_SECRET].filter(Boolean);
  const vals = envPair.length === 2 ? envPair : (() => {
    const raw = execSync(`op item get ${OP_ITEM} --format json`, { encoding: 'utf8' });
    return [...new Set(JSON.parse(raw).fields.filter((f) => f.value && f.value.length >= 10).map((f) => f.value))];
  })();
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

async function gql(query, variables) {
  const r = await fetch(`https://${STORE}/admin/api/${API}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors));
  return j.data;
}

// Starter catalog — Maltese pet-shop staples across the 6 animal categories.
// Tagged "starter-catalog" so they're trivial to find / bulk-edit / delete later.
const CATALOG = [
  { title: 'Premium Complete Dry Dog Food 3kg', type: 'Dog Food', price: '18.99', tag: 'dogs', desc: 'Balanced everyday nutrition for adult dogs.' },
  { title: 'Grain-Free Salmon Dog Food 2kg', type: 'Dog Food', price: '24.99', tag: 'dogs', desc: 'Grain-free salmon recipe for sensitive tummies.' },
  { title: 'Durable Rubber Dog Chew Toy', type: 'Dog Toys', price: '7.50', tag: 'dogs', desc: 'Tough natural-rubber chew for strong jaws.' },
  { title: 'Indoor Adult Cat Food 2kg', type: 'Cat Food', price: '16.99', tag: 'cats', desc: 'Complete dry food for indoor adult cats.' },
  { title: 'Clumping Cat Litter 10L', type: 'Cat Litter', price: '9.99', tag: 'cats', desc: 'Fast-clumping, low-dust litter with odour control.' },
  { title: 'Catnip Feather Wand Toy', type: 'Cat Toys', price: '5.99', tag: 'cats', desc: 'Interactive feather wand with natural catnip.' },
  { title: 'Budgie & Canary Seed Mix 1kg', type: 'Bird Food', price: '6.99', tag: 'birds', desc: 'Vitamin-enriched seed blend for small birds.' },
  { title: 'Millet Spray Bird Treat (3 pack)', type: 'Bird Treats', price: '3.50', tag: 'birds', desc: 'Natural millet sprays birds love to forage.' },
  { title: 'Tropical Flake Fish Food 100g', type: 'Fish Food', price: '8.99', tag: 'fish', desc: 'Daily flake food for tropical community fish.' },
  { title: 'Aquarium Water Conditioner 250ml', type: 'Aquarium Care', price: '7.99', tag: 'fish', desc: 'Removes chlorine and makes tap water fish-safe.' },
  { title: 'Timothy Hay for Rabbits & Guinea Pigs 1kg', type: 'Small Animal Food', price: '7.49', tag: 'small-animals', desc: 'High-fibre timothy hay for healthy digestion.' },
  { title: 'Small Animal Soft Bedding 10L', type: 'Small Animal Bedding', price: '8.99', tag: 'small-animals', desc: 'Absorbent, dust-extracted paper bedding.' },
  { title: 'Reptile Calcium + D3 Supplement 100g', type: 'Reptile Care', price: '9.99', tag: 'reptiles', desc: 'Dusting powder for strong reptile bones.' },
  { title: 'Reptile Heat Lamp Bulb 50W', type: 'Reptile Care', price: '12.99', tag: 'reptiles', desc: 'Basking spot bulb for vivarium warmth.' },
  { title: 'Stainless Steel Pet Food Bowl', type: 'Accessories', price: '6.50', tag: 'accessories', desc: 'Non-slip, dishwasher-safe stainless bowl.' },
];

const Q_CREATE = `mutation($p:ProductCreateInput!){productCreate(product:$p){product{id title variants(first:1){nodes{id}}} userErrors{field message}}}`;
const Q_PRICE = `mutation($id:ID!,$v:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$id,variants:$v){userErrors{field message}}}`;
const Q_PUBLISH = `mutation($id:ID!,$in:[PublicationInput!]!){publishablePublish(id:$id,input:$in){userErrors{field message}}}`;
async function main() {
  TOKEN = await getToken();
  console.log('Admin token acquired via client_credentials.');

  const pubs = (await gql(`{publications(first:20){nodes{id name}}}`)).publications.nodes;
  const pubInput = pubs.map((p) => ({ publicationId: p.id }));
  console.log('Sales channels:', pubs.map((p) => p.name).join(', ') || '(none)');

  // Map products already tagged starter-catalog so re-runs are idempotent
  // (price/publish the existing one instead of creating duplicates).
  const existing = {};
  const q = await gql(`{products(first:100,query:"tag:starter-catalog"){nodes{id title variants(first:1){nodes{id}}}}}`);
  q.products.nodes.forEach((n) => { existing[n.title] = { id: n.id, vid: n.variants.nodes[0]?.id }; });

  let done = 0;
  for (const p of CATALOG) {
    let prodId;
    let vid;
    let action;
    if (existing[p.title]) {
      prodId = existing[p.title].id;
      vid = existing[p.title].vid;
      action = '=';
    } else {
      const res = await gql(Q_CREATE, {
        p: { title: p.title, vendor: 'Pet Centre', productType: p.type, status: 'ACTIVE', tags: ['starter-catalog', p.tag], descriptionHtml: `<p>${p.desc}</p>` },
      });
      if (!res.productCreate.product) {
        console.log('  x ' + p.title + ' — ' + JSON.stringify(res.productCreate.userErrors));
        continue;
      }
      prodId = res.productCreate.product.id;
      vid = res.productCreate.product.variants.nodes[0].id;
      action = '+';
    }
    if (vid) await gql(Q_PRICE, { id: prodId, v: [{ id: vid, price: p.price }] });
    if (pubInput.length) await gql(Q_PUBLISH, { id: prodId, in: pubInput });
    done++;
    console.log(`  ${action} ${p.title} - EUR ${p.price}`);
  }
  console.log(`\nDone: ${done}/${CATALOG.length} products live (created or updated), priced & published.`);
}
main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
