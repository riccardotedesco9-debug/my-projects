// clients.js — reads of the Clients sheet (Client | Rate | Email).
// The sheet itself is the database; adding a client is typing one row.

/** All non-empty client names, in sheet order. */
function getClientNames_(ctx) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.clients);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, CFG.clients.cols.name, last - 1, 1).getValues();
  var names = [];
  for (var i = 0; i < vals.length; i++) {
    var n = String(vals[i][0] || '').trim();
    if (n) names.push(n);
  }
  return names;
}

/** Case-insensitive existence check (dropdowns feed exact names; typing may not). */
function clientExists_(ctx, name) {
  var target = String(name || '').trim().toLowerCase();
  if (!target) return false;
  var names = getClientNames_(ctx);
  for (var i = 0; i < names.length; i++) {
    if (names[i].toLowerCase() === target) return true;
  }
  return false;
}

/**
 * One-read lookup for the start guards: does the client exist, and does it
 * have a positive €/h rate? Combined so startWork touches the Clients sheet
 * once instead of twice (latency).
 */
function getClientInfo_(ctx, name) {
  var info = { exists: false, hasRate: false };
  var sh = ctx.ss.getSheetByName(CFG.sheets.clients);
  if (!sh) return info;
  var last = sh.getLastRow();
  if (last < 2) return info;
  var vals = sh.getRange(2, 1, last - 1, 2).getValues();
  var target = String(name || '').trim().toLowerCase();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim().toLowerCase() === target) {
      info.exists = true;
      var rate = Number(vals[i][1]);
      info.hasRate = isFinite(rate) && rate > 0;
      return info;
    }
  }
  return info;
}

/** Clients that have BOTH a name and an email — the monthly-draft audience. */
function getClientsWithEmail_(ctx) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.clients);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 3).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var name = String(vals[i][CFG.clients.cols.name - 1] || '').trim();
    var email = String(vals[i][CFG.clients.cols.email - 1] || '').trim();
    if (name && email) out.push({ name: name, email: email });
  }
  return out;
}
