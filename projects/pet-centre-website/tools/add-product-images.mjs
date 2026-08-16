#!/usr/bin/env node
/**
 * Attach the AI-generated product images to the Pet Centre catalog via the Admin
 * API (productCreateMedia — Shopify fetches + hosts each source URL). Idempotent:
 * skips any product that already has a media image. Token via client_credentials
 * (same 1Password pattern as seed-catalog.mjs).
 *
 * Run: node add-product-images.mjs
 */
import {execSync} from 'node:child_process';
import { hydrateProcessEnv } from '../../../tools/secret-lib.mjs';
hydrateProcessEnv(); // load the workspace .env — the source of record — before any lookup

const STORE = 'dsgncm-nw.myshopify.com';
const API = '2026-04';
const OP_ITEM = 'id74dkmgixs6byl6lqnfgpfoai'; // 1P "Shopify ID & Secret"
let TOKEN = '';

// product title -> generated image URL (fal CDN; Shopify copies it to its own CDN)
const IMAGES = {
  'Premium Complete Dry Dog Food 3kg':
    'https://v3b.fal.media/files/b/0a9cfa34/yx7L7x5svlTqWVxAQxKPM.jpg',
  'Grain-Free Salmon Dog Food 2kg':
    'https://v3b.fal.media/files/b/0a9cfa42/ks3_2neIVSqLYnC3udUV1.jpg',
  'Durable Rubber Dog Chew Toy':
    'https://v3b.fal.media/files/b/0a9cfa47/7b6gEW4MJq4H-4Zq3uxj8.jpg',
  'Indoor Adult Cat Food 2kg':
    'https://v3b.fal.media/files/b/0a9cfa48/73p3e7okFSoYAmAw2hVF8.jpg',
  'Clumping Cat Litter 10L':
    'https://v3b.fal.media/files/b/0a9cfa48/V9n0hxlR2gmyGxr9AuOSZ.jpg',
  'Catnip Feather Wand Toy':
    'https://v3b.fal.media/files/b/0a9cfa45/1ulF0fWKYl4ehgOthbXDq.jpg',
  'Budgie & Canary Seed Mix 1kg':
    'https://v3b.fal.media/files/b/0a9cfa4a/h10SnEhIzJAfpoaLiPHW9.jpg',
  'Millet Spray Bird Treat (3 pack)':
    'https://v3b.fal.media/files/b/0a9cfa46/dNPW7ZNrhsMyL05VEWYHi.jpg',
  'Tropical Flake Fish Food 100g':
    'https://v3b.fal.media/files/b/0a9cfa49/6ZNahEuEk6axztIAxPjQ7.jpg',
  'Aquarium Water Conditioner 250ml':
    'https://v3b.fal.media/files/b/0a9cfa49/vtPjhKNwenDbINlnc-XPW.jpg',
  'Timothy Hay for Rabbits & Guinea Pigs 1kg':
    'https://v3b.fal.media/files/b/0a9cfa4e/wetZJPg0K6wMv_PjLDOjO.jpg',
  'Small Animal Soft Bedding 10L':
    'https://v3b.fal.media/files/b/0a9cfa4b/OWeDYdj-1gIQb1ENTqNN_.jpg',
  'Reptile Calcium + D3 Supplement 100g':
    'https://v3b.fal.media/files/b/0a9cfa4b/iagaBe19o772IoRKRRfv3.jpg',
  'Reptile Heat Lamp Bulb 50W':
    'https://v3b.fal.media/files/b/0a9cfa50/PfDa27nR67xls0_Q9Eufh.jpg',
  'Stainless Steel Pet Food Bowl':
    'https://v3b.fal.media/files/b/0a9cfa50/dWwifVto0wcBmZ8g6Y7_z.jpg',
};

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
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({grant_type: 'client_credentials', client_id, client_secret}),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.access_token) return d.access_token;
      }
    }
  }
  throw new Error('No working client_credentials pair in 1Password item ' + OP_ITEM);
}

async function gql(query, variables) {
  const r = await fetch(`https://${STORE}/admin/api/${API}/graphql.json`, {
    method: 'POST',
    headers: {'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json'},
    body: JSON.stringify({query, variables}),
  });
  const j = await r.json();
  if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors));
  return j.data;
}

const Q_LIST = `{products(first:100,query:"tag:starter-catalog"){nodes{id title media(first:1){nodes{id}}}}}`;
const Q_MEDIA = `mutation($id:ID!,$media:[CreateMediaInput!]!){productCreateMedia(productId:$id,media:$media){media{... on MediaImage{id status}} mediaUserErrors{field message}}}`;

async function main() {
  TOKEN = await getToken();
  const products = (await gql(Q_LIST)).products.nodes;
  let added = 0;
  let skipped = 0;
  for (const p of products) {
    const url = IMAGES[p.title];
    if (!url) {
      console.log('  ? no image mapped for:', p.title);
      continue;
    }
    if (p.media.nodes.length > 0) {
      skipped++;
      console.log('  = already has image:', p.title);
      continue;
    }
    const res = await gql(Q_MEDIA, {
      id: p.id,
      media: [{originalSource: url, mediaContentType: 'IMAGE', alt: p.title}],
    });
    const errs = res.productCreateMedia.mediaUserErrors;
    if (errs && errs.length) {
      console.log('  x ' + p.title + ' — ' + JSON.stringify(errs));
      continue;
    }
    added++;
    console.log('  + image attached:', p.title);
  }
  console.log(`\nDone: ${added} images attached, ${skipped} already had one.`);
}
main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
