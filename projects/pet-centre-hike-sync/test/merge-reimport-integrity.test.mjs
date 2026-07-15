/**
 * Data-integrity regressions for the "Hike is source of truth" contract on a FULL import
 * (file lane, and a full/non-incremental API pull): anything deleted or blanked locally must
 * be restored from Hike on the next full sync. The incremental API lane is intentionally
 * different (it only carries changed products) and is covered separately in merge-fixes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MergeEngine = require('../src/merge-engine.js');

const HEADERS = ['Name', 'Description', 'SKU', 'Barcode', 'Product type', 'Brand name', 'Active',
  'Pet Centre_Tax', 'Pet Centre_Cost price', 'Pet Centre_Retail price', 'Pet Centre_Stock', 'Pet Centre_Stock on hand'];

/** The full Hike "Export all details" (source of truth): 3 products, CSV-style strings. */
function hikeExport() {
  return [
    ['Best Dog Food 1kg', 'Amazing Product', 'PC1234567891011', '1234567891011', 'Dog Dry Food', 'Pet Food Ltd.', 'TRUE', 'No Tax', '€10.00', '€12.50', '3', '3'],
    ['Magic Cat Food 400g', 'Fly!', 'PC2468101112131', '2468101112131', 'Cat Wet Food', 'Magic Foods Ltd.', 'TRUE', 'VAT 18%', '€30.00', '€35.00', '2', '2'],
    ['Natural Pet Product 30ml', 'Natural', 'PC3691215182124', '3691215182124', 'Natural Pet Food', 'Natural Pets Ltd.', 'TRUE', 'Vat 5%', '€6.00', '€7.95', '6', '6'],
  ];
}
/** The same 3 products already in the sheet, in native cell types. */
function sheetWithAll() {
  return [
    HEADERS.slice(),
    ['Best Dog Food 1kg', 'Amazing Product', 'PC1234567891011', 1234567891011, 'Dog Dry Food', 'Pet Food Ltd.', 'TRUE', 'No Tax', 10, 12.5, 3, 3],
    ['Magic Cat Food 400g', 'Fly!', 'PC2468101112131', 2468101112131, 'Cat Wet Food', 'Magic Foods Ltd.', 'TRUE', 'VAT 18%', 30, 35, 2, 2],
    ['Natural Pet Product 30ml', 'Natural', 'PC3691215182124', 3691215182124, 'Natural Pet Food', 'Natural Pets Ltd.', 'TRUE', 'Vat 5%', 6, 7.95, 6, 6],
  ];
}

test('a product deleted from the sheet re-appears on the next full import', () => {
  const sheet = sheetWithAll();
  sheet.splice(2, 1); // user deleted the Magic Cat Food row; it is still in Hike
  const plan = MergeEngine.buildPlan(sheet, { headers: HEADERS, rows: hikeExport() }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.appends.length, 1, 'deleted product must be queued for re-append');
  assert.equal(plan.appends[0][2], 'PC2468101112131');
  assert.equal(plan.updates.length, 0);
});

test('several deleted rows all re-append in one full import', () => {
  const sheet = sheetWithAll();
  sheet.splice(1, 2); // delete the first two products
  const plan = MergeEngine.buildPlan(sheet, { headers: HEADERS, rows: hikeExport() }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.appends.length, 2);
  const skus = plan.appends.map(r => r[2]).sort();
  assert.deepEqual(skus, ['PC1234567891011', 'PC2468101112131']);
});

test('header-only sheet (all rows gone) re-adds the whole catalog', () => {
  const plan = MergeEngine.buildPlan([HEADERS.slice()], { headers: HEADERS, rows: hikeExport() }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.appends.length, 3);
  assert.equal(plan.stats.sheetRows, 0);
  assert.equal(plan.missingKeys.length, 0);
});

test('a re-appended product keeps its numeric barcode/price/stock typing', () => {
  const sheet = sheetWithAll();
  sheet.splice(1, 1); // delete the dog food; the remaining rows keep the columns numeric-dominant
  const plan = MergeEngine.buildPlan(sheet, { headers: HEADERS, rows: hikeExport() }, {});
  const dog = plan.appends.find(r => r[2] === 'PC1234567891011');
  assert.ok(dog, 'dog food re-appended');
  assert.equal(dog[3], 1234567891011); // Barcode numeric
  assert.equal(dog[9], 12.5);          // Retail price numeric
  assert.equal(dog[11], 3);            // Stock on hand numeric
});

test('a value the user cleared in the sheet is refilled from Hike (not skipped)', () => {
  const sheet = sheetWithAll();
  sheet[1][9] = ''; // user blanked the dog food's retail price
  const plan = MergeEngine.buildPlan(sheet, { headers: HEADERS, rows: hikeExport() }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].rowIndex, 1);
  assert.equal(plan.updates[0].changes[0].header, 'Pet Centre_Retail price');
  assert.equal(plan.updates[0].changes[0].newValue, 12.5);
});

test('deleting then re-adding is idempotent: a second identical full import makes no changes', () => {
  // After the re-append lands, the sheet equals Hike again → the next full import is a no-op.
  const plan = MergeEngine.buildPlan(sheetWithAll(), { headers: HEADERS, rows: hikeExport() }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.appends.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.missingKeys.length, 0);
});
