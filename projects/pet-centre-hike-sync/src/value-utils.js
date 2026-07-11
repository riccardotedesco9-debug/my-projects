/**
 * Value normalization + equivalence helpers shared by the merge engine and importers.
 * Pure functions — no Apps Script services — so they also run under Node for tests.
 */
var ValueUtils = (function () {
  /** Trimmed string form of any cell value; strips a UTF-8 BOM. null/undefined → ''. */
  function normString(v) {
    if (v instanceof Date) return v.toISOString();
    return String(v === null || v === undefined ? '' : v).replace(/^﻿/, '').trim();
  }

  /** Canonical header form: BOM-stripped, trimmed, lowercased, inner whitespace collapsed. */
  function normHeader(h) {
    return normString(h).toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Canonical key (SKU/Barcode) form. A spreadsheet hands a numeric barcode back as a
   * number (dropping any leading zero and adding a '.0'); a CSV hands back a string.
   * Both must collapse to the same key, so all-digit keys are stripped of a trailing
   * '.0' AND of leading zeros ('0123' and the number 123 → '123').
   */
  function normKey(v) {
    var s = normString(v);
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, ''); // '123.0' from number formatting
    if (/^\d+$/.test(s)) s = s.replace(/^0+(\d)/, '$1'); // leading zeros, keep last digit
    return s;
  }

  /**
   * Parse a currency-ish value ('€12.50', '12,50', 12.5) to a float, or null.
   * Comma handling is deliberately conservative to avoid magnitude corruption: a comma
   * is treated as a decimal separator ONLY in the unambiguous EU-price shape
   * '<digits>,<1-2 digits>' ('12,50' → 12.5). Anything else (thousands groups like
   * '1,234' or '1,500', or values with a dot present) has its commas stripped.
   */
  function parseNumeric(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'boolean') return null;
    var s = normString(v);
    if (s === '') return null;
    s = s.replace(/[€$£\s]/g, '');
    if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.'); // EU decimal comma only
    else s = s.replace(/,/g, '');                            // thousands separators
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  /**
   * Neutralize an accidental/hostile formula before a setValues() write. Google Sheets turns a
   * string cell starting with =, +, - or @ into a live formula on setValues (that's how the
   * merge engine even restores real formulas). Product text sourced from Hike (a name, category,
   * barcode) that happens to start with one of those would silently become a formula — worst
   * case an =IMPORTXML(...) that exfiltrates catalog data. Prefix a leading apostrophe so the
   * cell is forced to text; the apostrophe is NOT stored in the value (display + lookups match
   * the plain text). Numbers pass through untouched, so numeric columns keep their type.
   */
  function formulaSafe(v) {
    if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
    return v;
  }

  /** Parse boolean-ish values (true, 'TRUE', 'Yes'…) to a boolean, or null. */
  function parseBoolish(v) {
    if (typeof v === 'boolean') return v;
    var s = normString(v).toLowerCase();
    if (s === 'true' || s === 'yes') return true;
    if (s === 'false' || s === 'no') return false;
    return null;
  }

  /** Parse a date-ish value (Date, or a parseable string) to an epoch ms, or null. */
  function parseDateMs(v) {
    if (v instanceof Date) return v.getTime();
    var s = normString(v);
    if (!/\d{4}/.test(s)) return null; // require a 4-digit year to avoid parsing junk
    var t = Date.parse(s);
    return isNaN(t) ? null : t;
  }

  /**
   * Are two cell values equivalent for sync purposes? Exact trimmed-string match, or
   * numeric equality ('€12.50' vs 12.5 — so a sync doesn't rewrite every price cell),
   * boolean equality (true vs 'TRUE'), or same calendar date (Date cell vs date string,
   * so date columns don't churn every import).
   */
  function equivalent(a, b) {
    var sa = normString(a), sb = normString(b);
    if (sa === sb) return true;
    var na = parseNumeric(a), nb = parseNumeric(b);
    if (na !== null && nb !== null) return Math.abs(na - nb) < 1e-9;
    var ba = parseBoolish(a), bb = parseBoolish(b);
    if (ba !== null && bb !== null) return ba === bb;
    if (a instanceof Date || b instanceof Date) {
      var da = parseDateMs(a), db = parseDateMs(b);
      if (da !== null && db !== null) return da === db;
    }
    return false;
  }

  /**
   * Value to write into a cell that already has content: keep the cell's existing type
   * where possible so number formats and the LABELS lookups keep behaving.
   */
  function coerceLike(existing, incoming, colType) {
    if (typeof existing === 'number') {
      var n = parseNumeric(incoming);
      if (n !== null) return n;
    }
    if (typeof existing === 'boolean') {
      var b = parseBoolish(incoming);
      if (b !== null) return b;
    }
    if (existing === '' || existing === null || existing === undefined) {
      return coerceForColumn(incoming, colType);
    }
    return normString(incoming);
  }

  /** Value to write into an empty/new cell, typed by the column's dominant type. */
  function coerceForColumn(incoming, colType) {
    if (colType === 'number') {
      var n = parseNumeric(incoming);
      if (n !== null) return n;
    }
    if (colType === 'boolean') {
      var b = parseBoolish(incoming);
      if (b !== null) return b;
    }
    return normString(incoming);
  }

  return {
    normString: normString,
    normHeader: normHeader,
    normKey: normKey,
    parseNumeric: parseNumeric,
    formulaSafe: formulaSafe,
    parseBoolish: parseBoolish,
    parseDateMs: parseDateMs,
    equivalent: equivalent,
    coerceLike: coerceLike,
    coerceForColumn: coerceForColumn
  };
})();

if (typeof module !== 'undefined') module.exports = ValueUtils;
