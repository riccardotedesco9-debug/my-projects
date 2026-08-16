#!/usr/bin/env node
/**
 * Create 6 Shopify smart collections (one per animal category) so /collections/<handle>
 * become real, live category pages — auto-filled by product tag, each with a hero image
 * + description, published to all channels. Idempotent: skips collections that exist.
 * Token via client_credentials (1Password), same pattern as seed-catalog.mjs.
 */
import {execSync} from 'node:child_process';
import { hydrateProcessEnv } from '../../../tools/secret-lib.mjs';
hydrateProcessEnv(); // load the workspace .env — the source of record — before any lookup

const STORE = 'dsgncm-nw.myshopify.com';
const API = '2026-04';
const OP_ITEM = 'id74dkmgixs6byl6lqnfgpfoai';
let TOKEN = '';

const COLLECTIONS = [
  {title: 'Dogs', tag: 'dogs', img: 'https://v3b.fal.media/files/b/0a9cfa68/kwWHeXY_wD5Mt79iNCHAt_vAOQswNm.png',
    desc: 'Everything for your dog — premium food, treats, toys and care essentials, with friendly advice and grooming on hand at the shop.'},
  {title: 'Cats', tag: 'cats', img: 'https://v3b.fal.media/files/b/0a9cfa6b/AM1o7-D5B8V2kMAsgfRAN_btw1EQIW.png',
    desc: 'Food, litter, toys and comfort for every cat — quality brands chosen for indoor and outdoor companions alike.'},
  {title: 'Fish & Aquatics', tag: 'fish', img: 'https://v3b.fal.media/files/b/0a9cfa6c/EMriVcDCdVV2ZqKEJ6w0l_85M8dQ0G.png',
    desc: 'Keep your aquarium thriving — tropical foods, water conditioners and care essentials for healthy, vibrant fish.'},
  {title: 'Birds', tag: 'birds', img: 'https://v3b.fal.media/files/b/0a9cfa70/up9EpQTdKVW0AXvPbiOcN_nHlpxpdT.png',
    desc: 'Seed mixes, treats and accessories for budgies, canaries and feathered friends of every kind.'},
  {title: 'Reptiles', tag: 'reptiles', img: 'https://v3b.fal.media/files/b/0a9cfa73/__cCLbeKVZpsMaUiJSI2Z_B5x2sZiG.png',
    desc: 'Heating, supplements and habitat care to keep your reptiles healthy, warm and happy.'},
  {title: 'Small Animals', tag: 'small-animals', img: 'https://v3b.fal.media/files/b/0a9cfa79/Z65WszLfaQVZvLEgkPrCv_n74PKznE.png',
    desc: 'Hay, bedding and food for rabbits, guinea pigs, hamsters and all the little ones.'},
];

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
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({grant_type: 'client_credentials', client_id, client_secret}),
      });
      if (r.ok) {const d = await r.json(); if (d.access_token) return d.access_token;}
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

const Q_EXISTING = `{collections(first:100){nodes{handle title}}}`;
const Q_CREATE = `mutation($input:CollectionInput!){collectionCreate(input:$input){collection{id handle title} userErrors{field message}}}`;
const Q_PUBS = `{publications(first:20){nodes{id name}}}`;
const Q_PUBLISH = `mutation($id:ID!,$input:[PublicationInput!]!){publishablePublish(id:$id,input:$input){userErrors{field message}}}`;

async function main() {
  TOKEN = await getToken();
  const existing = new Set((await gql(Q_EXISTING)).collections.nodes.map((c) => c.title.toLowerCase()));
  const pubInput = (await gql(Q_PUBS)).publications.nodes.map((p) => ({publicationId: p.id}));

  let made = 0;
  for (const c of COLLECTIONS) {
    if (existing.has(c.title.toLowerCase())) {
      console.log('  = exists:', c.title);
      continue;
    }
    const res = await gql(Q_CREATE, {
      input: {
        title: c.title,
        descriptionHtml: `<p>${c.desc}</p>`,
        image: {src: c.img, altText: `${c.title} at Pet Centre`},
        ruleSet: {
          appliedDisjunctively: false,
          rules: [{column: 'TAG', relation: 'EQUALS', condition: c.tag}],
        },
      },
    });
    const coll = res.collectionCreate.collection;
    if (!coll) {
      console.log('  x ' + c.title + ' — ' + JSON.stringify(res.collectionCreate.userErrors));
      continue;
    }
    if (pubInput.length) await gql(Q_PUBLISH, {id: coll.id, input: pubInput});
    made++;
    console.log(`  + ${c.title}  →  /collections/${coll.handle}`);
  }
  console.log(`\nDone: ${made} collections created & published.`);
}
main().catch((e) => {console.error('FAILED:', e.message); process.exit(1);});
