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
 * You can edit the "Restaurants" tab by hand too:
 *   - Pink packets?  type Pink, No or Not checked
 *   - Address        type a street address; the script finds it on the map.
 *                    Fort Lauderdale is assumed unless the address names a town and state,
 *                    such as "31 Bowens Wharf, Newport, RI".
 *   - Leave the ID column and the two map columns alone.
 *
 * Addresses are found on the map with Google's geocoder (built into Apps Script).
 */

const SHEET_NAME = 'Restaurants';
const COLS = {
  name: 'Restaurant',
  status: 'Pink packets?',
  updated: 'Last updated',
  id: 'ID (leave alone)',
  address: 'Address',
  geo: 'Map spot (from the address)',
  spots: 'Spots saved on a phone'
};
const ORDER = ['name', 'status', 'updated', 'id', 'address', 'geo', 'spots'];
const LABEL = { pink: 'Pink', no: 'No', unknown: 'Not checked' };
const NOT_FOUND = 'not found';
const GEOCODE_BUDGET_MS = 12000;
// The places the list covers. An address that names one of these states is looked up inside that
// box; an address with no town or state is taken to be in Fort Lauderdale (the first area).
const AREAS = [
  { name: 'Fort Lauderdale', match: /,\s*(FL|Fla\.?|Florida)\b/i, suffix: ', Fort Lauderdale, FL',
    south: 25.95, west: -80.45, north: 26.45, east: -80.0 },
  { name: 'Newport', match: /,\s*(RI|Rhode Island)\b/i, suffix: ', Newport, RI',
    south: 41.35, west: -71.50, north: 41.70, east: -71.10 }
];
const NOTE_V = 'v2|'; // notes written by this version of the script start with this

function doGet() {
  return withTable_(function (t) {
    return t.items.some(function (it) { return it.isNew; });
  });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return reply_({ ok: false, error: 'The request was not valid JSON.' });
  }
  const ops = Array.isArray(body.ops) ? body.ops.slice(0, 500) : [];
  return withTable_(function (t) {
    ops.forEach(function (op) { applyOp_(t.items, op); });
    return ops.length > 0;
  });
}

function withTable_(change) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = openTable_();
    let dirty = change(t);
    if (geocodeMissing_(t.items)) dirty = true;
    if (dirty || t.headersAdded) writeTable_(t);
    return reply_({ ok: true, items: t.items.map(clean_), sheetUrl: spreadsheetUrl_() });
  } catch (err) {
    return reply_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- the sheet ---------- */

function openTable_() {
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

  // Find each column by its heading, so older sheets keep working and new columns are added at the end.
  const col = {};
  let headersAdded = false;
  const lastCol = sh.getLastColumn();
  const heads = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  heads.forEach(function (h, i) {
    ORDER.forEach(function (k) { if (String(h).trim() === COLS[k] && !col[k]) col[k] = i + 1; });
  });
  let next = heads.length;
  while (next > 0 && String(heads[next - 1]).trim() === '') next--;
  ORDER.forEach(function (k) {
    if (!col[k]) {
      next++;
      col[k] = next;
      sh.getRange(1, next).setValue(COLS[k]).setFontWeight('bold');
      headersAdded = true;
    }
  });
  if (headersAdded) sh.setFrozenRows(1);

  const width = Math.max.apply(null, ORDER.map(function (k) { return col[k]; }));
  const rows = sh.getLastRow() - 1;
  const items = [];
  if (rows > 0) {
    const values = sh.getRange(2, 1, rows, width).getValues();
    const notes = sh.getRange(2, col.geo, rows, 1).getNotes();
    values.forEach(function (r, i) {
      const cell = function (k) { const v = r[col[k] - 1]; return v == null ? '' : v; };
      const name = String(cell('name')).replace(/\s+/g, ' ').trim();
      if (!name) return;
      let id = String(cell('id')).trim();
      const isNew = !id;
      if (isNew) id = Utilities.getUuid();
      const address = cleanAddress_(cell('address'));
      const geoText = String(cell('geo')).trim().toLowerCase();
      let geo = parsePoint_(geoText);
      const rawNote = String(notes[i][0] || '');
      const current = rawNote.indexOf(NOTE_V) === 0;
      const noteAddr = current ? rawNote.slice(NOTE_V.length) : rawNote;
      // The first version of this script only knew Fort Lauderdale. Look again at anything it
      // couldn't find, or found outside the area the address names.
      let recheck = false;
      if (!current && address) {
        if (geoText === NOT_FOUND) recheck = true;
        else if (geo && !inArea_(geo, areaFor_(address) || AREAS[0])) { geo = null; recheck = true; }
      }
      items.push({
        id: id,
        name: name,
        status: statusFrom_(cell('status')),
        updated: dateFrom_(cell('updated')),
        address: address,
        geo: geo,
        geoFor: !recheck && (geo || geoText === NOT_FOUND) ? noteAddr : '',
        spots: parseSpots_(cell('spots')),
        isNew: isNew
      });
    });
  }
  return { sh: sh, col: col, width: width, items: items, headersAdded: headersAdded };
}

function writeTable_(t) {
  const sh = t.sh, col = t.col, items = t.items;
  items.sort(function (a, b) {
    return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
  });
  const oldRows = sh.getLastRow() - 1;
  if (oldRows > 0) {
    ORDER.forEach(function (k) { sh.getRange(2, col[k], oldRows, 1).clearContent(); });
    sh.getRange(2, col.geo, oldRows, 1).clearNote();
  }
  if (items.length) {
    const n = items.length;
    const put = function (k, fn, asText) {
      const range = sh.getRange(2, col[k], n, 1);
      if (asText) range.setNumberFormat('@');
      range.setValues(items.map(function (it) { return [fn(it)]; }));
      return range;
    };
    put('name', function (it) { return it.name; });
    put('status', function (it) { return LABEL[it.status]; });
    put('updated', function (it) { return it.updated || ''; }, true);
    put('id', function (it) { return it.id; }, true);
    put('address', function (it) { return it.address; });
    put('geo', function (it) {
      if (!it.address) return '';
      if (it.geo) return pointText_(it.geo);
      return it.geoFor === it.address ? NOT_FOUND : '';
    }, true).setNotes(items.map(function (it) { return [it.address && it.geoFor === it.address ? NOTE_V + it.geoFor : '']; }));
    put('spots', function (it) { return it.spots.map(pointText_).join('; '); }, true);
  }
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([LABEL.pink, LABEL.no, LABEL.unknown], true)
    .setAllowInvalid(true)
    .build();
  sh.getRange(2, col.status, Math.max(items.length, 1) + 200, 1).setDataValidation(rule);
}

/* ---------- finding addresses on the map ---------- */

function geocodeMissing_(items) {
  const start = Date.now();
  let changed = false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.address) {
      if (it.geo || it.geoFor) { it.geo = null; it.geoFor = ''; changed = true; }
      continue;
    }
    if (it.geoFor === it.address) continue;
    if (Date.now() - start > GEOCODE_BUDGET_MS) break; // the rest are looked up on the next visit
    let point = null;
    try {
      point = geocode_(it.address);
    } catch (err) {
      break; // daily limit or a hiccup: try again later
    }
    it.geo = point;
    it.geoFor = it.address;
    changed = true;
  }
  return changed;
}

