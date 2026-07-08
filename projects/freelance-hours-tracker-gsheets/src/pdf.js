// pdf.js — turns the regenerated Report sheet into a print-ready A4 PDF.
// Primary path: the spreadsheet /export?format=pdf URL (Google's own sample
// pattern) bounded to the report content. Fragile lately for server-side
// callers → retry ×3, then a degraded DriveApp.getAs(PDF) fallback that
// hides every other sheet for the duration.

/** Dialog entry point (google.script.run) — returns a JSON-safe summary. */
function exportPdf(opts) {
  var res = exportPdfCtx_(makeCtx_(), {
    client: opts.client,
    year: Number(opts.year),
    month: Number(opts.month),
    includeMoney: opts.includeMoney !== false,
    save: true,
  });
  return {
    name: res.name,
    url: res.url || '',
    sizeBytes: res.sizeBytes,
    usedFallback: res.usedFallback,
    totalHours: res.meta.totalHours,
    rowCount: res.meta.rowCount,
  };
}

/**
 * Full pipeline: rebuild report → fetch PDF (retry → fallback) → optionally
 * save into Timesheets/<Client>/. Returns {blob, name, sizeBytes, contentType,
 * usedFallback, fileId?, url?, meta}. Internal callers may use res.blob;
 * google.script.run wrappers must strip to JSON-safe fields.
 */
function exportPdfCtx_(ctx, opts) {
  // The Report sheet is a single shared rendering surface, and the fallback
  // toggles global sheet visibility — serialize build→fetch→save so concurrent
  // exports (manual + the monthly job's per-client loop) can't stomp each other.
  return withLock_(function () {
    var meta = buildReportCtx_(ctx, opts.client, opts.year, opts.month, opts.includeMoney !== false, {
      forceFallback: !!opts.forceFallback,
    });
    SpreadsheetApp.flush();

    var fetched = fetchReportPdfBlob_(ctx);
    var name = timesheetFilename_(opts.client, opts.year, opts.month);
    var blob = fetched.blob.setName(name);

    var out = {
      blob: blob,
      name: name,
      sizeBytes: blob.getBytes().length,
      contentType: blob.getContentType(),
      usedFallback: fetched.usedFallback,
      meta: meta,
    };

    if (opts.save !== false) {
      var folder = getTimesheetFolder_(String(opts.client));
      var file = folder.createFile(blob);
      out.fileId = file.getId();
      out.url = file.getUrl();
    }
    return out;
  });
}

function fetchReportPdfBlob_(ctx) {
  var gid = ctx.ss.getSheetByName(CFG.sheets.report).getSheetId();
  // Whole-gid export (no r1/c1/r2/c2): the Report sheet contains exactly the
  // report, and a range-bounded export may clip the embedded pie chart.
  var params = [
    'format=pdf',
    'size=7', // A4
    'portrait=true',
    'fitw=true',
    'gridlines=false',
    'printtitle=false',
    'sheetnames=false',
    'pagenum=UNDEFINED',
    'attachment=true',
    'top_margin=0.5',
    'bottom_margin=0.5',
    'left_margin=0.5',
    'right_margin=0.5',
    'horizontal_alignment=CENTER',
    'gid=' + gid,
  ].join('&');
  var url = 'https://docs.google.com/spreadsheets/d/' + ctx.ss.getId() + '/export?' + params;

  for (var attempt = 1; attempt <= 3; attempt++) {
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    var code = resp.getResponseCode();
    if (code === 200) {
      var blob = resp.getBlob();
      if (blob.getBytes().length > 0) return { blob: blob, usedFallback: false };
    }
    if (code === 429 || code >= 500) {
      Utilities.sleep(800 * Math.pow(2, attempt - 1));
    } else {
      break; // 4xx other than 429 won't heal by retrying
    }
  }
  return { blob: fallbackPdfBlob_(ctx), usedFallback: true };
}

/**
 * Degraded fallback: export the whole file as PDF with only the Report sheet
 * visible. Loses the bounded print range but survives an /export turndown.
 */
function fallbackPdfBlob_(ctx) {
  var report = ctx.ss.getSheetByName(CFG.sheets.report);
  var hiddenIds = [];
  try {
    ctx.ss.getSheets().forEach(function (sh) {
      if (sh.getSheetId() !== report.getSheetId() && !sh.isSheetHidden()) {
        sh.hideSheet();
        hiddenIds.push(sh.getSheetId());
      }
    });
    SpreadsheetApp.flush();
    return DriveApp.getFileById(ctx.ss.getId()).getAs('application/pdf');
  } finally {
    ctx.ss.getSheets().forEach(function (sh) {
      if (hiddenIds.indexOf(sh.getSheetId()) >= 0) sh.showSheet();
    });
    SpreadsheetApp.flush();
  }
}

function timesheetFilename_(client, year, month) {
  // month 0 → whole-year export, so the filename is just the year.
  var period = month ? year + '-' + (month < 10 ? '0' : '') + month : String(year);
  return 'Timesheet_' + period + '_' + sanitize_(String(client)) + '_' + sanitize_(CFG.ownerName) + '.pdf';
}

/** "Pet Centre" → "PetCentre"; "All Clients" → "AllClients". */
function sanitize_(s) {
  return String(s).replace(/[^A-Za-z0-9]/g, '');
}
