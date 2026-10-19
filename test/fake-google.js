// Runs the real google-sheet/Code.gs under small stand-ins for Google's Sheets and Maps services,
// served over HTTP. Used only for testing. Usage: node fake-google.js <port>
//   GET/POST /exec    the web app
//   GET /_sheet       the sheet's cells (values and notes)
//   GET /_edit        simulate typing a row into the sheet by hand
// The fake geocoder knows a few test addresses (TEST_POINTS); anything with "nowhere" is not found;
// every other address gets a made-up point far out west so it never lands near the test spots.
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');

const TEST_POINTS = {
  '1411 S Andrews Ave': [26.10460, -80.14340],   // Tap 42
  '800 E Las Olas Blvd': [26.11950, -80.13660],  // 60 Vines
  '811 E Las Olas Blvd': [26.11915, -80.13630],  // American Social
  '817 E Las Olas Blvd': [26.11915, -80.13600],  // El Camino
  '350 E Las Olas Blvd': [26.11900, -80.14000],  // Worthwyld
};
let geocodeCalls = 0;
function fakeGeocode(query) {
  geocodeCalls++;
  const a = String(query).replace(/, Fort Lauderdale, FL$/, '');
  if (/nowhere/i.test(a)) return { status: 'ZERO_RESULTS', results: [] };
  let p = TEST_POINTS[a];
  if (!p) {
    const h = parseInt(crypto.createHash('md5').update(a).digest('hex').slice(0, 6), 16);
    p = [26.0 + (h % 400) / 1000, -80.40 - ((h >> 9) % 50) / 1000];
  }
  return { status: 'OK', results: [{ types: ['street_address'], geometry: { location: { lat: p[0], lng: p[1] } } }] };
}

function makeSheet(name) {
  const grid = [], notes = [];
  const cellGet = (g, r, c) => { const row = g[r] || []; const v = row[c]; return v == null ? '' : v; };
  const cellSet = (g, r, c, v) => { g[r] = g[r] || []; g[r][c] = v; };
  const sheet = {
    name, grid, notes,
    getName: () => sheet.name,
    setName: (n) => { sheet.name = n; },
    getLastRow: () => {
      for (let r = grid.length - 1; r >= 0; r--) if (grid[r] && grid[r].some(v => v !== '' && v != null)) return r + 1;
      return 0;
    },
    getLastColumn: () => {
      let m = 0;
      grid.forEach(row => (row || []).forEach((v, c) => { if (v !== '' && v != null) m = Math.max(m, c + 1); }));
      return m;
    },
    setFrozenRows: () => {},
    getRange: (r, c, nr = 1, nc = 1) => {
      const each = (fn) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) fn(r - 1 + i, c - 1 + j, i, j); };
      const range = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cellGet(grid, r - 1 + i, c - 1 + j))),
        getNotes: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cellGet(notes, r - 1 + i, c - 1 + j))),
        setValues: (vals) => {
          if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('setValues size mismatch');
          each((R, C, i, j) => cellSet(grid, R, C, vals[i][j]));
          return range;
        },
        setNotes: (vals) => {
          if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('setNotes size mismatch');
          each((R, C, i, j) => cellSet(notes, R, C, vals[i][j]));
          return range;
        },
        setValue: (v) => { each((R, C) => cellSet(grid, R, C, v)); return range; },
        clearContent: () => { each((R, C) => cellSet(grid, R, C, '')); return range; },
        clearNote: () => { each((R, C) => cellSet(notes, R, C, '')); return range; },
        setNumberFormat: () => range, setFontWeight: () => range, setDataValidation: () => range,
      };
      return range;
    },
  };
  return sheet;
}

const sheets = [makeSheet('Sheet1')];
if (process.env.OLD_SHEET) { // a sheet made by the first version of the script: four columns, no addresses
  sheets[0].setName('Restaurants');
  sheets[0].getRange(1, 1, 3, 4).setValues([
    ['Restaurant', 'Pink packets?', 'Last updated', 'ID (leave alone)'],
    ['Tap 42', 'Pink', '', 'old-1'],
    ['Las Vegas', 'No', '2026-10-01', 'old-2'],
  ]);
}
const ss = {
  getSheetByName: (n) => sheets.find(s => s.getName() === n) || null,
  getSheets: () => sheets,
  insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
  getUrl: () => 'https://docs.google.com/spreadsheets/d/FAKE/edit',
};
const ctx = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ss,
    newDataValidation: () => { const b = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) }; return b; },
  },
  Maps: {
    newGeocoder: () => { const g = { setRegion: () => g, setBounds: () => g, geocode: fakeGeocode }; return g; },
  },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    formatDate: (d) => d.toISOString().slice(0, 10),
  },
  Session: { getScriptTimeZone: () => 'America/New_York' },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: (s) => { const o = { s, setMimeType: () => o, getContent: () => s }; return o; },
  },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-sheet', 'Code.gs'), 'utf8'), ctx);

const port = Number(process.argv[2] || 8766);
http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const sh = () => ss.getSheetByName('Restaurants');
  if (req.url.startsWith('/_sheet')) {
    res.writeHead(200, cors);
    res.end(JSON.stringify(sh() ? { values: sh().grid, notes: sh().notes, geocodeCalls } : {}));
    return;
  }
  if (req.url.startsWith('/_edit')) { // a row typed into the sheet by hand: name and status only
    const s = sh(); const row = s.getLastRow() + 1;
    s.getRange(row, 1, 1, 2).setValues([['Hand Typed Grill', 'pink']]);
    res.writeHead(200, cors); res.end('{"ok":true}'); return;
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    if (req.method === 'GET') { res.writeHead(200, cors); res.end(ctx.doGet().getContent()); return; }
    if (req.method === 'POST') { res.writeHead(200, cors); res.end(ctx.doPost({ postData: { contents: body } }).getContent()); return; }
    res.writeHead(405, cors); res.end();
  });
}).listen(port, () => console.log('fake google on', port));
