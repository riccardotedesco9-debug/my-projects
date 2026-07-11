// Regression tests for the review findings (see plans/.../adversarial review).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MergeEngine = require('../src/merge-engine.js');
const ValueUtils = require('../src/value-utils.js');

// --- value-utils: number/key/date normalization -----------------------------

test('parseNumeric keeps thousands groups intact, treats only <d>,<1-2d> as decimal', () => {
  assert.equal(ValueUtils.parseNumeric('1,234'), 1234);   // thousands separator, NOT 1.234
  assert.equal(ValueUtils.parseNumeric('1,500'), 1500);
  assert.equal(ValueUtils.parseNumeric('12,50'), 12.5);   // EU decimal comma
  assert.equal(ValueUtils.parseNumeric('€1,234.56'), 1234.56);
  assert.equal(ValueUtils.parseNumeric('7'), 7);
});

test('normKey canonicalizes leading zeros and .0 so number vs string keys match', () => {
  assert.equal(ValueUtils.normKey('05555555555555'), '5555555555555');
  assert.equal(ValueUtils.normKey(5555555555555), '5555555555555');
  assert.equal(ValueUtils.normKey('123.0'), '123');
  assert.equal(ValueUtils.normKey('0'), '0');
});

test('equivalent treats a Date cell and its ISO string as equal (no date churn)', () => {
  const d = new Date('2026-01-15T00:00:00.000Z');
  assert.equal(ValueUtils.equivalent(d, '2026-01-15'), true);
  assert.equal(ValueUtils.equivalent(d, '2026-01-16'), false);
});

// --- merge engine: dual-key, leading-zero, skip, reportMissing ---------------

const H = ['Name', 'SKU', 'Barcode', 'Description', 'Pet Centre_Retail price'];
function sheetRows(rows) { return [H.slice()].concat(rows); }

test('leading-zero barcode (string import) matches numeric sheet barcode — updates, no duplicate', () => {
  const s = sheetRows([['No-SKU item', '', 5555555555555, 'desc', 5]]);
  const plan = MergeEngine.buildPlan(s, {
    headers: ['SKU', 'Barcode', 'Pet Centre_Retail price'],
    rows: [['', '05555555555555', '9.99']]
  }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.appends.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].rowIndex, 1);
  assert.equal(plan.updates[0].changes[0].newValue, 9.99);
});

test('SKU/barcode cross-over: barcode-only sheet row + import row with new SKU updates in place', () => {
  const s = sheetRows([['Widget', '', 1112223334445, 'd', 3]]); // sheet has no SKU, barcode only
  const plan = MergeEngine.buildPlan(s, {
    headers: ['Name', 'SKU', 'Barcode', 'Pet Centre_Retail price'],
    rows: [['Widget', 'NEWSKU1', '1112223334445', '3']] // Hike has since assigned a SKU
  }, {});
  assert.equal(plan.ok, true);
  assert.equal(plan.appends.length, 0, 'must update in place, not append a duplicate');
  assert.equal(plan.updates.length, 1);
  const skuChange = plan.updates[0].changes.find(c => /sku/i.test(c.header));
  assert.ok(skuChange && skuChange.newValue === 'NEWSKU1', 'the SKU should be written into the matched row');
});

test('update carries the SHEET row identity (sheetKey) for pre-write re-verification', () => {
  const s = sheetRows([['A', 'SKU-A', 111, 'd', 1]]);
  const plan = MergeEngine.buildPlan(s, { headers: ['SKU', 'Pet Centre_Retail price'], rows: [['SKU-A', '2']] }, {});
  assert.equal(plan.updates[0].sheetKey, 'sku:sku-a');
  assert.ok(typeof plan.headerSignature === 'string' && plan.headerSignature.length > 0);
});

test('reportMissing:false (incremental pull) does not flag absent products as missing', () => {
  const s = sheetRows([
    ['A', 'SKU-A', 111, 'da', 1],
    ['B', 'SKU-B', 222, 'db', 2],
    ['C', 'SKU-C', 333, 'dc', 3],
  ]);
  const incoming = { headers: ['SKU', 'Pet Centre_Retail price'], rows: [['SKU-B', '9']] };
  const full = MergeEngine.buildPlan(s, incoming, {});
  const incr = MergeEngine.buildPlan(s, incoming, { reportMissing: false });
  assert.equal(full.missingKeys.length, 2);
  assert.equal(incr.missingKeys.length, 0);
  assert.equal(incr.updates.length, 1); // still applies the real change
});

test('aggregate blanking guard still fires on scattered blanks across columns', () => {
  const s = sheetRows([
    ['Foo', 'A', 111, 'descA', 1],
    ['Bar', 'B', 222, 'descB', 2],
  ]);
  // Each row blanks a different populated column, so neither column is all-empty
  // (per-column skip won't catch it) — the aggregate ratio must still abort.
  const plan = MergeEngine.buildPlan(s, {
    headers: ['SKU', 'Name', 'Description'],
    rows: [['A', '', 'descA'], ['B', 'Bar', '']],
  }, {});
  assert.equal(plan.ok, false);
  assert.match(plan.errors[0], /blank/);
});

test('headerSignature ignores trailing empty cells but detects real column changes', () => {
  // The pre-write guard compares two getDataRange reads whose trailing-empty widths can
  // differ; the signature must be stable to that, yet catch a real insert/rename.
  const base = MergeEngine.headerSignature(['Name', 'SKU', 'Barcode']);
  assert.equal(MergeEngine.headerSignature(['Name', 'SKU', 'Barcode', '', '', '']), base);
  assert.equal(MergeEngine.headerSignature(['Name', 'SKU', 'Barcode', null, undefined]), base);
  assert.notEqual(MergeEngine.headerSignature(['Name', 'SKU', 'Barcode', 'Extra']), base);
  assert.notEqual(MergeEngine.headerSignature(['Name', 'SKU', 'Barkode']), base);
  // An INTERIOR blank-header column (a mid-run insert that shifts real columns right) must
  // change the signature — otherwise a write lands on the wrong column and destroys data.
  assert.notEqual(MergeEngine.headerSignature(['Name', '', 'SKU', 'Barcode']), base);
  assert.notEqual(MergeEngine.headerSignature(['', 'Name', 'SKU', 'Barcode']), base);
});
