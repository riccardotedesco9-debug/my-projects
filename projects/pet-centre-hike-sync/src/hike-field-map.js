/**
 * Maps Hike API product objects onto rows aligned with the sheet's export-format
 * headers. Cells left as null mean "leave the sheet's value alone" — the API does
 * not expose every export column (SEO fields, composite parts, variant options…),
 * and those must survive untouched.
 */
var HikeFieldMap = (function () {
  // Lazy cross-file lookup — see merge-engine.js for why.
  function U() {
    return typeof ValueUtils !== 'undefined' ? ValueUtils : require('./value-utils.js');
  }

  var OUTLET_SUFFIX_RE = /^(.+)_(retail price|tax|stock on hand|cost price)$/i;

  /** Detect the outlet-prefixed column prefix (e.g. "Pet Centre") from the header row. */
  function detectOutletPrefix(sheetHeaders) {
    for (var i = 0; i < sheetHeaders.length; i++) {
      var m = String(sheetHeaders[i]).trim().match(OUTLET_SUFFIX_RE);
      if (m && m[1]) return m[1];
    }
    return null;
  }

  function stripHtml(s) {
    return U().normString(String(s || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' '));
  }

  function toTF(b) { return b === true ? 'TRUE' : b === false ? 'FALSE' : null; }
  function orNull(v) { return v === undefined ? null : v; }
  function isHttpUrl(v) { return typeof v === 'string' && /^https?:\/\//i.test(v); }

  /**
   * Real image URL for a product. `primary_image` is an internal identifier (GUID), not
   * a URL — the URLs live in additional_images[].image_url (full) or the *_thumbnail
   * fields. Prefer the primary image's full URL, then any full URL, then the largest
   * thumbnail; return null if none is a real http URL (leaves the sheet cell alone).
   */
  function pickImageUrl(p) {
    if (isHttpUrl(p.primary_image)) return p.primary_image;
    // filter(Boolean): a null/undefined element in the array would otherwise throw on the
    // dereferences below and abort the whole sync run over one malformed image entry.
    var imgs = (p.additional_images || []).filter(function (x) { return x; });
    var primary = imgs.filter(function (x) { return x.is_primary; })[0] || imgs[0];
    var ordered = primary ? [primary].concat(imgs) : imgs;
    var fields = ['image_url', '500_thumbnail', '240_thumbnail', '50_thumbnail'];
    for (var i = 0; i < ordered.length; i++) {
      for (var f = 0; f < fields.length; f++) {
        if (isHttpUrl(ordered[i][fields[f]])) return ordered[i][fields[f]];
      }
    }
    return null;
  }

  /** Build {headers, rows, warnings} aligned to sheetHeaders from API product objects. */
  function productsToIncoming(products, sheetHeaders) {
    var prefix = detectOutletPrefix(sheetHeaders);
    var idx = {};
    sheetHeaders.forEach(function (h, i) {
      var n = U().normHeader(h);
      if (n && !(n in idx)) idx[n] = i;
    });
    var warnings = [];
    if (!prefix) warnings.push('No outlet-prefixed columns detected in the sheet — price/stock columns will not be updated from the API.');

    var rows = [];
    products.forEach(function (p) {
      var variants = (p.has_variants && p.product_variants && p.product_variants.length)
        ? p.product_variants : [null];
      variants.forEach(function (variant) {
        rows.push(buildRow_(p, variant, sheetHeaders.length, idx, prefix, warnings));
      });
    });
    return { headers: sheetHeaders.slice(), rows: rows, warnings: warnings };
  }

  function buildRow_(p, variant, width, idx, prefix, warnings) {
    var row = [];
    for (var i = 0; i < width; i++) row.push(null);
    function put(name, value) {
      var c = idx[name];
      if (c === undefined || value === null || value === undefined) return;
      // An empty value from the API means "not provided" — leave the sheet's cell alone
      // rather than blanking it (the API can't distinguish empty from absent reliably).
      if (U().normString(value) === '') return;
      row[c] = value;
    }

    put('name', orNull(p.name));
    if (p.description !== undefined) put('description', stripHtml(p.description));
    put('sku', variant ? orNull(variant.sku) : orNull(p.sku));
    put('barcode', variant ? orNull(variant.barcode) : orNull(p.barcode));
    if (p.product_type) put('product type', p.product_type.map(function (t) { return t.type_name; }).join(';'));
    if (p.product_tags) put('product tag', p.product_tags.map(function (t) { return t.name; }).join(';'));
    put('brand name', orNull(p.bran_name !== undefined ? p.bran_name : p.brand_name)); // 'bran_name' is Hike's own field-name typo
    var sup = (p.product_suppliers || []).filter(function (s) { return s.is_primary; })[0] || (p.product_suppliers || [])[0];
    if (sup) put('supplier name', orNull(sup.supplier_name));
    put('track inventory', toTF(p.track_inventory));
    put('allow out of stock', toTF(p.continue_selling_no_inventory));
    put('is variant product', toTF(p.has_variants));
    put('loyalty', orNull(p.additional_reward_points));
    var img = pickImageUrl(p);
    if (img) put('image url', img);
    put('active', toTF(p.isActive));

    var outlets = (variant && variant.variant_outlets) || p.product_outlets || [];
    var o = null;
    if (prefix) {
      o = outlets.filter(function (x) {
        return U().normHeader(x.outlet_name) === U().normHeader(prefix);
      })[0];
    }
    if (!o && outlets.length === 1) o = outlets[0];
    if (!o && outlets.length > 1 && warnings.length < 5) {
      warnings.push('Product "' + p.name + '": no outlet named "' + prefix + '" in the API data — outlet columns left untouched.');
    }
    if (o && prefix) {
      var pl = U().normHeader(prefix);
      put(pl + '_tax', orNull(o.tax_name));
      put(pl + '_cost price', orNull(o.cost_price));
      put(pl + '_retail price', orNull(o.price_inc_tax));
      put(pl + '_stock', o.available_inventory !== undefined ? o.available_inventory : orNull(o.on_hand_inventory));
      put(pl + '_stock on hand', orNull(o.on_hand_inventory));
      put(pl + '_reorder level', orNull(o.reorder_level));
      put(pl + '_reorder value', orNull(o.reorder_qty));
      put(pl + '_price excluding tax', orNull(o.price_ex_tax));
      put(pl + '_outlet visibility', toTF(o.visible_or_not));
    }
    return row;
  }

  return {
    productsToIncoming: productsToIncoming,
    pickImageUrl: pickImageUrl
  };
})();

if (typeof module !== 'undefined') module.exports = HikeFieldMap;
