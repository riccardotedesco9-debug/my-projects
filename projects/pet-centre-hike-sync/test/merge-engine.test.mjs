import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MergeEngine = require('../src/merge-engine.js');
const ValueUtils = require('../src/value-utils.js');

const HEADERS = ['Name', 'Description', 'SKU', 'Barcode', 'Product type', 'Brand name', 'Active',
  'Pet Centre_Tax', 'Pet Centre_Cost price', 'Pet Centre_Retail price', 'Pet Centre_Stock', 'Pet Centre_Stock on hand'];

function sheet() {
  return [
    HEADERS.slice(),
    ['Best Dog Food 1kg', 'Amazing Product', 'PC1234567891011', 1234567891011, 'Dog Dry Food', 'Pet Food Ltd.', 'TRUE', 'No Tax', 10, 12.5, 3, 3],
    ['Magic Cat Food 400g', 'Fly!', 'PC2468101112131', 2468101112131, 'Cat Wet Food', 'Magic Foods Ltd.', 'TRUE', 'VAT 18%', 30, 35, 2, 2],
    ['Natural Pet Product 30ml', 'Natural', 'PC3691215182124', 3691215182124, 'Natural Pet Food', 'Natural Pets Ltd.', 'TRUE', 'Vat 5%', 6, 7.95, 6, 6],
  ];
}

/** A CSV-style export row equivalent to sheet row 1 (strings, € formatting). */
const CSV_ROW_1 = ['Best Dog Food 1kg', 'Amazing Product', 'PC1234567891011', '1234567891011',
  'Dog Dry Food', 'Pet Food Ltd.', 'TRUE', 'No Tax', '€10.00', '€12.50', '3', '3'];

test('identical import (CSV strings vs sheet types) produces no changes', () => {
  const plan = MergeEngine.buildPlan(sheet(), { headers: HEADERS, rows: [CSV_ROW_1] }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.appends.length, 0);
});

test('price change updates one cell, typed as a number like the existing cell', () => {
  const row = CSV_ROW_1.slice();
  row[9] = '€13.00';
  const plan = MergeEngine.buildPlan(sheet(), { headers: HEADERS, rows: [row] }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].changes.length, 1);
  assert.equal(plan.updates[0].changes[0].newValue, 13);
  assert.equal(plan.updates[0].rowIndex, 1);
});

test('new product appends full-width row; numeric column typing applies', () => {
  const row = ['Shiny New Toy', 'Squeaks', 'PC0000000000001', '5555555555555', 'Toys', 'Toy Co', 'TRUE', 'VAT 18%', '€2.00', '€4.99', '10', '10'];
  const plan = MergeEngine.buildPlan(sheet(), { headers: HEADERS, rows: [CSV_ROW_1, row] }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.appends.length, 1);
  const appended = plan.appends[0];
  assert.equal(appended.length, HEADERS.length);
  assert.equal(appended[3], 5555555555555); // barcode column is numeric-dominant
  assert.equal(appended[2], 'PC0000000000001');
  assert.equal(appended[9], 4.99);
});

test('products missing from the import are reported, never deleted', () => {
  const plan = MergeEngine.buildPlan(sheet(), { headers: HEADERS, rows: [CSV_ROW_1] }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.missingKeys.length, 2);
  assert.equal(plan.appends.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.ok(!('deletes' in plan));
});

test('unknown import column aborts with a clear error', () => {
  const plan = MergeEngine.buildPlan(sheet(), { headers: ['SKU', 'Bogus Column'], rows: [['PC1234567891011', 'x']] }, {});
  assert.equal(plan.ok, false);
  assert.match(plan.errors[0], /Bogus Column/);
});

test('unknown import column tolerated with ignoreUnmatched', () => {
  const plan = MergeEngine.buildPlan(sheet(), { headers: ['SKU', 'Bogus Column'], rows: [['PC1234567891011', 'x']] }, { ignoreUnmatched: true });
  assert.equal(plan.ok, true);
  assert.equal(plan.warnings.length, 1);
});

test('import without a SKU column aborts', () => {
  const plan = MergeEngine.buildPlan(sheet(), { headers: ['Name', 'Barcode'], rows: [['x', '123']] }, {});
  assert.equal(plan.ok, false);
  assert.match(plan.errors[0], /SKU/);
});

test('duplicate key in sheet: first occurrence wins, warning emitted', () => {
  const s = sheet();
  s.push(['Dup of dog food', 'dup', 'PC1234567891011', 1234567891011, '', '', '', '', 1, 1, 1, 1]);
  const row = CSV_ROW_1.slice();
  row[9] = '€14.00';
  const plan = MergeEngine.buildPlan(s, { headers: HEADERS, rows: [row] }, {});
  assert.equal(plan.ok, true);
  assert.ok(plan.warnings.some(w => /Duplicate product .* in the sheet/.test(w)));
  assert.equal(plan.updates[0].rowIndex, 1); // the first occurrence
});

test('duplicate key in import: last occurrence wins', () => {
  const a = CSV_ROW_1.slice(); a[9] = '€20.00';
  const b = CSV_ROW_1.slice(); b[9] = '€21.00';
  const plan = MergeEngine.buildPlan(sheet(), { headers: HEADERS, rows: [a, b] }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].changes[0].newValue, 21);
});

