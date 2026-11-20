/* ==========================================================================
   notes.js — personal rich-text notes for the CCA-F study page
   Load AFTER assets/js/app.js:  <script src="assets/js/notes.js"></script>

   What it adds
   - A "Ghi chú" button + rich-text editor under every principle (D1–D5),
     every cheat-sheet row, every glossary-table row, every tip, and for each
     component of the five "Big picture" diagrams.
   - Bold / italic / underline / bullet + numbered lists / 8 theme-aware text
     colors / clear formatting / "weak spot" flag.
   - A floating "Ghi chú của tôi" drawer: search, filters, jump-to, export /
     import JSON.

   Storage: ONE localStorage key (ccaf-notes-v1) holding
     { "<item id>": { h: "<sanitized html>", w: 0|1, t: <ms>, ti, s, g } }
   Notes are stored as HTML, so every read (page load, import) and every save
   goes through sanitize(), an allow-list filter.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__ccafNotes) return;
  window.__ccafNotes = true;

  var KEY = 'ccaf-notes-v1';
  var MAX_HTML = 60000;

  /* ------------------------------------------------------------------ colors */
  // Stored hex = the light-mode value. notes.css re-maps each one to a
  // theme-aware color, so notes stay readable in dark mode.
  var PALETTE = [
    { k: 'auto',   hex: '#1f2328', label: 'Màu mặc định' },
    { k: 'red',    hex: '#c92a2a', label: 'Đỏ' },
    { k: 'orange', hex: '#c2410c', label: 'Cam' },
    { k: 'amber',  hex: '#8f6b00', label: 'Vàng' },
    { k: 'green',  hex: '#247a35', label: 'Xanh lá' },
    { k: 'teal',   hex: '#0b7285', label: 'Xanh ngọc' },
    { k: 'blue',   hex: '#1c6fd1', label: 'Xanh dương' },
    { k: 'violet', hex: '#6741d9', label: 'Tím' },
    { k: 'pink',   hex: '#c2255c', label: 'Hồng' }
  ];
  var HEX_OK = Object.create(null);
  PALETTE.forEach(function (p) { HEX_OK[p.hex] = true; });

  function normColor(v) {
    if (!v) return '';
    v = String(v).trim().toLowerCase();
    var m = v.match(/^#([0-9a-f]{3})$/);
    if (m) v = '#' + m[1].split('').map(function (c) { return c + c; }).join('');
    m = v.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
    if (m) {
      v = '#' + [m[1], m[2], m[3]].map(function (n) {
        return ('0' + Math.min(255, +n).toString(16)).slice(-2);
      }).join('');
    }
    return /^#[0-9a-f]{6}$/.test(v) ? v : '';
  }

  /* ---------------------------------------------------------------- helpers */
  function h(tag, props) {
    var e = document.createElement(tag);
    if (props) {
      for (var k in props) {
        var v = props[k];
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (v === true) e.setAttribute(k, '');
        else if (v !== false && v != null) e.setAttribute(k, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      if (arguments[i] != null) e.append(arguments[i]);
    }
    return e;
  }

  function hash(s) {
    var x = 5381;
    for (var i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
    return (x >>> 0).toString(36);
  }

  function squash(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function trunc(s, n) { s = squash(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // accent- and case-insensitive text for searching (handles Vietnamese đ)
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }

  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --------------------------------------------------------------- sanitize */
  var ALLOW = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, UL: 1, OL: 1, LI: 1, BR: 1, DIV: 1, P: 1, FONT: 1 };
  var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, SVG: 1, MATH: 1,
               TEMPLATE: 1, NOSCRIPT: 1, LINK: 1, META: 1, TITLE: 1, HEAD: 1 };

  // Allow-list filter. Parses in an inert DOMParser document, then rebuilds a
  // fresh tree containing only allowed tags and (for <font>) a palette color.
  function sanitize(html) {
    html = String(html == null ? '' : html).slice(0, MAX_HTML);
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var out = document.createElement('div');
    (function walk(src, dst, depth) {
      for (var n = src.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        var tag = n.tagName.toUpperCase();
        if (DROP[tag]) continue;
        if (depth > 40) { dst.appendChild(document.createTextNode(n.textContent)); continue; }
        if (!ALLOW[tag]) { walk(n, dst, depth + 1); continue; }
        if (tag === 'FONT') {
          var c = normColor(n.getAttribute('color'));
          if (!HEX_OK[c]) { walk(n, dst, depth + 1); continue; }
          var f = document.createElement('font');
          f.setAttribute('color', c);
          dst.appendChild(f);
          walk(n, f, depth + 1);
          continue;
        }
        var e = document.createElement(tag.toLowerCase());
        dst.appendChild(e);
        if (tag !== 'BR') walk(n, e, depth + 1);
      }
    })(doc.body, out, 0);
    return out.innerHTML;
  }

  var emptyCache = new Map();
  function parseBody(html) { return new DOMParser().parseFromString(html, 'text/html').body; }
  function plain(html) { return squash(parseBody(html).textContent); }
  function isEmpty(html) {
    if (!html) return true;
    if (emptyCache.has(html)) return emptyCache.get(html);
    var e = !squash(parseBody(html).textContent);
    if (emptyCache.size > 600) emptyCache.clear();
    emptyCache.set(html, e);
    return e;
  }

  /* ---------------------------------------------------------------- storage */
  var BAD_ID = { __proto__: 1, constructor: 1, prototype: 1 };

  function cleanStore(o) {
    var out = Object.create(null);
    if (!o || typeof o !== 'object') return out;
    Object.keys(o).forEach(function (id) {
      if (!/^[\w-]{1,80}$/.test(id) || BAD_ID[id]) return;
      var r = o[id];
      if (!r || typeof r !== 'object') return;
      var hh = sanitize(String(r.h || ''));
      var w = r.w ? 1 : 0;
      if (isEmpty(hh) && !w) return;
      out[id] = {
        h: isEmpty(hh) ? '' : hh,
        w: w,
        t: Number(r.t) || 0,
        ti: String(r.ti || '').slice(0, 200),
        s: String(r.s || '').slice(0, 80),
        g: String(r.g || '').slice(0, 12)
      };
    });
    return out;
  }

  function readStore() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? cleanStore(JSON.parse(raw)) : Object.create(null);
    } catch (e) { return Object.create(null); }
  }

  var store = readStore();

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); return true; }
    catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ items */
  var items = [];
  var byId = Object.create(null);
  var usedIds = Object.create(null);
  var activeItem = null;

  function uid(base) {
    var id = base, i = 2;
    while (usedIds[id]) id = base + '-' + (i++);
    usedIds[id] = 1;
    return id;
  }

  function hasNote(it) { var r = store[it.id]; return !!(r && !isEmpty(r.h)); }
  function isWeak(it) { var r = store[it.id]; return !!(r && r.w); }

  function refreshBtn(it) {
    var note = hasNote(it), weak = isWeak(it);
    it.btn.classList.toggle('has-note', note);
    it.btn.classList.toggle('is-weak', weak);
    it.btn.textContent = it.chip ? it.title : 'Ghi chú';
    if (!it.chip) it.btn.prepend(h('span', { 'aria-hidden': 'true', text: '📝' }));
    var label = 'Ghi chú: ' + it.title + (note ? ' (đã có ghi chú)' : '') + (weak ? ' (điểm yếu)' : '');
    it.btn.setAttribute('aria-label', label);
    if (it.weakBtn) {
      it.weakBtn.setAttribute('aria-pressed', weak ? 'true' : 'false');
      it.weakBtn.classList.toggle('is-weak-on', weak);
    }
  }

  function flash(it, text) {
    it.status.textContent = text;
    clearTimeout(it.flashT);
    it.flashT = setTimeout(function () { it.status.textContent = ''; }, 1600);
  }

  function commit(it) {
    clearTimeout(it.timer);
    if (!it.dirty) return;
    it.dirty = false;
    var html = sanitize(it.edit.innerHTML);
    var prev = store[it.id];
    var weak = prev ? prev.w : 0;
    if (isEmpty(html) && !weak) {
      delete store[it.id];
    } else {
      store[it.id] = { h: isEmpty(html) ? '' : html, w: weak, t: Date.now(),
                       ti: it.title, s: it.section, g: it.grp };
    }
    var ok = persist();
    refreshBtn(it);
    updateCount();
    flash(it, ok ? 'Đã lưu' : 'Không lưu được');
  }

  function scheduleSave(it) {
    it.dirty = true;
    clearTimeout(it.timer);
    it.timer = setTimeout(function () { commit(it); }, 500);
  }

  function setWeak(it, on) {
    commit(it);
    var r = store[it.id];
    if (on) {
      if (!r) r = store[it.id] = { h: '', w: 1, t: Date.now(), ti: it.title, s: it.section, g: it.grp };
      r.w = 1; r.t = Date.now();
    } else if (r) {
      r.w = 0; r.t = Date.now();
      if (isEmpty(r.h)) delete store[it.id];
    }
    var ok = persist();
    refreshBtn(it);
    updateCount();
    flash(it, ok ? 'Đã lưu' : 'Không lưu được');
  }

  function setOpen(it, open, focus) {
    (it.shell || it.panel).hidden = !open;
    it.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && focus !== false) {
      it.edit.focus();
      var r = document.createRange();
      r.selectNodeContents(it.edit);
      r.collapse(false);
      var s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  }

  function loadEditor(it) {
    var r = store[it.id];
    it.edit.innerHTML = r && !isEmpty(r.h) ? sanitize(r.h) : '';
  }

  function normalizeFonts(root) {
    root.querySelectorAll('font[color]').forEach(function (f) {
      var c = normColor(f.getAttribute('color'));
      if (c && f.getAttribute('color') !== c) f.setAttribute('color', c);
    });
  }

  /* ------------------------------------------------------------ item builder */
  function makeItem(o) {
    var it = {
      id: o.id, title: o.title, section: o.section, grp: o.grp,
      chip: !!o.chip, dirty: false, timer: 0, flashT: 0, shell: null, target: null
    };

    it.btn = h('button', { type: 'button', class: 'nt-btn' + (o.inline ? ' nt-inline' : ''), 'aria-expanded': 'false' });
    it.panel = h('div', { class: 'nt-panel', hidden: true });
    if (o.accent) it.panel.style.borderLeftColor = o.accent;

    // --- toolbar
    var tools = h('div', { class: 'nt-tools', role: 'toolbar', 'aria-label': 'Định dạng ghi chú' });
    var stateBtns = [];

    function addTool(html, aria, run, stateCmd) {
      var b = h('button', { type: 'button', class: 'nt-tool', 'aria-label': aria, title: aria, 'aria-pressed': 'false' });
      b.innerHTML = html; // static markup defined in this file only
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () {
        if (document.activeElement !== it.edit) it.edit.focus();
        run();
        scheduleSave(it);
        refreshState();
      });
      if (stateCmd) stateBtns.push([b, stateCmd]);
      tools.append(b);
      return b;
    }
    function exec(cmd, val) {
      try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* ignore */ }
      document.execCommand(cmd, false, val);
    }

    addTool('<b>B</b>', 'Đậm (Ctrl+B)', function () { exec('bold'); }, 'bold');
    addTool('<i>I</i>', 'Nghiêng (Ctrl+I)', function () { exec('italic'); }, 'italic');
    addTool('<u>U</u>', 'Gạch chân (Ctrl+U)', function () { exec('underline'); }, 'underline');
    tools.append(h('span', { class: 'nt-sep', 'aria-hidden': 'true' }));
    addTool('<span aria-hidden="true">•</span>', 'Danh sách gạch đầu dòng', function () { exec('insertUnorderedList'); }, 'insertUnorderedList');
    addTool('<span aria-hidden="true">1.</span>', 'Danh sách đánh số', function () { exec('insertOrderedList'); }, 'insertOrderedList');
    tools.append(h('span', { class: 'nt-sep', 'aria-hidden': 'true' }));

    PALETTE.forEach(function (p) {
      var sw = h('button', { type: 'button', class: 'nt-sw', 'aria-label': p.label, title: p.label });
      sw.style.setProperty('--sw', 'var(--nc-' + p.k + ')');
      sw.addEventListener('mousedown', function (e) { e.preventDefault(); });
      sw.addEventListener('click', function () {
        if (document.activeElement !== it.edit) it.edit.focus();
        exec('foreColor', p.hex);
        normalizeFonts(it.edit);
        scheduleSave(it);
      });
      tools.append(sw);
    });

    tools.append(h('span', { class: 'nt-sep', 'aria-hidden': 'true' }));
    addTool('<span aria-hidden="true">Tx</span>', 'Xóa định dạng', function () { exec('removeFormat'); });

    tools.append(h('span', { class: 'nt-grow' }));
    it.weakBtn = h('button', { type: 'button', class: 'nt-tool', 'aria-pressed': 'false',
                               title: 'Đánh dấu điểm yếu để ôn lại' }, '⚑ Điểm yếu');
    it.weakBtn.addEventListener('click', function () { setWeak(it, !isWeak(it)); });
    tools.append(it.weakBtn);
    it.status = h('span', { class: 'nt-status', role: 'status', 'aria-live': 'polite' });
    tools.append(it.status);

    // --- editor
    it.edit = h('div', {
      class: 'nt-edit', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
      'aria-label': 'Ghi chú cho: ' + it.title, 'data-ph': 'Viết ghi chú của bạn…', spellcheck: 'false'
    });

    function refreshState() {
      var sel = getSelection();
      if (!sel || !sel.rangeCount || !it.edit.contains(sel.anchorNode)) return;
      stateBtns.forEach(function (p) {
        var on = false;
        try { on = document.queryCommandState(p[1]); } catch (e) { on = false; }
        p[0].setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    it.refresh = refreshState;

    it.edit.addEventListener('input', function () {
      normalizeFonts(it.edit);
      if (!squash(it.edit.textContent) && !it.edit.querySelector('li')) it.edit.innerHTML = '';
      scheduleSave(it);
    });
    it.edit.addEventListener('focus', function () { activeItem = it; refreshState(); });
    it.edit.addEventListener('blur', function () { commit(it); if (activeItem === it) activeItem = null; });
    // Paste as plain text; block drag-and-drop of foreign HTML.
    it.edit.addEventListener('paste', function (e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData('text/plain');
      if (t) document.execCommand('insertText', false, t);
    });
    it.edit.addEventListener('drop', function (e) { e.preventDefault(); });
    it.edit.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { setOpen(it, false); it.btn.focus(); }
    });

    if (o.panelTitle) it.panel.append(h('div', { class: 'nt-panel-title', text: o.panelTitle }));
    it.panel.append(tools, it.edit);

    it.btn.addEventListener('click', function () {
      var open = (it.shell || it.panel).hidden;
      setOpen(it, open);
    });

    loadEditor(it);
    refreshBtn(it);
    items.push(it);
    byId[it.id] = it;
    return it;
  }

  /* ---------------------------------------------------------------- attach */
  function cellText(el) {
    var c = el.cloneNode(true);
    c.querySelectorAll('.vi-icon,.nt-btn,.nt-panel,ul,ol').forEach(function (x) { x.remove(); });
    return squash(c.textContent);
  }

  function domainAccent(d) { return 'var(--d' + d + ', var(--nt-accent))'; }

  // 1) Principles — id like d1-p6 (already stable in the page)
  document.querySelectorAll('.principle[id]').forEach(function (p) {
    var m = /^d(\d)-p(\d+)$/.exec(p.id);
    if (!m) return;
    var h4 = p.querySelector('h4');
    var it = makeItem({
      id: p.id, title: trunc(h4 ? h4.textContent : p.id, 100),
      section: 'Domain ' + m[1] + ' · Principle ' + m[2], grp: 'D' + m[1],
      accent: domainAccent(m[1])
    });
    // Sibling placement keeps .principle's own layout untouched.
    var bar = h('div', { class: 'nt-bar' }, it.btn);
    p.after(bar, it.panel);
    p.classList.add('nt-anchor');
    it.target = p;
  });

  // 2) Cheat-sheet + glossary tables — an extra "note" column and row
  document.querySelectorAll('table.cheat').forEach(function (tbl) {
    var inCheat = !!tbl.closest('#tab-cheat');
    var section = inCheat ? 'Cheat-sheet' : 'Tips & Tricks · Thuật ngữ';
    var grp = inCheat ? 'C' : 'T';
    var base = inCheat ? 'cheat-' : 'term-';
    Array.from(tbl.rows).forEach(function (tr) {
      if (tr.querySelector('th')) {
        tr.append(h('th', { class: 'nt-th' }, h('span', { class: 'nt-sr', text: 'Ghi chú' })));
        return;
      }
      var first = tr.cells[0] ? cellText(tr.cells[0]) : '';
      if (!first) return;
      var it = makeItem({
        id: uid(base + hash(first.toLowerCase())), title: trunc(first, 100),
        section: section, grp: grp, inline: true
      });
      var n = tr.cells.length + 1;
      var row = h('tr', { class: 'nt-row', hidden: true }, h('td', { colspan: String(n) }, it.panel));
      it.panel.hidden = false;
      it.shell = row;
      it.target = tr;
      tr.classList.add('nt-anchor');
      tr.append(h('td', { class: 'nt-cell' }, it.btn));
      tr.after(row);
    });
  });

  // 3) Tips — every leaf list item
  document.querySelectorAll('#tab-tips .tip-block li').forEach(function (li) {
    if (li.querySelector('ul,ol')) return;
    var text = cellText(li);
    if (!text) return;
    var it = makeItem({
      id: uid('tip-' + hash(text.toLowerCase())), title: trunc(text, 100),
      section: 'Tips & Tricks', grp: 'T', inline: true
    });
    li.append(it.btn, it.panel);
    li.classList.add('nt-anchor');
    it.target = li;
  });

  // 4) Diagram components — one chip + note per box in each Big-picture diagram
  var COMPONENTS = {
    1: [['leadresearcher', 'LeadResearcher (orchestrator)'], ['subagents', 'Subagents'],
        ['memory', 'Memory'], ['extstore', 'External store'], ['citation', 'CitationAgent']],
    2: [['claude', 'Claude (agent)'], ['mcpclient', 'MCP Client'], ['mcpserver', 'MCP Server(s)'],
        ['toolresult', 'Tool result (isError + category)'], ['stateless', 'Stateless API'],
        ['stale', 'Stale session resume'], ['longchat', 'Long multi-issue chat'],
        ['bulky', '40+ field result'], ['escalate', 'Escalation decision'],
        ['handoff', 'Structured handoff'], ['toolfail', 'Tool fails, info known'],
        ['wanthuman', 'Customer wants human, issue simple']],
    3: [['claudemd', 'CLAUDE.md'], ['explore', 'Explore'], ['plan', 'Plan Mode'],
        ['implement', 'Implement'], ['commit', 'Commit'], ['resume', '--continue vs --resume'],
        ['fork', 'fork_session'], ['interrupted', 'Interrupted subagent'],
        ['degrade', 'Context degradation'], ['scratch', 'Scratchpad file'],
        ['deepdive', 'Subagent deep-dive'], ['headless', '--max-turns / --max-budget-usd'],
        ['debug', 'Adaptive debugging'], ['vague', 'Vague tool description']],
    4: [['find', 'Find stage'], ['filter', 'Filter stage'], ['segment', 'Segment-level accuracy check'],
        ['fieldconf', 'Field confidence + threshold'], ['nullable', "Nullable field + 'return null'"],
        ['versioned', 'Versioned values'], ['calcstated', 'Calculated vs stated'],
        ['enum', "Evolving enum + 'other'"], ['toolchoice', 'tool_choice'],
        ['batch', 'Batch vs real-time'], ['fewshot', 'Few-shot canonical examples'],
        ['retry', "Retry can't invent missing info"]],
    5: [['delay', 'Is 24h delay still actionable?'], ['cadence', 'Safe cadence'],
        ['chunk', 'context_length_exceeded → chunk & resubmit']]
  };

  document.querySelectorAll('.bigpic').forEach(function (bp) {
    var panel = bp.closest('.tab-panel');
    var m = panel && /^d(\d)$/.exec(panel.getAttribute('data-tab') || '');
    if (!m || !COMPONENTS[m[1]]) return;
    var d = m[1];
    var row = h('div', { class: 'nt-comps-row' });
    var panels = h('div', { class: 'nt-comps-panels' });
    var wrap = h('div', { class: 'nt-comps' },
      h('p', { class: 'nt-comps-head', text: 'Ghi chú cho từng thành phần trong sơ đồ:' }), row, panels);
    COMPONENTS[d].forEach(function (c) {
      var it = makeItem({
        id: uid('d' + d + '-c-' + c[0]), title: c[1], panelTitle: c[1],
        section: 'Domain ' + d + ' · Thành phần sơ đồ', grp: 'D' + d,
        inline: true, chip: true, accent: domainAccent(d)
      });
      it.target = wrap;
      row.append(it.btn);
      panels.append(it.panel);
    });
    var svg = bp.querySelector('svg');
    if (svg) svg.after(wrap); else bp.append(wrap);
    wrap.classList.add('nt-anchor');
  });

  // Keep drawer order = page order
  items.sort(function (a, b) {
    return (a.btn.compareDocumentPosition(b.btn) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
  });

  /* ---------------------------------------------------------------- drawer */
  var FILTERS = [['all', 'Tất cả'], ['weak', '⚑ Điểm yếu'], ['D1', 'D1'], ['D2', 'D2'], ['D3', 'D3'],
                 ['D4', 'D4'], ['D5', 'D5'], ['C', 'Cheat-sheet'], ['T', 'Tips']];
  var filter = 'all';
  var incoming = null;

  var countEl = h('span', { class: 'nt-count', text: '0' });
  var fab = h('button', { type: 'button', class: 'nt-fab', 'aria-haspopup': 'dialog' },
    h('span', { 'aria-hidden': 'true', text: '📝' }), h('span', { text: 'Ghi chú của tôi' }), countEl);
  var scrim = h('div', { class: 'nt-scrim', hidden: true });

  var subEl = h('span', { class: 'nt-dsub' });
  var closeBtn = h('button', { type: 'button', class: 'nt-x', 'aria-label': 'Đóng', text: '×' });
  var search = h('input', { type: 'search', class: 'nt-search', placeholder: 'Tìm trong ghi chú…', 'aria-label': 'Tìm trong ghi chú' });
  var filtersEl = h('div', { class: 'nt-filters', role: 'group', 'aria-label': 'Lọc ghi chú' });
  var listEl = h('div', { class: 'nt-list' });
  var msgEl = h('p', { class: 'nt-msg', role: 'status', 'aria-live': 'polite' });
  var importBox = h('div', { class: 'nt-import', hidden: true });
  var fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  var exportBtn = h('button', { type: 'button', class: 'nt-act', text: 'Xuất JSON' });
  var importBtn = h('button', { type: 'button', class: 'nt-act', text: 'Nhập JSON' });

  var drawer = h('aside', { class: 'nt-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'nt-dtitle', tabindex: '-1' },
    h('div', { class: 'nt-dhead' }, h('h2', { id: 'nt-dtitle', text: 'Ghi chú của tôi' }), subEl, closeBtn),
    search, filtersEl, listEl,
    h('div', { class: 'nt-dfoot' },
      h('div', { class: 'nt-dfoot-row' }, exportBtn, importBtn, fileInput), importBox, msgEl));

  FILTERS.forEach(function (f) {
    var b = h('button', { type: 'button', class: 'nt-chipf', 'aria-pressed': f[0] === filter ? 'true' : 'false', text: f[1] });
    b.dataset.f = f[0];
    b.addEventListener('click', function () {
      filter = f[0];
      Array.prototype.forEach.call(filtersEl.children, function (c) {
        c.setAttribute('aria-pressed', c.dataset.f === filter ? 'true' : 'false');
      });
      renderDrawer();
    });
    filtersEl.append(b);
  });

  function counts() {
    var notes = 0, weak = 0;
    Object.keys(store).forEach(function (id) {
      var r = store[id];
      if (!isEmpty(r.h)) notes++;
      if (r.w) weak++;
    });
    return { notes: notes, weak: weak };
  }

  function updateCount() {
    var c = counts();
    countEl.textContent = String(c.notes);
    countEl.setAttribute('data-zero', c.notes ? '0' : '1');
    subEl.textContent = c.notes + ' ghi chú · ' + c.weak + ' điểm yếu';
  }

  function say(t) { msgEl.textContent = t; }

  function renderDrawer() {
    var q = fold(search.value.trim());
    var rows = [], seen = Object.create(null);
    items.forEach(function (it) {
      var r = store[it.id];
      if (r) { rows.push({ id: it.id, title: it.title, section: it.section, grp: it.grp, r: r, live: true }); seen[it.id] = 1; }
    });
    Object.keys(store).forEach(function (id) {
      if (seen[id]) return;
      var r = store[id];
      rows.push({ id: id, title: r.ti || id, section: (r.s || 'Không rõ') + ' (không còn trên trang)', grp: r.g || '?', r: r, live: false });
    });

    rows = rows.filter(function (x) {
      if (filter === 'weak' && !x.r.w) return false;
      if (filter !== 'all' && filter !== 'weak' && x.grp !== filter) return false;
      if (q && fold(x.title + ' ' + plain(x.r.h)).indexOf(q) === -1) return false;
      return true;
    });

    listEl.textContent = '';
    if (!rows.length) {
      var any = Object.keys(store).length > 0;
      listEl.append(h('p', { class: 'nt-empty',
        text: any ? 'Không có ghi chú nào khớp bộ lọc.' : 'Chưa có ghi chú nào. Bấm “Ghi chú” dưới mỗi nguyên tắc, dòng cheat-sheet hoặc tip để bắt đầu.' }));
      return;
    }
    rows.forEach(function (x) {
      var head = h('div', { class: 'nt-ehead' }, h('span', { class: 'nt-where', text: x.section }));
      if (x.r.w) head.append(h('span', { class: 'nt-flag', text: '⚑ Điểm yếu' }));
      var act = h('button', { type: 'button', class: x.live ? 'nt-go' : 'nt-act', text: x.live ? 'Đi tới' : 'Xóa' });
      act.addEventListener('click', function () {
        if (x.live) { goTo(x.id); return; }
        if (confirm('Xóa ghi chú này? Không thể hoàn tác.')) {
          delete store[x.id];
          persist(); updateCount(); renderDrawer();
        }
      });
      head.append(act);
      var entry = h('article', { class: 'nt-entry' }, head, h('h3', { class: 'nt-etitle', text: x.title }));
      if (!isEmpty(x.r.h)) {
        var view = h('div', { class: 'nt-view' });
        view.innerHTML = sanitize(x.r.h);
        entry.append(view);
      }
      listEl.append(entry);
    });
  }

  var lastFocus = null;
  function openDrawer() {
    lastFocus = document.activeElement;
    renderDrawer();
    updateCount();
    scrim.hidden = false;
    drawer.classList.add('is-open');
    setTimeout(function () { search.focus(); }, 30);
  }
  function closeDrawer(restore) {
    drawer.classList.remove('is-open');
    scrim.hidden = true;
    if (restore !== false && lastFocus && lastFocus.focus) lastFocus.focus();
  }

  fab.addEventListener('click', openDrawer);
  closeBtn.addEventListener('click', function () { closeDrawer(); });
  scrim.addEventListener('click', function () { closeDrawer(); });
  search.addEventListener('input', renderDrawer);
  document.addEventListener('keydown', function (e) {
    if (!drawer.classList.contains('is-open')) return;
    if (e.key === 'Escape') { closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    var f = drawer.querySelectorAll('button:not([hidden]),input:not([hidden]),[href]');
    f = Array.prototype.filter.call(f, function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function goTo(id) {
    var it = byId[id];
    if (!it) return;
    closeDrawer(false);
    var target = it.target || it.btn;
    var tp = target.closest('.tab-panel');
    if (tp && getComputedStyle(tp).display === 'none') {
      var name = tp.getAttribute('data-tab');
      var btns = document.querySelectorAll('.tab-btn');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].getAttribute('data-tab') === name) { btns[i].click(); break; }
      }
    }
    setTimeout(function () {
      setOpen(it, true, false);
      target.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      it.edit.focus({ preventScroll: true });
    }, 90);
  }

  /* --------------------------------------------------- export / import JSON */
  exportBtn.addEventListener('click', function () {
    items.forEach(commit);
    var data = JSON.stringify({ v: 1, exported: new Date().toISOString(), notes: store }, null, 2);
    var url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    var a = h('a', { href: url, download: 'ccaf-notes-' + new Date().toISOString().slice(0, 10) + '.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    say('Đã xuất ' + counts().notes + ' ghi chú.');
  });

  importBtn.addEventListener('click', function () { fileInput.click(); });

  fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0];
    if (!f) return;
    if (f.size > 5e6) { say('File quá lớn (tối đa 5 MB).'); fileInput.value = ''; return; }
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var o = JSON.parse(rd.result);
        incoming = cleanStore(o && o.notes ? o.notes : o);
        var n = Object.keys(incoming).length;
        if (!n) { say('Không tìm thấy ghi chú hợp lệ trong file.'); return; }
        showImportChoice(n);
      } catch (e) { say('File không đúng định dạng JSON.'); }
    };
    rd.onerror = function () { say('Không đọc được file.'); };
    rd.readAsText(f);
    fileInput.value = '';
  });

  function syncAll() {
    items.forEach(function (it) {
      if (document.activeElement !== it.edit) loadEditor(it);
      refreshBtn(it);
    });
    updateCount();
    renderDrawer();
  }

  function showImportChoice(n) {
    importBox.textContent = '';
    importBox.hidden = false;
    var merge = h('button', { type: 'button', class: 'nt-act', text: 'Gộp (giữ bản mới hơn)' });
    var repl = h('button', { type: 'button', class: 'nt-act', text: 'Thay thế tất cả' });
    var cancel = h('button', { type: 'button', class: 'nt-act', text: 'Hủy' });
    function done(text) { importBox.hidden = true; incoming = null; say(text); }
    merge.addEventListener('click', function () {
      Object.keys(incoming).forEach(function (id) {
        if (!store[id] || incoming[id].t > store[id].t) store[id] = incoming[id];
      });
      var ok = persist(); syncAll();
      done(ok ? 'Đã gộp ' + n + ' ghi chú.' : 'Không lưu được vào trình duyệt.');
    });
    repl.addEventListener('click', function () {
      if (!confirm('Thay thế toàn bộ ghi chú hiện tại bằng file này?')) return;
      store = incoming;
      var ok = persist(); syncAll();
      done(ok ? 'Đã thay thế bằng ' + n + ' ghi chú.' : 'Không lưu được vào trình duyệt.');
    });
    cancel.addEventListener('click', function () { done('Đã hủy nhập.'); });
    importBox.append(h('div', { text: 'Tìm thấy ' + n + ' ghi chú trong file. Bạn muốn làm gì?' }),
      h('div', { class: 'nt-import-row' }, merge, repl, cancel));
  }

  /* ------------------------------------------------------------- life-cycle */
  document.addEventListener('selectionchange', function () { if (activeItem) activeItem.refresh(); });

  function flushAll() { items.forEach(commit); }
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushAll(); });

  // Notes edited in another tab
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    store = readStore();
    syncAll();
  });

  document.body.append(scrim, drawer, fab);
  updateCount();
})();