function areaFor_(address) {
  for (let i = 0; i < AREAS.length; i++) if (AREAS[i].match.test(address)) return AREAS[i];
  return null;
}

function inArea_(p, a) {
  const pad = 0.25;
  return p[0] >= a.south - pad && p[0] <= a.north + pad && p[1] >= a.west - pad && p[1] <= a.east + pad;
}

function geocode_(address) {
  const named = areaFor_(address);
  // An address that already names a town and state (", MA" or a ZIP code) is looked up as written.
  const complete = !!named || /,\s*[A-Z]{2}\b|\b\d{5}\b/.test(address);
  const area = named || (complete ? null : AREAS[0]);
  const query = complete ? address : address + AREAS[0].suffix;
  let geocoder = Maps.newGeocoder().setRegion('us');
  if (area) geocoder = geocoder.setBounds(area.south, area.west, area.north, area.east);
  const res = geocoder.geocode(query);
  if (!res || res.status !== 'OK' || !res.results || !res.results.length) return null;
  const best = res.results[0];
  const vague = ['locality', 'sublocality', 'neighborhood', 'postal_code', 'route', 'country',
    'administrative_area_level_1', 'administrative_area_level_2', 'colloquial_area'];
  const types = best.types || [];
  if (types.some(function (t) { return vague.indexOf(t) > -1; })) return null;
  const loc = best.geometry && best.geometry.location;
  if (!loc) return null;
  const p = [round5_(loc.lat), round5_(loc.lng)];
  if (area && !inArea_(p, area)) return null;
  return p;
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
    it = { id: String(op.id || Utilities.getUuid()).slice(0, 64), name: name, updated: null,
      address: '', geo: null, geoFor: '', spots: [] };
    items.push(it);
  } else if (sameId) {
    it.name = name;
  }
  it.status = status;
  if (isDate_(op.updated)) it.updated = op.updated;
  if (has_(op, 'address')) {
    const a = cleanAddress_(op.address);
    if (a !== it.address) { it.address = a; it.geo = null; it.geoFor = ''; }
  }
  if (has_(op, 'spots') && Array.isArray(op.spots)) {
    it.spots = op.spots.map(function (p) { return Array.isArray(p) ? parsePoint_(p.join(',')) : null; })
      .filter(Boolean).slice(-8);
  }
}

/* ---------- helpers ---------- */

function has_(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

function key_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

function cleanAddress_(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 200); }

function round5_(n) { return Math.round(Number(n) * 1e5) / 1e5; }

function parsePoint_(s) {
  const m = String(s || '').match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
  return [round5_(lat), round5_(lng)];
}

function parseSpots_(v) {
  return String(v == null ? '' : v).split(';').map(parsePoint_).filter(Boolean).slice(-8);
}

function pointText_(p) { return p[0].toFixed(5) + ',' + p[1].toFixed(5); }

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

function clean_(it) {
  return {
    id: it.id, name: it.name, status: it.status, updated: it.updated || null,
    address: it.address,
    geo: it.geo,
    geoState: !it.address ? 'none' : it.geo ? 'ok' : (it.geoFor === it.address ? 'notfound' : 'pending'),
    spots: it.spots
  };
}

function spreadsheetUrl_() {
  try { return SpreadsheetApp.getActiveSpreadsheet().getUrl(); } catch (e) { return ''; }
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
