// Validates the Hike API → export-column mapping against the real product shape
// observed via the live probe (see tools/hike-api-probe.mjs output, 2026-07-10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HikeFieldMap = require('../src/hike-field-map.js');

// A product shaped like the real API response ("Demo Skirt").
function product(overrides = {}) {
  return Object.assign({
    name: 'Demo Skirt', description: null, sku: 'DemoSkirt', barcode: 'DemoSkirt',
    primary_image: '9ac944e5-6ab9-479e-b160-8010b56721be', // GUID, not a URL
    bran_name: null, has_variants: false, track_inventory: false,
    continue_selling_no_inventory: false, additional_reward_points: 0, isActive: true,
    product_tags: [], product_type: [{ type_id: 1, type_name: 'Bottoms', parent_type_id: 0 }],
    product_suppliers: [{ supplier_id: 1, supplier_name: 'Demo Supplier 1', is_primary: false }],
    product_variants: [],
    additional_images: [{
      primary_pic_Id: 1, image_url: null, primary_pic_name: '9ac944e5', is_primary: true,
      '50_thumbnail': 'https://cdn.example.com/50/skirt.png',
      '240_thumbnail': 'https://cdn.example.com/240/skirt.png',
      '500_thumbnail': 'https://cdn.example.com/500/skirt.png'
    }],
    product_outlets: [{
      outlet_id: 1, outlet_name: 'Qormi Outlet 1', cost_price: 50, markup: 0, price_ex_tax: 100,
      tax_id: 2, tax_name: 'VAT', tax_rate: 18, price_inc_tax: 118, avgCost_price: 0,
      on_hand_inventory: 0, inventory_to_receive: 0, reserved_inventory: 0, available_inventory: 0,
      reorder_level: 0, reorder_qty: 0, visible_or_not: true
    }]
  }, overrides);
}

const BASE_H = ['Name', 'Description', 'SKU', 'Barcode', 'Product type', 'Product tag', 'Brand name',
  'Supplier name', 'Track inventory', 'Image URL', 'Active'];
const OUTLET = 'Qormi Outlet 1';
const OUTLET_H = ['Tax', 'Cost price', 'Retail price', 'Stock', 'Stock on hand', 'Reorder level',
  'Reorder value', 'Price Excluding Tax', 'Outlet visibility'].map((s) => OUTLET + '_' + s);
const HEADERS = BASE_H.concat(OUTLET_H);

function mapOne(p) {
  const res = HikeFieldMap.productsToIncoming([p], HEADERS);
  const row = res.rows[0];
  const out = {};
  HEADERS.forEach((h, i) => { out[h] = row[i]; });
  return { out, warnings: res.warnings };
}

test('pickImageUrl: GUID primary_image is ignored; largest real thumbnail chosen', () => {
  assert.equal(HikeFieldMap.pickImageUrl(product()), 'https://cdn.example.com/500/skirt.png');
});

test('pickImageUrl: a real full image_url beats thumbnails', () => {
  const p = product();
  p.additional_images[0].image_url = 'https://cdn.example.com/full/skirt.png';
  assert.equal(HikeFieldMap.pickImageUrl(p), 'https://cdn.example.com/full/skirt.png');
});

test('pickImageUrl: no images → null (Image URL left alone)', () => {
  assert.equal(HikeFieldMap.pickImageUrl(product({ primary_image: null, additional_images: [] })), null);
});

test('outlet fields map to the right export columns', () => {
  const { out } = mapOne(product());
  assert.equal(out[OUTLET + '_Tax'], 'VAT');
  assert.equal(out[OUTLET + '_Cost price'], 50);
  assert.equal(out[OUTLET + '_Retail price'], 118);       // price_inc_tax
  assert.equal(out[OUTLET + '_Price Excluding Tax'], 100); // price_ex_tax
  assert.equal(out[OUTLET + '_Stock on hand'], 0);
  assert.equal(out[OUTLET + '_Outlet visibility'], 'TRUE');
});

test('core fields + image map; empty tags/description leave cells alone (null)', () => {
  const { out } = mapOne(product());
  assert.equal(out['Name'], 'Demo Skirt');
  assert.equal(out['SKU'], 'DemoSkirt');
  assert.equal(out['Product type'], 'Bottoms');
  assert.equal(out['Supplier name'], 'Demo Supplier 1'); // falls back off is_primary=false
  assert.equal(out['Image URL'], 'https://cdn.example.com/500/skirt.png');
  assert.equal(out['Description'], null); // null description must NOT blank the sheet
  assert.equal(out['Product tag'], null); // [] must NOT blank the sheet
  assert.equal(out['Brand name'], null);  // bran_name is null
});
