(function () {
  'use strict';

  var KEY = 'inSearchOfPink.v1';
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
  var undoSnap = null;
  var toastTimer = 0;
  var lastFocus = null;
  var sheetOpen = false;
  var prevQuery = '';
  var useHistory = (function () { try { return window.top === window.self; } catch (e) { return false; } })();
  var collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }
  var qEl = $('#q'), listEl = $('#list'), emptyEl = $('#empty'), sheetEl = $('#sheet'),
      scrimEl = $('#scrim'), toastEl = $('#toast');

  /* ---------- helpers ---------- */
  function uid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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

  /* ---------- storage ---------- */
  function valid(it) {
    return it && typeof it.name === 'string' && it.name.trim() && ['pink', 'no', 'unknown'].indexOf(it.status) > -1;
  }
  function load() {
    var stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) {}
    if (stored) {
      try {
        var d = JSON.parse(stored);
        if (d && Array.isArray(d.items)) {
          return d.items.filter(valid).map(function (it) {
            return { id: it.id || uid(), name: it.name, status: it.status, updated: it.updated || null };
          });
        }
      } catch (e) {}
    }
    var fresh = SEED.map(function (r) { return { id: uid(), name: r[0], status: r[1], updated: null }; });
    items = fresh;
    save();
    return fresh;
  }
  function save() {
    var ok = true;
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, items: items })); } catch (e) { ok = false; }
    $('#storageNotice').hidden = ok;
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

  /* ---------- toast + undo ---------- */
  function showToast(msg, before) {
    undoSnap = before || null;
    $('#toastMsg').textContent = msg;
    $('#toastUndo').hidden = !undoSnap;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undoSnap ? 6500 : 2500);
  }
  function hideToast() { toastEl.hidden = true; undoSnap = null; }
  function commit(msg, before) { save(); render(); showToast(msg, before); }
  $('#toastUndo').addEventListener('click', function () {
    if (undoSnap) { items = JSON.parse(undoSnap); save(); render(); }
    showToast('Change undone.', null);
  });

  /* ---------- sheet ---------- */
  function openSheet(html, focusSel) {
    if (!sheetOpen) lastFocus = document.activeElement;
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
        var status = b.getAttribute('data-status');
        if (status === it.status) { closeSheet(); return; }
        var before = snap();
        it.status = status;
        it.updated = todayISO();
        closeSheet();
        commit(it.name + ' is now ' + SAY[status] + '.', before);
      });
    });
    var input = $('#fName', sheetEl), btn = $('#renameBtn', sheetEl), msg = $('#renameMsg', sheetEl);
    function check() {
      var name = tidy(input.value), clash = findByName(name, it.id);
      btn.disabled = !name || name === it.name || !!clash;
      msg.hidden = !clash;
      if (clash) msg.textContent = clash.name + ' is already on the list.';
    }
    function rename() {
      if (btn.disabled) return;
      var before = snap(), name = tidy(input.value);
      it.name = name;
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
        var before = snap(), name = it.name;
        items = items.filter(function (x) { return x.id !== it.id; });
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
  var ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  var ICON_IMPORT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  function openMenu() {
    openSheet(
      '<h2 id="sheetTitle" tabindex="-1">The list</h2>' +
      '<p class="meta">' + items.length + ' restaurants saved on this phone</p>' +
      '<div><button type="button" class="menu-item" data-act="share">' + ICON_SHARE +
      '<span>Share the list<small>Send it in a text, or keep a copy as a backup</small></span></button>' +
      '<button type="button" class="menu-item" data-act="import">' + ICON_IMPORT +
      '<span>Import a list<small>Paste a list shared from this app</small></span></button></div>' +
      '<div class="actions"><button type="button" class="btn quiet" data-act="close">Close</button></div>'
    );
  }

  /* Share */
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
      '<h2 id="sheetTitle" tabindex="-1">Share the list</h2>' +
      '<p class="meta">Send it in a text or email. On another phone with this app, Import copies it over.</p>' +
      '<div class="field"><label for="shareText">The list as text</label>' +
      '<textarea id="shareText" readonly rows="12">' + esc(text) + '</textarea></div>' +
      '<div class="actions">' + (canShare ? '<button type="button" class="btn" id="sendBtn">Send…</button>' : '') +
      '<button type="button" class="btn' + (canShare ? ' quiet' : '') + '" id="copyBtn">Copy</button></div>' +
      '<p class="hint" id="shareMsg" role="status"></p>' +
      '<div><button type="button" class="link" data-act="close">Close</button></div>'
    );
    var ta = $('#shareText', sheetEl), out = $('#shareMsg', sheetEl);
    function selectAll() { ta.focus(); ta.select(); try { ta.setSelectionRange(0, text.length); } catch (e) {} }
    function fallback() {
      selectAll();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      out.textContent = ok ? 'Copied. Paste it into a text or email.' : 'The text is selected. Use your phone’s Copy.';
    }
    $('#copyBtn', sheetEl).addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          out.textContent = 'Copied. Paste it into a text or email.';
        }, fallback);
      } else { fallback(); }
    });
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
      '<p class="meta">Paste a list shared from this app. Restaurants you already have get their answer updated, new ones are added, and nothing is removed.</p>' +
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

  /* ---------- start ---------- */
  items = load();
  render();

  var installed = !!document.querySelector('link[rel="manifest"]');
  var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (installed && secure && 'serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
  }
  if (installed) {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
  }

  window.__pink = { parseList: parseList, get items() { return items; } };
})();