test('a column empty across the whole import is skipped, never blanked', () => {
  const rows = [['PC1234567891011', ''], ['PC2468101112131', ''], ['PC3691215182124', '']];
  const plan = MergeEngine.buildPlan(sheet(), { headers: ['SKU', 'Name'], rows }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.stats.skippedEmptyCols, 1);
});

test('partial import (SKU + one column) updates only that column', () => {
  const plan = MergeEngine.buildPlan(sheet(), { headers: ['SKU', 'Pet Centre_Retail price'], rows: [['PC2468101112131', '36.50']] }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].changes.length, 1);
  assert.equal(plan.updates[0].changes[0].newValue, 36.5);
  assert.equal(plan.missingKeys.length, 2);
});

test('BOM on the first header still matches', () => {
  const headers = HEADERS.slice();
  headers[0] = '﻿Name';
  const plan = MergeEngine.buildPlan(sheet(), { headers, rows: [CSV_ROW_1] }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.updates.length, 0);
});

test('header row below a preamble row is found; row indexes stay correct', () => {
  const s = sheet();
  s.unshift(['SOME TITLE', '', '', '', '', '', '', '', '', '', '', '']);
  const row = CSV_ROW_1.slice();
  row[9] = '€13.00';
  const plan = MergeEngine.buildPlan(s, { headers: HEADERS, rows: [row] }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.headerRow, 1);
  assert.equal(plan.updates[0].rowIndex, 2);
});

test('null incoming cells mean "leave the sheet value alone" (API lane)', () => {
  const row = [null, null, 'PC1234567891011', null, null, null, null, null, null, '€13.00', null, null];
  const plan = MergeEngine.buildPlan(sheet(), { headers: HEADERS, rows: [row] }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].changes.length, 1);
  assert.equal(plan.updates[0].changes[0].header, 'Pet Centre_Retail price');
});

test('import rows without SKU or Barcode are skipped with a warning', () => {
  const plan = MergeEngine.buildPlan(sheet(), { headers: HEADERS, rows: [['Ghost', '', '', '', '', '', '', '', '', '', '', '']] }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.appends.length, 0);
  assert.ok(plan.warnings.some(w => /no SKU or Barcode/.test(w)));
});

test('barcode fallback key matches number (sheet) vs string (import) when SKU is blank', () => {
  const s = sheet();
  s.push(['No-SKU Product', '', '', 7777777777777, '', '', '', '', 1, 5, 1, 1]);
  const plan = MergeEngine.buildPlan(s, { headers: ['SKU', 'Barcode', 'Pet Centre_Retail price'], rows: [['', '7777777777777', '6.00']] }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].rowIndex, 4);
});

test('formulaSafe neutralizes leading formula chars but leaves normal values', () => {
  assert.equal(ValueUtils.formulaSafe('=IMPORTXML("http://evil","//a")'), "'=IMPORTXML(\"http://evil\",\"//a\")");
  assert.equal(ValueUtils.formulaSafe('+1+1'), "'+1+1");
  assert.equal(ValueUtils.formulaSafe('-5'), "'-5");
  assert.equal(ValueUtils.formulaSafe('@handle'), "'@handle");
  assert.equal(ValueUtils.formulaSafe('Dog Food 2kg'), 'Dog Food 2kg');
  assert.equal(ValueUtils.formulaSafe(12.5), 12.5); // numbers keep their type
  assert.equal(ValueUtils.formulaSafe(''), '');
});

test('equivalence: currency string vs number, boolean string vs boolean', () => {
  assert.equal(ValueUtils.equivalent('€12.50', 12.5), true);
  assert.equal(ValueUtils.equivalent('12,50', 12.5), true);
  assert.equal(ValueUtils.equivalent(true, 'TRUE'), true);
  assert.equal(ValueUtils.equivalent('TRUE', 'FALSE'), false);
  assert.equal(ValueUtils.equivalent('', 0), false);
  assert.equal(ValueUtils.equivalent('abc', 'abd'), false);
});
