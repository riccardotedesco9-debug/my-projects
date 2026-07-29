/**
 * Lane A: read-only Hike REST API client. OAuth2 authorization-code flow via the
 * apps-script-oauth2 library (userSymbol OAuth2 in appsscript.json). Only GET
 * endpoints are ever called — this project never writes to Hike.
 * Rate limits: 60/min + 5,000/day per store (docs.hikeup.com/reference/rate-limit).
 */
var HikeApi = (function () {
  var BASE = 'https://api.hikeup.com';
  var PAGE_SIZE = 200;
  var MAX_PAGES = 200;

  function service_() {
    var id = Settings.get('HIKE_CLIENT_ID', '');
    var secret = Settings.get('HIKE_CLIENT_SECRET', '');
    if (!id || !secret) throw new Error('Hike App Id/Secret not set — run "Connect Hike API…" first.');
    return OAuth2.createService('hike')
      .setAuthorizationBaseUrl(BASE + '/oauth/authorize')
      .setTokenUrl(BASE + '/oauth/token')
      .setClientId(id)
      .setClientSecret(secret)
      .setCallbackFunction('hikeAuthCallback')
      .setPropertyStore(PropertiesService.getDocumentProperties())
      .setCache(CacheService.getDocumentCache())
      .setLock(LockService.getDocumentLock())
      .setScope('all');
  }

  function handleCallback(request) {
    var ok = service_().handleCallback(request);
    return HtmlService.createHtmlOutput(ok
      ? 'Hike is connected — you can close this tab and go back to the sheet.'
      : 'Hike connection was denied or failed. Close this tab and try "Connect Hike API…" again.');
  }

  /** Menu flow: store App Id/Secret, show the Return URI to register + the authorize link. */
  function connectPrompt() {
    var ui = SpreadsheetApp.getUi();
    var idAns = ui.prompt('Connect Hike API — step 1 of 2',
      'Paste the App Id from developer.hikeup.com (Partner Dashboard → your app):', ui.ButtonSet.OK_CANCEL);
    if (idAns.getSelectedButton() !== ui.Button.OK) return;
    var secretAns = ui.prompt('Connect Hike API — step 2 of 2', 'Paste the App Secret:', ui.ButtonSet.OK_CANCEL);
    if (secretAns.getSelectedButton() !== ui.Button.OK) return;
    Settings.set('HIKE_CLIENT_ID', ValueUtils.normString(idAns.getResponseText()));
    Settings.set('HIKE_CLIENT_SECRET', ValueUtils.normString(secretAns.getResponseText()));

    var svc = service_();
    var html = '<p><b>1.</b> Make sure this Return URI is registered on the app in developer.hikeup.com:</p>' +
      '<pre style="white-space:pre-wrap;border:1px solid #ccc;padding:6px">' + svc.getRedirectUri() + '</pre>' +
      '<p><b>2.</b> Log into the Hike store in this browser, then ' +
      '<a href="' + svc.getAuthorizationUrl() + '" target="_blank" rel="noopener">click here to connect Hike</a> and approve.</p>' +
      '<p>Note: Hike API access requires the Hike <b>Plus</b> plan or higher.</p>';
    ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(540).setHeight(280), 'Connect Hike API');
  }

  function fetchJson_(path, attempt) {
    attempt = attempt || 1;
    var svc = service_();
    if (!svc.hasAccess()) throw new Error('Hike API is not connected (or the token expired) — run "Connect Hike API…".');
    var resp = UrlFetchApp.fetch(BASE + path, {
      headers: { Authorization: 'Bearer ' + svc.getAccessToken(), Accept: 'application/json' },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code === 429) {
      var problem = String(resp.getHeaders()['X-Rate-Limit-Problem'] || '').toLowerCase();
      if (problem !== 'daily' && attempt < 3) { Utilities.sleep(61000); return fetchJson_(path, attempt + 1); }
      throw new Error('Hike API rate limit reached (' + (problem || 'unknown') + ') — try again later.');
    }
    if (code < 200 || code >= 300) {
      throw new Error('Hike API HTTP ' + code + ' on ' + path.split('?')[0] + ': ' + resp.getContentText().slice(0, 300));
    }
    return JSON.parse(resp.getContentText());
  }

  /** Fetch products, optionally only those added/changed since the ISO watermark. */
  function fetchProducts(syncFrom) {
    var items = [], skip = 0;
    for (var page = 0; page < MAX_PAGES; page++) {
      var q = '/api/v1/products/get_all?page_size=' + PAGE_SIZE + '&Skip_count=' + skip +
        (syncFrom ? '&Sync_From=' + encodeURIComponent(syncFrom) : '');
      var resp = fetchJson_(q);
      var batch = resp.items || [];
      items = items.concat(batch);
      if (!resp.next || !batch.length) return items; // fully drained
      // Rebuild the query ourselves (docs' next-link drops Sync_From); trust its Skip_count.
      var m = String(resp.next).match(/Skip_count=(\d+)/i);
      if (!m) return items;
      skip = parseInt(m[1], 10);
    }
    // Ran out of page budget with more still to fetch: fail loudly rather than treat a partial
    // pull as the whole catalog — a truncated full pull would false-flag real products "missing".
    throw new Error('Hike returned more than ' + (MAX_PAGES * PAGE_SIZE) + ' products — too many for one API sync. ' +
      'Use "Import Hike export file…" for the initial load; incremental auto-sync then stays small.');
  }

  /**
   * Pull changed products and run the merge. The incremental watermark only advances
   * when the run succeeds (applied or genuinely nothing to do), so a cancelled
   * preview never causes missed changes.
   * @param {boolean} forceFull ignore the watermark and pull the WHOLE catalog (full reconcile,
   *        so a product deleted locally but still in Hike is re-added). The stored watermark is
   *        NOT cleared here — it advances only on success — so cancelling leaves auto-sync intact.
   */
  function syncNow(interactive, forceFull) {
    var watermark = forceFull ? '' : Settings.get('HIKE_SYNC_FROM', '');
    var incremental = !!watermark; // a watermark pull carries only changed products
    // A scheduled (non-interactive) run must NOT attempt the first full pull: it can page the
    // whole catalog (up to 200 requests), exceed the 6-minute limit, and then repeat every
    // tick because the watermark never advances. The first full sync must be run from the menu
    // (or seed via a file import); after it succeeds, scheduled pulls are small + incremental.
    if (!incremental && !interactive) {
      SyncLog.logRun({ source: 'api', ok: false, message: 'First API sync must be run manually (menu → Sync from Hike API now); auto-sync then continues incrementally.' });
      return;
    }
    // Interactive first FULL pull on an already-large catalog: paging tens of thousands of
    // products at Hike's 60/min rate limit can outrun the 6-minute execution cap and die
    // mid-fetch (nothing written, but the watermark never advances — it would just die again).
    // Seeding via a file import is instant and sets the same baseline, so steer there.
    if (!incremental && interactive) {
      var sh = SheetIO.dataSheet();
      if (sh.getLastRow() > 5000) {
        var ui = SpreadsheetApp.getUi();
        // Same 6-minute-timeout protection for both entry points, but honest copy: a forceFull run
        // is a deliberate re-sync, not the "first" sync.
        var msg = (forceFull
          ? 'A full re-sync downloads your WHOLE Hike catalog, which can exceed Google\'s 6-minute limit '
          : 'This is the FIRST API sync, which downloads the whole catalog and can exceed Google\'s 6-minute limit ') +
          'on a catalog this size (nothing would be written if it times out).\n\n' +
          'Faster alternative: run "Import Hike export file…" with a fresh "Export all details" file — ' +
          'it also re-adds deleted products, instantly.\n\n' +
          'Try the full API pull anyway?';
        var goOn = ui.alert('Large catalog — ' + (forceFull ? 'full re-sync' : 'seed by file instead?'), msg, ui.ButtonSet.YES_NO);
        if (goOn !== ui.Button.YES) return;
      }
    }
    var fetchStartedAt = new Date().toISOString();
    var products = fetchProducts(watermark || null);

    if (!products.length) {
      // A full pull returning nothing means the catalog is empty; an incremental one means no
      // changes since the watermark — say the accurate one for each.
      SyncLog.logRun({ source: 'api', ok: true,
        message: forceFull ? 'Full re-sync: Hike returned no products (catalog empty).' : 'No product changes since ' + (watermark || 'the beginning') + '.' });
      if (interactive) SpreadsheetApp.getUi().alert(forceFull
        ? 'Hike returned no products — nothing to reconcile.'
        : 'Hike reports no product changes since the last sync.');
      Settings.set('HIKE_SYNC_FROM', fetchStartedAt);
      return;
    }

    var sheetValues = SheetIO.readAll();
    var headerRow = MergeEngine.findHeaderRow(sheetValues);
    if (headerRow === -1) throw new Error('Header row (Name/SKU/Barcode) not found in the data tab.');
    var incoming = HikeFieldMap.productsToIncoming(products, sheetValues[headerRow]);
    if (incoming.warnings.length) {
      SyncLog.logRun({ source: 'api', ok: true, message: 'Mapping notes: ' + incoming.warnings.slice(0, 3).join(' | ') });
    }

    var result = SyncRunner.run('api (' + products.length + ' changed product(s))', incoming, !!interactive, { incremental: incremental });
    // Advance the watermark when the run reached a settled state (written, or genuinely
    // nothing to change). Do NOT advance on a cancelled preview or an abort, or those
    // changes would be skipped forever.
    if (result.reason === 'applied' || result.reason === 'nothing-to-do') {
      Settings.set('HIKE_SYNC_FROM', fetchStartedAt);
    }
  }

  return {
    handleCallback: handleCallback,
    connectPrompt: connectPrompt,
    syncNow: syncNow
  };
})();
