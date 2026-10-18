/**
 * In Search of Pink: the shared list.
 *
 * This script turns your Google Sheet into the shared list that both phones
 * read and write. Paste this whole file into Extensions > Apps Script,
 * save, then Deploy > New deployment > Web app with
 *   Execute as: Me
 *   Who has access: Anyone
 * and copy the Web app URL into the app.
 *
 * You can edit the "Restaurants" tab by hand too. Type Pink, No or
 * Not checked in the second column. Leave the ID column alone.
 */

const SHEET_NAME = 'Restaurants';
const HEADERS = ['Restaurant', 'Pink packets?', 'Last updated', 'ID (leave alone)'];
const LABEL = { pink: 'Pink', no: 'No', unknown: 'Not checked' };

function doGet() {
  const sh = getSheet_();
  let items = readItems_(sh);
  if (items.some(function (it) { return it.isNew; })) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      items = readItems_(sh);
      writeItems_(sh, items);
    } finally {
      lock.releaseLock();
    }
  }
  return reply_({ ok: true, items: items.map(clean_), sheetUrl: spreadsheetUrl_() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const sh = getSheet_();
    const items = readItems_(sh);
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 500) : [];
    ops.forEach(function (op) { applyOp_(items, op); });
    writeItems_(sh, items);
    return reply_({ ok: true, items: items.map(clean_), sheetUrl: spreadsheetUrl_() });
  } catch (err) {
    return reply_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- the sheet ---------- */

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    const first = ss.getSheets()[0];
    if (first && first.getLastRow() === 0) {
      sh = first;
      sh.setName(SHEET_NAME);
    } else {
      sh = ss.insertSheet(SHEET_NAME);
    }
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readItems_(sh) {
  const rows = sh.getLastRow() - 1;
  if (rows < 1) return [];
  const values = sh.getRange(2, 1, rows, 4).getValues();
  const items = [];
  values.forEach(function (r) {
    const name = String(r[0] == null ? '' : r[0]).replace(/\s+/g, ' ').trim();
    if (!name) return;
    let id = String(r[3] == null ? '' : r[3]).trim();
    const isNew = !id;
    if (isNew) id = Utilities.getUuid();
    items.push({ id: id, name: name, status: statusFrom_(r[1]), updated: dateFrom_(r[2]), isNew: isNew });
  });
  return items;
}

function writeItems_(sh, items) {
  items.sort(function (a, b) {
    return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
  });
  const oldRows = sh.getLastRow() - 1;
  if (oldRows > 0) sh.getRange(2, 1, oldRows, 4).clearContent();
  if (items.length) {
    const rows = items.map(function (it) {
      return [it.name, LABEL[it.status], it.updated || '', it.id];
    });
    sh.getRange(2, 3, items.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, items.length, 4).setValues(rows);
  }
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([LABEL.pink, LABEL.no, LABEL.unknown], true)
    .setAllowInvalid(true)
    .build();
  sh.getRange(2, 2, Math.max(items.length, 1) + 200, 1).setDataValidation(rule);
}

/* ---------- changes from the phones ---------- */

function applyOp_(items, op) {
  if (!op || typeof op !== 'object') return;
  if (op.op === 'delete') {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].id === op.id) items.splice(i, 1);
    }
    return;
  }
  if (op.op !== 'set') return;
  const name = String(op.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) return;
  const status = LABEL[op.status] ? op.status : 'unknown';
  // Same restaurant added on both phones? Match by name and keep the spelling already on the list.
  let it = null, sameId = false;
  for (let i = 0; i < items.length && !it; i++) if (op.id && items[i].id === op.id) { it = items[i]; sameId = true; }
  for (let i = 0; i < items.length && !it; i++) if (key_(items[i].name) === key_(name)) it = items[i];
  if (!it) {
    it = { id: String(op.id || Utilities.getUuid()).slice(0, 64), name: name, updated: null };
    items.push(it);
  } else if (sameId) {
    it.name = name;
  }
  it.status = status;
  if (isDate_(op.updated)) it.updated = op.updated;
}

/* ---------- helpers ---------- */

function key_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

function statusFrom_(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === 'pink' || s === 'yes' || s === 'y') return 'pink';
  if (s === 'no' || s === 'no pink' || s === 'n') return 'no';
  return 'unknown';
}

function dateFrom_(v) {
  if (v instanceof Date && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v == null ? '' : v).trim();
  return isDate_(s) ? s : null;
}

function isDate_(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function clean_(it) { return { id: it.id, name: it.name, status: it.status, updated: it.updated || null }; }

function spreadsheetUrl_() {
  try { return SpreadsheetApp.getActiveSpreadsheet().getUrl(); } catch (e) { return ''; }
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
