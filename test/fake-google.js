// Runs the real Code.gs under small stand-ins for Google's Sheets services, served over HTTP.
// Used only for testing the app's syncing. Usage: node fake-google.js <port>
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(name) {
  const grid = []; // array of row arrays
  const sheet = {
    name, grid,
    getName: () => sheet.name,
    setName: (n) => { sheet.name = n; },
    getLastRow: () => {
      for (let r = grid.length - 1; r >= 0; r--) if (grid[r] && grid[r].some(v => v !== '' && v != null)) return r + 1;
      return 0;
    },
    setFrozenRows: () => {},
    getRange: (r, c, nr = 1, nc = 1) => {
      const range = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
          const row = grid[r - 1 + i] || []; const v = row[c - 1 + j]; return v == null ? '' : v;
        })),
        setValues: (vals) => {
          if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('setValues size mismatch');
          vals.forEach((row, i) => row.forEach((v, j) => {
            grid[r - 1 + i] = grid[r - 1 + i] || []; grid[r - 1 + i][c - 1 + j] = v;
          }));
          return range;
        },
        setValue: (v) => range.setValues([[v]]),
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { if (grid[r - 1 + i]) grid[r - 1 + i][c - 1 + j] = ''; } return range; },
        setNumberFormat: () => range, setFontWeight: () => range, setDataValidation: () => range,
      };
      return range;
    },
  };
  return sheet;
}

const sheets = [makeSheet('Sheet1')];
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
let failNext = 0;
http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.url.startsWith('/_sheet')) { res.writeHead(200, cors); res.end(JSON.stringify(ss.getSheetByName('Restaurants') ? ss.getSheetByName('Restaurants').grid : [])); return; }
  if (req.url.startsWith('/_edit')) { // simulate a hand edit in the spreadsheet: append a row with no id
    const sh = ss.getSheetByName('Restaurants'); const row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, 2).setValues([['Hand Typed Grill', 'pink']]);
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
