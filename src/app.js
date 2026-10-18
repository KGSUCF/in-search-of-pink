(function () {
  'use strict';

  var KEY = 'inSearchOfPink.v1';
  var SYNC_KEY = 'inSearchOfPink.sync';
  var PEND_KEY = 'inSearchOfPink.pending';
  var SEED = [
    ['Boathouse', 'no'], ['Doc B’s', 'pink'], ['Tap 42', 'pink'], ['YOT', 'no'],
    ['Louie Bossi', 'no'], ['Big City', 'no'], ['Moxies', 'pink'], ['El Camino', 'no'],
    ['YOLO', 'pink'], ['Foxy Brown', 'pink'], ['60 Vines', 'no'], ['Chimney House', 'no'],
    ['Mykonos', 'no'], ['Worthwyld', 'unknown'], ['American Social', 'unknown'],
    ['Blue Moon Fish', 'pink'], ['S3', 'no'], ['Fogo', 'pink'], ['Cheesecake Factory', 'pink'],
    ['Del Frisco’s', 'pink'], ['Carrabba’s', 'pink'], ['Seasons 52', 'no'],
    ['Lobster Bar', 'pink'], ['Kaluz', 'unknown'], ['Las Vegas', 'no']
  ];
  var BADGE = { pink: 'Pink', no: 'No', unknown: '?' };
  var SAY = { pink: 'Pink', no: 'No pink', unknown: 'Not checked' };
  var CHOICES = [
    ['pink', 'Pink packets', 'Sweet’N Low is in the caddy'],
    ['no', 'No pink', 'Only other sweeteners'],
    ['unknown', 'Not checked yet', 'Nobody has looked']
  ];

  var items = [];
  var filter = 'all';
  var undoOps = null;
  var toastTimer = 0;
  var lastFocus = null;
  var sheetOpen = false;
  var prevQuery = '';
  var IS_APP = !!document.querySelector('link[rel="manifest"]');
  var useHistory = (function () { try { return window.top === window.self; } catch (e) { return false; } })();
  var collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

  // Shared list
  var sync = { url: null, sheetUrl: '', last: 0 };
  var syncState = 'off';           // off | busy | ok | offline | error
  var pending = [];
  var syncing = null, syncAgain = false;
  var installEvent = null;

  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }
  var qEl = $('#q'), listEl = $('#list'), emptyEl = $('#empty'), sheetEl = $('#sheet'),
      scrimEl = $('#scrim'), toastEl = $('#toast');

  /* ---------- helpers ---------- */
  function uid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ').replace(/['‘’`´.]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function squash(s) { return norm(s).replace(/ /g, ''); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tidy(s) { return String(s || '').replace(/\s+/g, ' ').trim().replace(/'/g, '’'); }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmt(iso) {
    var p = String(iso).split('-').map(Number);
    if (p.length !== 3 || !p[0]) return '';
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function clock(ms) { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function byId(id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }
  function findByName(name, exceptId) {
    var k = squash(name);
    if (!k) return null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id !== exceptId && squash(items[i].name) === k) return items[i];
    }
    return null;
  }
  function sorted(arr) { return arr.slice().sort(function (a, b) { return collator.compare(a.name, b.name); }); }
  function snap() { return JSON.stringify(items); }
  function copyItem(x) { return { id: x.id, name: x.name, status: x.status, updated: x.updated || null }; }

  /* ---------- storage ---------- */
  function valid(it) {
    return it && typeof it.name === 'string' && it.name.trim() && ['pink', 'no', 'unknown'].indexOf(it.status) > -1;
  }
  function readJSON(key) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function load() {
    var d = readJSON(KEY);
    if (d && Array.isArray(d.items)) {
      return d.items.filter(valid).map(function (it) { var c = copyItem(it); c.id = c.id || uid(); return c; });
    }
    items = SEED.map(function (r) { return { id: uid(), name: r[0], status: r[1], updated: null }; });
    save();
    return items;
  }
  function save() {
    var ok = true;
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, items: items }));
      localStorage.setItem(PEND_KEY, JSON.stringify(pending));
      if (sync.url) localStorage.setItem(SYNC_KEY, JSON.stringify(sync));
      else localStorage.removeItem(SYNC_KEY);
    } catch (e) { ok = false; }
    $('#storageNotice').hidden = ok;
  }
  function loadSync() {
    var s = readJSON(SYNC_KEY), p = readJSON(PEND_KEY);
    if (s && validUrl(s.url)) sync = { url: s.url, sheetUrl: s.sheetUrl || '', last: s.last || 0 };
    pending = (sync.url && Array.isArray(p)) ? p : [];
  }

  /* ---------- list ---------- */
  function packet(s) { return '<span class="packet ' + s + '" aria-hidden="true">' + BADGE[s] + '</span>'; }
  function highlight(name, raw) {
    if (!raw) return esc(name);
    var i = name.toLowerCase().indexOf(raw.toLowerCase());
    if (i < 0) return esc(name);
    return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + raw.length)) + '</mark>' + esc(name.slice(i + raw.length));
  }
  function matches(it, nq, sq) {
    if (!nq) return true;
    var n = norm(it.name);
    return n.indexOf(nq) > -1 || n.replace(/ /g, '').indexOf(sq) > -1;
  }

  function render() {
    var counts = { all: items.length, pink: 0, no: 0, unknown: 0 };
    items.forEach(function (it) { counts[it.status]++; });
    $$('[data-n]').forEach(function (b) { b.textContent = counts[b.getAttribute('data-n')]; });
    $$('.chip').forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-f') === filter)); });

    var raw = qEl.value.trim(), nq = norm(raw), sq = nq.replace(/ /g, '');
    $('#clearQ').hidden = !raw;

    var shown = sorted(items.filter(function (it) {
      return (filter === 'all' || it.status === filter) && matches(it, nq, sq);
    }));
    listEl.innerHTML = shown.map(function (it) {
      return '<li><button class="row" type="button" data-id="' + esc(it.id) + '" aria-label="' +
        esc(it.name) + ': ' + SAY[it.status] + '"><span class="name">' + highlight(it.name, raw) +
        '</span>' + packet(it.status) + '</button></li>';
    }).join('');

    renderSyncLine();
    if (shown.length) { emptyEl.hidden = true; emptyEl.innerHTML = ''; return; }
    emptyEl.hidden = false;
    if (raw) {
      var elsewhere = items.some(function (it) { return matches(it, nq, sq); });
      emptyEl.innerHTML = (elsewhere && filter !== 'all')
        ? '<p>No match under <strong>' + SAY[filter] + '</strong>.</p><button class="btn quiet" type="button" data-act="showall">Search all restaurants</button>'
        : '<p><strong>' + esc(raw) + '</strong> isn’t on the list yet.</p><button class="btn" type="button" data-act="addq">Add “' + esc(tidy(raw)) + '”</button>';
    } else if (!items.length) {
      emptyEl.innerHTML = '<p>The list is empty. Tap <strong>Add restaurant</strong> to start it.</p>';
    } else if (filter === 'unknown') {
      emptyEl.innerHTML = '<p>Every restaurant on the list has been checked.</p>';
    } else {
      emptyEl.innerHTML = '<p>No restaurants in this group yet.</p>';
    }
  }

  /* ---------- changes: diff into operations the shared list understands ---------- */
  function setOp(it) { return { op: 'set', id: it.id, name: it.name, status: it.status, updated: it.updated || null }; }
  function diffOps(fromArr, toArr) {
    var from = {}, to = {}, ops = [];
    fromArr.forEach(function (x) { from[x.id] = x; });
    toArr.forEach(function (x) { to[x.id] = x; });
    toArr.forEach(function (x) {
      var o = from[x.id];
      if (!o || o.name !== x.name || o.status !== x.status) ops.push(setOp(x));
    });
    fromArr.forEach(function (x) { if (!to[x.id]) ops.push({ op: 'delete', id: x.id }); });
    return ops;
  }
  // Mirrors the Google Sheet script, so the phone shows what the shared list will hold.
  function applyOps(list, ops) {
    list = list.map(copyItem);
    ops.forEach(function (op) {
      if (!op) return;
      if (op.op === 'delete') { list = list.filter(function (x) { return x.id !== op.id; }); return; }
      if (op.op !== 'set' || !op.name) return;
      var it = null, sameId = false, i;
      for (i = 0; i < list.length && !it; i++) if (list[i].id === op.id) { it = list[i]; sameId = true; }
      for (i = 0; i < list.length && !it; i++) if (squash(list[i].name) === squash(op.name)) it = list[i];
      if (!it) { it = { id: op.id, name: op.name, updated: null }; list.push(it); }
      else if (sameId) it.name = op.name;
      it.status = op.status;
      if (op.updated) it.updated = op.updated;
    });
    return list;
  }
  function commit(msg, beforeJSON) {
    var before = JSON.parse(beforeJSON);
    var ops = diffOps(before, items);
    var inverse = diffOps(items, before);
    if (sync.url && ops.length) pending = pending.concat(ops);
    save();
    render();
    showToast(msg, inverse.length ? inverse : null);
    if (ops.length) runSync();
  }

  /* ---------- toast + undo ---------- */
  function showToast(msg, ops) {
    undoOps = ops || null;
    $('#toastMsg').textContent = msg;
    $('#toastUndo').hidden = !undoOps;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undoOps ? 6500 : 3000);
  }
  function hideToast() { toastEl.hidden = true; undoOps = null; }
  $('#toastUndo').addEventListener('click', function () {
    if (undoOps) {
      var ops = undoOps;
      items = applyOps(items, ops);
      if (sync.url) pending = pending.concat(ops);
      save();
      render();
      runSync();
    }
    showToast('Change undone.', null);
  });

  /* ---------- shared list: talking to the Google Sheet ---------- */
  function validUrl(u) {
    u = String(u || '').trim();
    if (/^https:\/\/script\.google\.com\/(a\/[^/\s]+\/)?macros\/s\/[\w-]+\/exec\/?$/.test(u)) return true;
    var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    return local && /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(u);
  }
  function api(url, ops) {
    var opts = { redirect: 'follow', cache: 'no-store' }, target = url;
    if (ops) {
      opts.method = 'POST';
      opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
      opts.body = JSON.stringify({ ops: ops });
    } else {
      opts.method = 'GET';
      target = url + (url.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
    }
    var timer = 0;
    if (window.AbortController) {
      var ctrl = new AbortController();
      opts.signal = ctrl.signal;
      timer = setTimeout(function () { ctrl.abort(); }, 25000);
    }
    return fetch(target, opts).then(function (r) {
      if (!r.ok) throw new Error('status ' + r.status);
      return r.json();
    }).then(function (d) {
      clearTimeout(timer);
      if (!d || !d.ok || !Array.isArray(d.items)) throw new Error((d && d.error) || 'unexpected reply');
      return d;
    }, function (e) { clearTimeout(timer); throw e; });
  }
  function adopt(d) {
    items = applyOps(d.items.filter(valid), pending);
    if (d.sheetUrl) sync.sheetUrl = d.sheetUrl;
    sync.last = Date.now();
  }
  function runSync() {
    if (!sync.url) return Promise.resolve();
    if (syncing) { syncAgain = true; return syncing; }
    var url = sync.url, sent = pending.slice();
    setSyncState('busy');
    syncing = api(url, sent.length ? sent : null).then(function (d) {
      if (sync.url !== url) return;
      pending = pending.slice(sent.length);
      adopt(d);
      save();
      setSyncState('ok');
      render();
    }).catch(function () {
      if (sync.url !== url) return;
      setSyncState(navigator.onLine === false ? 'offline' : 'error');
    }).then(function () {
      syncing = null;
      if (syncAgain) { syncAgain = false; return runSync(); }
    });
    return syncing;
  }
  // First connection: an empty sheet gets this phone's list; otherwise the shared list wins,
  // and anything added or changed only on this phone that the sheet lacks is added to it.
  function connect(url) {
    url = String(url).trim().replace(/\/$/, '');
    return api(url, null).then(function (d) {
      var server = d.items.filter(valid);
      var ops = server.length
        ? items.filter(function (it) {
            return it.updated && !server.some(function (s) { return squash(s.name) === squash(it.name); });
          }).map(setOp)
        : items.map(setOp);
      return (ops.length ? api(url, ops) : Promise.resolve(d)).then(function (d2) {
        sync = { url: url, sheetUrl: d2.sheetUrl || '', last: Date.now() };
        pending = [];
        adopt(d2);
        save();
        setSyncState('ok');
        render();
        return { started: !server.length, added: server.length ? ops.length : 0, total: items.length };
      });
    });
  }
  function disconnect() {
    sync = { url: null, sheetUrl: '', last: 0 };
    pending = [];
    save();
    setSyncState('off');
    render();
  }
  function inviteLink() {
    return location.origin + location.pathname + '#join=' + encodeURIComponent(sync.url);
  }
  function setSyncState(s) { syncState = s; renderSyncLine(); }
  function syncSummary() {
    var n = pending.length, waiting = n ? n + ' change' + (n === 1 ? '' : 's') + ' will sync when it connects' : '';
    if (syncState === 'busy') return 'Syncing…';
    if (syncState === 'ok') return 'Shared list · up to date ' + clock(sync.last);
    if (syncState === 'offline') return 'No connection · ' + (waiting || 'showing the last copy');
    if (syncState === 'error') return 'Can’t reach the shared list · ' + (waiting || 'tap to try again');
    return 'On this phone only · Share with another phone';
  }
  function sheetStateText() {
    var n = pending.length, waiting = n ? ' ' + n + ' change' + (n === 1 ? '' : 's') + ' will sync when it connects.' : '';
    if (syncState === 'busy') return 'Syncing\u2026';
    if (syncState === 'ok') return 'Up to date as of ' + clock(sync.last) + '.';
    if (syncState === 'offline') return 'No connection right now.' + waiting;
    return 'Can\u2019t reach the Google Sheet right now.' + waiting;
  }
  function renderSyncLine() {
    var line = $('#syncLine');
    if (!IS_APP) { line.hidden = true; return; }
    if (!sync.url) syncState = 'off';
    line.hidden = false;
    line.setAttribute('data-state', syncState);
    $('#syncText').textContent = syncSummary();
  }

  /* ---------- sheet ---------- */
  function openSheet(html, focusSel) {
    if (!sheetOpen) lastFocus = document.activeElement;
    hideToast();
    sheetEl.innerHTML = '<div class="sheet-inner"><div class="grab" aria-hidden="true"></div>' + html + '</div>';
    sheetEl.hidden = false;
    scrimEl.hidden = false;
    sheetEl.scrollTop = 0;
    if (!sheetOpen && useHistory) { try { history.pushState({ pinkSheet: 1 }, ''); } catch (e) {} }
    sheetOpen = true;
    document.body.style.overflow = 'hidden';
    var f = $(focusSel || 'h2', sheetEl);
    if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
  }
  function closeSheet(fromPop) {
    if (!sheetOpen) return;
    sheetOpen = false;
    sheetEl.hidden = true;
    scrimEl.hidden = true;
    sheetEl.innerHTML = '';
    document.body.style.overflow = '';
    if (!fromPop && useHistory && history.state && history.state.pinkSheet) { try { history.back(); } catch (e) {} }
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
    }
  }
  window.addEventListener('popstate', function () { if (sheetOpen) closeSheet(true); });

  function choicesHtml(current) {
    return '<fieldset><div class="legend" id="choiceLabel">Pink packets in the caddy?</div>' +
      '<div class="choices" role="group" aria-labelledby="choiceLabel">' +
      CHOICES.map(function (c) {
        var on = current === c[0];
        return '<button type="button" class="choice" data-status="' + c[0] + '" aria-pressed="' + on + '">' +
          packet(c[0]) + '<span class="what">' + c[1] + '<small>' + c[2] + '</small></span>' +
          (on ? '<span class="now">Now</span>' : '') + '</button>';
      }).join('') + '</div></fieldset>';
  }
  function gone() { closeSheet(); showToast('That restaurant was just removed on another phone.', null); }

  /* Add */
  function openAdd(prefill) {
    openSheet(
      '<h2 id="sheetTitle" tabindex="-1">Add a restaurant</h2>' +
      '<div class="field"><label for="fName">Restaurant name</label>' +
      '<input id="fName" type="text" autocomplete="off" autocapitalize="words" enterkeyhint="done" value="' + esc(prefill || '') + '"></div>' +
      '<p id="addMsg" class="warn" hidden></p>' +
      choicesHtml(null) +
      '<p class="hint">Tap an answer to save it.</p>' +
      '<div><button type="button" class="link" data-act="close">Cancel</button></div>',
      prefill ? 'h2' : '#fName'
    );
    var input = $('#fName', sheetEl), msg = $('#addMsg', sheetEl);
    function check() {
      var d = findByName(input.value);
      if (d) {
        msg.hidden = false;
        msg.innerHTML = esc(d.name) + ' is already on the list (' + SAY[d.status] + '). Picking an answer below updates it. ' +
          '<button type="button" class="link" data-act="edit" data-id="' + esc(d.id) + '">Open it instead</button>';
      } else { msg.hidden = true; }
    }
    input.addEventListener('input', check);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    check();
    $$('.choice', sheetEl).forEach(function (b) {
      b.addEventListener('click', function () {
        var name = tidy(input.value), status = b.getAttribute('data-status');
        if (!name) {
          msg.hidden = false;
          msg.textContent = 'Type the restaurant’s name first.';
          input.focus();
          return;
        }
        var before = snap(), d = findByName(name);
        if (d) {
          if (d.status !== status) { d.status = status; d.updated = todayISO(); }
          closeSheet();
          commit(d.name + ' is marked ' + SAY[status] + '.', before);
          return;
        }
        items.push({ id: uid(), name: name, status: status, updated: todayISO() });
        filter = 'all';
        closeSheet();
        commit('Added ' + name + ' (' + SAY[status] + ').', before);
      });
    });
  }

  /* Edit */
  function openEdit(id) {
    var it = byId(id);
    if (!it) return;
    openSheet(
      '<h2 id="sheetTitle" tabindex="-1">' + esc(it.name) + '</h2>' +
      '<p class="meta">' + (it.updated ? 'Last updated ' + fmt(it.updated) : 'From the original list') + '</p>' +
      choicesHtml(it.status) +
      '<div class="field"><label for="fName">Fix the name</label><div class="inline">' +
      '<input id="fName" type="text" autocomplete="off" autocapitalize="words" enterkeyhint="done" value="' + esc(it.name) + '">' +
      '<button type="button" class="btn" id="renameBtn" disabled>Save</button></div></div>' +
      '<p id="renameMsg" class="warn" hidden></p>' +
      '<div id="delArea"><button type="button" class="link danger" id="delBtn">Remove from the list</button></div>' +
      '<div class="actions"><button type="button" class="btn quiet" data-act="close">Done</button></div>'
    );
    $$('.choice', sheetEl).forEach(function (b) {
      b.addEventListener('click', function () {
        var cur = byId(id), status = b.getAttribute('data-status');
        if (!cur) { gone(); return; }
        if (status === cur.status) { closeSheet(); return; }
        var before = snap();
        cur.status = status;
        cur.updated = todayISO();
        closeSheet();
        commit(cur.name + ' is now ' + SAY[status] + '.', before);
      });
    });
    var input = $('#fName', sheetEl), btn = $('#renameBtn', sheetEl), msg = $('#renameMsg', sheetEl);
    function check() {
      var cur = byId(id) || it, name = tidy(input.value), clash = findByName(name, id);
      btn.disabled = !name || name === cur.name || !!clash;
      msg.hidden = !clash;
      if (clash) msg.textContent = clash.name + ' is already on the list.';
    }
    function rename() {
      if (btn.disabled) return;
      var cur = byId(id);
      if (!cur) { gone(); return; }
      var before = snap(), name = tidy(input.value);
      cur.name = name;
      cur.updated = todayISO();
      closeSheet();
      commit('Renamed to ' + name + '.', before);
    }
    input.addEventListener('input', check);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); rename(); } });
    btn.addEventListener('click', rename);
    var area = $('#delArea', sheetEl);
    function askDelete() {
      area.innerHTML = '<div class="confirm"><p>Remove <strong>' + esc(it.name) + '</strong> from the list?</p>' +
        '<div class="actions"><button type="button" class="btn" id="delYes">Remove</button>' +
        '<button type="button" class="btn quiet" id="delNo">Keep it</button></div></div>';
      $('#delYes', area).addEventListener('click', function () {
        var cur = byId(id);
        if (!cur) { gone(); return; }
        var before = snap(), name = cur.name;
        items = items.filter(function (x) { return x.id !== id; });
        closeSheet();
        commit('Removed ' + name + '.', before);
      });
      $('#delNo', area).addEventListener('click', function () {
        area.innerHTML = '<button type="button" class="link danger" id="delBtn">Remove from the list</button>';
        $('#delBtn', area).addEventListener('click', askDelete);
        $('#delBtn', area).focus();
      });
      $('#delYes', area).focus();
    }
    $('#delBtn', area).addEventListener('click', askDelete);
  }

  /* Menu */
  var ICON_SYNC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/></svg>';
  var ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  var ICON_IMPORT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  function openMenu() {
    openSheet(
      '<h2 id="sheetTitle" tabindex="-1">The list</h2>' +
      '<p class="meta">' + items.length + ' restaurants' + (sync.url ? ', shared' : ' saved on this phone') + '</p>' +
      '<div>' +
      (IS_APP ? '<button type="button" class="menu-item" data-act="shared">' + ICON_SYNC +
        '<span>' + (sync.url ? 'Shared list' : 'Share with another phone') +
        '<small>' + (sync.url ? 'Invite a phone, sync now, open the spreadsheet' : 'One list for both phones, kept in a Google Sheet') + '</small></span></button>' : '') +
      '<button type="button" class="menu-item" data-act="share">' + ICON_SHARE +
      '<span>Send the list as text<small>For a text message, or a backup copy</small></span></button>' +
      '<button type="button" class="menu-item" data-act="import">' + ICON_IMPORT +
      '<span>Import a list<small>Paste a list sent from this app</small></span></button></div>' +
      '<div class="actions"><button type="button" class="btn quiet" data-act="close">Close</button></div>'
    );
  }

  /* Copy helper shared by the text-list and invite sheets */
  function wireCopy(text, ta, out, okMsg) {
    function selectAll() { ta.focus(); ta.select(); try { ta.setSelectionRange(0, text.length); } catch (e) {} }
    function fallback() {
      selectAll();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      out.textContent = ok ? okMsg : 'The text is selected. Use your phone’s Copy.';
    }
    return function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { out.textContent = okMsg; }, fallback);
      } else { fallback(); }
    };
  }

  /* Shared list */
  function openShared(note) {
    if (!IS_APP) return;
    if (!sync.url) {
      openSheet(
        '<h2 id="sheetTitle" tabindex="-1">Share with another phone</h2>' +
        '<p class="meta">Keep one list for both phones. It lives in a Google Sheet you own, and a change on either phone shows up on the other.</p>' +
        '<p class="hint">Got an invite link from someone? Open that link in Chrome instead; it connects this phone for you.</p>' +
        '<div class="field"><label for="syncUrl">Web app link from Google</label>' +
        '<input id="syncUrl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></div>' +
        '<p id="syncMsg" class="warn"' + (note ? '' : ' hidden') + '>' + esc(note || '') + '</p>' +
        '<div class="actions"><button type="button" class="btn" id="connectBtn" disabled>Connect</button>' +
        '<button type="button" class="btn quiet" data-act="close">Not now</button></div>' +
        '<details class="steps"><summary>How to get the link (about 10 minutes, on a computer)</summary><ol>' +
        '<li>Create a new Google Sheet and name it <b>In Search of Pink</b>.</li>' +
        '<li>Choose <b>Extensions › Apps Script</b>. Delete what’s there, paste in the script from the <b>google-sheet</b> folder of your GitHub repository, and click Save.</li>' +
        '<li>Click <b>Deploy › New deployment</b>, pick <b>Web app</b>, set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>, then Deploy.</li>' +
        '<li>Allow access when Google asks. It warns that the app isn’t verified because you wrote it yourself: choose <b>Advanced</b>, then <b>Go to</b> the project.</li>' +
        '<li>Copy the <b>Web app URL</b>, email it to yourself, and paste it above.</li></ol></details>',
        null
      );
      var input = $('#syncUrl', sheetEl), btn = $('#connectBtn', sheetEl), msg = $('#syncMsg', sheetEl);
      input.addEventListener('input', function () {
        var v = input.value.trim();
        btn.disabled = !v;
        if (v && !validUrl(v) && /\/dev\/?$/.test(v)) { msg.hidden = false; msg.textContent = 'That is the test link. Use the Web app URL that ends in /exec.'; }
        else msg.hidden = true;
      });
      btn.addEventListener('click', function () {
        var v = input.value.trim();
        if (!validUrl(v)) {
          msg.hidden = false;
          msg.textContent = 'That doesn’t look like the Web app link. It starts with https://script.google.com/macros/s/ and ends in /exec.';
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Connecting…';
        connect(v).then(function (r) {
          openSharedConnected(r.started
            ? 'The shared list is set up with ' + r.total + ' restaurants. Now invite the other phone.'
            : 'Connected. This phone now shows the shared list.' + (r.added ? ' ' + r.added + ' restaurant' + (r.added === 1 ? '' : 's') + ' from this phone were added to it.' : ''));
        }, function () {
          btn.disabled = false;
          btn.textContent = 'Connect';
          msg.hidden = false;
          msg.textContent = 'Couldn’t reach the shared list at that link. Check that you copied the whole Web app URL and that “Who has access” is set to Anyone.';
        });
      });
      return;
    }
    openSharedConnected();
  }
  function openSharedConnected(note) {
    var link = inviteLink(), canShare = typeof navigator.share === 'function';
    openSheet(
      '<h2 id="sheetTitle" tabindex="-1">Shared list</h2>' +
      '<p class="meta" id="sharedState">' + esc(sheetStateText()) + '</p>' +
      (note ? '<p class="good">' + esc(note) + '</p>' : '') +
      '<div class="field"><label for="inviteText">Invite another phone</label>' +
      '<textarea id="inviteText" class="short" readonly rows="3">' + esc(link) + '</textarea></div>' +
      '<p class="hint">Send this link to the other phone. Opening it in Chrome connects that phone; then use Chrome’s menu to install the app. Anyone with the link can change the list, so only send it to people you trust with it.</p>' +
      '<div class="actions">' + (canShare ? '<button type="button" class="btn" id="sendInvite">Send…</button>' : '') +
      '<button type="button" class="btn' + (canShare ? ' quiet' : '') + '" id="copyInvite">Copy link</button></div>' +
      '<p class="hint" id="inviteMsg" role="status"></p>' +
      '<div class="actions"><button type="button" class="btn quiet" id="syncNow">Sync now</button>' +
      (sync.sheetUrl ? '<a class="btn quiet" href="' + esc(sync.sheetUrl) + '" target="_blank" rel="noopener">Open the sheet</a>' : '') + '</div>' +
      '<div id="stopArea"><button type="button" class="link danger" id="stopBtn">Stop sharing on this phone</button></div>' +
      '<div><button type="button" class="link" data-act="close">Close</button></div>'
    );
    var ta = $('#inviteText', sheetEl), out = $('#inviteMsg', sheetEl);
    $('#copyInvite', sheetEl).addEventListener('click', wireCopy(link, ta, out, 'Link copied. Paste it into a text to the other phone.'));
    if (canShare) {
      $('#sendInvite', sheetEl).addEventListener('click', function () {
        navigator.share({ title: 'In Search of Pink', text: 'Join our pink-packet list: open this in Chrome, then install the app.', url: link })
          .catch(function (e) { if (!e || e.name !== 'AbortError') out.textContent = 'Sending didn’t work here. Use Copy link instead.'; });
      });
    }
    $('#syncNow', sheetEl).addEventListener('click', function () {
      var state = $('#sharedState', sheetEl);
      state.textContent = 'Syncing…';
      runSync().then(function () { if (state.isConnected) state.textContent = sheetStateText(); });
    });
    var area = $('#stopArea', sheetEl);
    $('#stopBtn', sheetEl).addEventListener('click', function () {
      var n = pending.length;
      area.innerHTML = '<div class="confirm"><p>Stop sharing on this phone? The list stays on this phone but stops updating.' +
        (n ? ' <strong>' + n + ' change' + (n === 1 ? ' hasn’t' : 's haven’t') + ' reached the shared list yet</strong> and will stay only on this phone.' : '') +
        '</p><div class="actions"><button type="button" class="btn" id="stopYes">Stop sharing</button>' +
        '<button type="button" class="btn quiet" id="stopNo">Keep sharing</button></div></div>';
      $('#stopYes', area).addEventListener('click', function () { disconnect(); closeSheet(); showToast('This phone has stopped sharing.', null); });
      $('#stopNo', area).addEventListener('click', function () { openSharedConnected(); });
    });
  }

  /* Text list */
  function shareText() {
    var groups = { pink: [], no: [], unknown: [] };
    sorted(items).forEach(function (it) { groups[it.status].push(it.name); });
    var out = 'In Search of Pink (' + fmt(todayISO()) + ')\nSweet’N Low in the sugar caddy, Fort Lauderdale\n';
    [['pink', 'PINK'], ['no', 'NO PINK'], ['unknown', 'NOT CHECKED']].forEach(function (g) {
      if (groups[g[0]].length) out += '\n' + g[1] + '\n' + groups[g[0]].join('\n') + '\n';
    });
    return out.trim();
  }
  function openShare() {
    var text = shareText();
    var canShare = typeof navigator.share === 'function';
    openSheet(
      '<h2 id="sheetTitle" tabindex="-1">Send the list as text</h2>' +
      '<p class="meta">Send it in a text or email, or keep it as a backup. Import copies it into the app on another phone.</p>' +
      '<div class="field"><label for="shareText">The list as text</label>' +
      '<textarea id="shareText" readonly rows="12">' + esc(text) + '</textarea></div>' +
      '<div class="actions">' + (canShare ? '<button type="button" class="btn" id="sendBtn">Send…</button>' : '') +
      '<button type="button" class="btn' + (canShare ? ' quiet' : '') + '" id="copyBtn">Copy</button></div>' +
      '<p class="hint" id="shareMsg" role="status"></p>' +
      '<div><button type="button" class="link" data-act="close">Close</button></div>'
    );
    var ta = $('#shareText', sheetEl), out = $('#shareMsg', sheetEl);
    $('#copyBtn', sheetEl).addEventListener('click', wireCopy(text, ta, out, 'Copied. Paste it into a text or email.'));
    if (canShare) {
      $('#sendBtn', sheetEl).addEventListener('click', function () {
        navigator.share({ title: 'In Search of Pink', text: text }).catch(function (e) {
          if (!e || e.name !== 'AbortError') out.textContent = 'Sending didn’t work here. Use Copy instead.';
        });
      });
    }
  }

  /* Import */
  function statusWord(w) {
    w = norm(w);
    if (w === 'pink' || w === 'yes' || w === 'has pink') return 'pink';
    if (w === 'no' || w === 'no pink' || w === 'none') return 'no';
    if (w === 'not checked' || w === 'not checked yet' || w === 'unknown' || w === '') return 'unknown';
    return null;
  }
  function parseList(text) {
    var out = [], current = null;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var t = line.replace(/ /g, ' ').trim();
      if (!t) return;
      var h = norm(t);
      if (/^in search of pink/.test(h) || /^sweet ?n low in the/.test(h)) return;
      var header = statusWord(t.replace(/:$/, ''));
      if (header && h) { current = header; return; }
      t = t.replace(/^[-•*·]\s+/, '').replace(/^\d+[.)]\s+/, '');
      var status = current;
      if (!current) {
        var m = t.match(/^(.*?)[\s\-–—:,|]+(no pink|not checked|pink|yes|no|\?)\s*$/i);
        if (m && m[1].trim()) { t = m[1]; status = m[2] === '?' ? 'unknown' : statusWord(m[2]); }
      }
      var name = tidy(t.replace(/[.\s]+$/, ''));
      if (name && norm(name)) out.push({ name: name, status: status || 'unknown' });
    });
    return out;
  }
  function openImport() {
    openSheet(
      '<h2 id="sheetTitle" tabindex="-1">Import a list</h2>' +
      '<p class="meta">Paste a list sent from this app. Restaurants you already have get their answer updated, new ones are added, and nothing is removed.</p>' +
      '<div class="field"><label for="importText">Paste the list here</label>' +
      '<textarea id="importText" rows="10" placeholder="PINK&#10;Doc B’s&#10;Tap 42&#10;&#10;NO PINK&#10;Boathouse"></textarea></div>' +
      '<p class="hint" id="importMsg" role="status">Nothing pasted yet.</p>' +
      '<div class="actions"><button type="button" class="btn" id="doImport" disabled>Import</button>' +
      '<button type="button" class="btn quiet" data-act="close">Cancel</button></div>',
      '#importText'
    );
    var ta = $('#importText', sheetEl), out = $('#importMsg', sheetEl), btn = $('#doImport', sheetEl);
    function preview() {
      var parsed = parseList(ta.value), c = { pink: 0, no: 0, unknown: 0 };
      parsed.forEach(function (p) { c[p.status]++; });
      btn.disabled = !parsed.length;
      out.textContent = parsed.length
        ? 'Found ' + parsed.length + ' restaurant' + (parsed.length === 1 ? '' : 's') + ': ' + c.pink + ' pink, ' + c.no + ' no pink, ' + c.unknown + ' not checked.'
        : (ta.value.trim() ? 'No restaurants found in that text.' : 'Nothing pasted yet.');
    }
    ta.addEventListener('input', preview);
    btn.addEventListener('click', function () {
      var parsed = parseList(ta.value), before = snap(), added = 0, changed = 0;
      parsed.forEach(function (p) {
        var ex = findByName(p.name);
        if (ex) {
          if (p.status !== 'unknown' && ex.status !== p.status) { ex.status = p.status; ex.updated = todayISO(); changed++; }
        } else {
          items.push({ id: uid(), name: p.name, status: p.status, updated: todayISO() });
          added++;
        }
      });
      closeSheet();
      if (!added && !changed) { showToast('Your list already matches.', null); return; }
      filter = 'all';
      commit('Imported: ' + added + ' added, ' + changed + ' updated.', before);
    });
  }

  /* ---------- events ---------- */
  listEl.addEventListener('click', function (e) {
    var row = e.target.closest('.row');
    if (row) openEdit(row.getAttribute('data-id'));
  });
  emptyEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'showall') { filter = 'all'; render(); }
    if (act === 'addq') openAdd(tidy(qEl.value));
  });
  sheetEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'close') closeSheet();
    else if (act === 'share') openShare();
    else if (act === 'import') openImport();
    else if (act === 'shared') openShared();
    else if (act === 'edit') openEdit(b.getAttribute('data-id'));
  });
  scrimEl.addEventListener('click', function () { closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheetOpen) closeSheet(); });

  $('#filters').addEventListener('click', function (e) {
    var c = e.target.closest('.chip');
    if (!c) return;
    filter = c.getAttribute('data-f');
    render();
  });
  qEl.addEventListener('input', function () {
    var v = qEl.value.trim();
    if (v && !prevQuery) filter = 'all';
    prevQuery = v;
    render();
  });
  qEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); qEl.blur(); } });
  $('#clearQ').addEventListener('click', function () { qEl.value = ''; prevQuery = ''; render(); qEl.focus(); });
  $('#addBtn').addEventListener('click', function () { openAdd(''); });
  $('#menuBtn').addEventListener('click', openMenu);
  $('#syncLine').addEventListener('click', function () {
    if (sync.url && (syncState === 'error' || syncState === 'offline')) runSync();
    openShared();
  });

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvent = e;
    $('#installBtn').hidden = false;
  });
  window.addEventListener('appinstalled', function () { $('#installBtn').hidden = true; installEvent = null; });
  $('#installBtn').addEventListener('click', function () {
    if (!installEvent) return;
    installEvent.prompt();
    installEvent.userChoice.then(function () { installEvent = null; $('#installBtn').hidden = true; }, function () {});
  });

  /* ---------- start ---------- */
  items = load();
  loadSync();
  if (sync.url) syncState = navigator.onLine === false ? 'offline' : 'busy';
  render();

  function joinFromLink() {
    var h = location.hash;
    if (h.indexOf('#join=') !== 0) return null;
    var u = '';
    try { u = decodeURIComponent(h.slice(6)); } catch (e) {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    return validUrl(u) ? u.replace(/\/$/, '') : '';
  }
  function handleJoin() {
    var join = IS_APP ? joinFromLink() : null;
    if (join === '') {
      showToast('That invite link is incomplete. Ask for it again.', null);
      runSync();
    } else if (join && join !== sync.url) {
      closeSheet();
      setSyncState('busy');
      connect(join).then(function (r) {
        showToast(r.started ? 'The shared list is set up.' : 'You’re on the shared list.', null);
      }, function () {
        setSyncState(sync.url ? 'error' : 'off');
        openShared('Couldn’t reach the shared list from that invite link. Check your connection, then open the link again.');
      });
    } else {
      runSync();
    }
  }
  handleJoin();
  // An invite link opened while the app is already showing arrives as a hash change, not a new page.
  window.addEventListener('hashchange', function () { if (location.hash.indexOf('#join=') === 0) handleJoin(); });

  if (IS_APP) {
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') runSync(); });
    window.addEventListener('online', function () { runSync(); });
    window.addEventListener('offline', function () { if (sync.url) setSyncState('offline'); });
    setInterval(function () { if (document.visibilityState === 'visible') runSync(); }, 45000);
  }

  var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (IS_APP && secure && 'serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
  }
  if (IS_APP) {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
  }

  window.__pink = {
    parseList: parseList,
    get items() { return items; },
    get pending() { return pending; },
    get state() { return syncState; },
    sync: runSync
  };
})();
