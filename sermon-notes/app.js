/* Sermon Notebook — an Evernote-style file for sermon material.
 * All data lives in this browser's IndexedDB. Use Export backup to keep a copy.
 */
(function () {
  'use strict';

  // ---------- Note types ----------
  var TYPES = [
    { id: 'idea',         label: 'Idea',         color: '#c58a1b', hint: 'A seed thought, outline, angle, or question to develop…', author: 'Prompted by' },
    { id: 'illustration', label: 'Illustration', color: '#2f7d6d', hint: 'Tell the story. Where did it happen? What is the point of connection?', author: 'Source' },
    { id: 'quote',        label: 'Quote',        color: '#7a4b2a', hint: 'Paste the quotation exactly as written…', author: 'Author / work / page' },
    { id: 'motto',        label: 'Motto',        color: '#a23b52', hint: 'A short, memorable line or refrain…', author: 'Origin' },
    { id: 'statement',    label: 'Statement',    color: '#4a5fa8', hint: 'A big idea, thesis, or theological statement you want to land…', author: 'Source' },
    { id: 'clipping',     label: 'Clipping',     color: '#6b6f2a', hint: 'Paste an article excerpt, news story, or add a photo/screenshot…', author: 'Publication / author' },
    { id: 'reference',    label: 'Reference',    color: '#6a4c93', hint: 'Book, commentary, article, or podcast worth returning to. Notes, page numbers…', author: 'Author / title / page' }
  ];
  var TYPE = {};
  TYPES.forEach(function (t) { TYPE[t.id] = t; });

  // ---------- Tiny IndexedDB wrapper ----------
  var DB_NAME = 'sermon-notebook', DB_VER = 1, db;
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function tx(store, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, mode), s = t.objectStore(store), out;
      out = fn(s);
      t.oncomplete = function () { resolve(out instanceof IDBRequest ? out.result : undefined); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error); };
    });
  }
  var store = {
    all: function () { return tx('notes', 'readonly', function (s) { return s.getAll(); }); },
    put: function (n) { return tx('notes', 'readwrite', function (s) { s.put(n); }); },
    del: function (id) { return tx('notes', 'readwrite', function (s) { s.delete(id); }); },
    getMeta: function (k) { return tx('meta', 'readonly', function (s) { return s.get(k); }); },
    setMeta: function (k, v) { return tx('meta', 'readwrite', function (s) { s.put(v, k); }); },
    clear: function () {
      return tx('notes', 'readwrite', function (s) { s.clear(); });
    }
  };

  // ---------- State ----------
  var state = {
    notes: [],
    notebooks: [],          // [{id, name}]
    filter: { kind: 'all', value: null },
    query: '',
    sort: 'updated',
    currentId: null,
    collapsed: {}
  };

  // ---------- Helpers ----------
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function now() { return new Date().toISOString(); }
  function htmlToText(html) {
    var d = document.createElement('div');
    d.innerHTML = (html || '').replace(/<(br|\/p|\/li|\/h3|\/blockquote|\/div)[^>]*>/gi, '$&\n');
    return d.textContent.replace(/\n{3,}/g, '\n\n').trim();
  }
  function fmtDate(iso, withTime) {
    if (!iso) return '';
    var d = new Date(iso);
    var opts = { year: 'numeric', month: 'short', day: 'numeric' };
    if (withTime) { opts.hour = 'numeric'; opts.minute = '2-digit'; }
    return d.toLocaleString(undefined, opts);
  }
  function relDate(iso) {
    var diff = (Date.now() - new Date(iso)) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
    return fmtDate(iso);
  }
  function debounce(fn, ms) {
    var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  }
  var toastTimer;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function current() { return state.notes.find(function (n) { return n.id === state.currentId; }); }

  // Keep pasted/stored HTML to a small safe set of tags
  var ALLOWED = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, P: 1, BR: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, H3: 1, A: 1, DIV: 1 };
  function sanitize(html) {
    var doc = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html');
    var root = doc.body.firstChild;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) return;
        if (c.nodeType !== 1) { c.remove(); return; }
        var tag = c.tagName;
        if (/^(SCRIPT|STYLE|META|LINK|TITLE|IFRAME|OBJECT|NOSCRIPT|TEMPLATE)$/.test(tag)) { c.remove(); return; }
        walk(c);
        if (/^H[1-6]$/.test(tag) && tag !== 'H3') {
          var h = doc.createElement('h3'); while (c.firstChild) h.appendChild(c.firstChild); c.replaceWith(h); return;
        }
        if (!ALLOWED[tag]) {
          var frag = doc.createDocumentFragment();
          while (c.firstChild) frag.appendChild(c.firstChild);
          if (/^(SECTION|ARTICLE|TR|TABLE|FIGURE|HEADER|FOOTER|PRE)$/.test(tag)) frag.appendChild(doc.createElement('br'));
          c.replaceWith(frag); return;
        }
        var href = tag === 'A' ? c.getAttribute('href') : null;
        Array.prototype.slice.call(c.attributes).forEach(function (a) { c.removeAttribute(a.name); });
        if (href && /^(https?:|mailto:)/i.test(href)) { c.setAttribute('href', href); c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener'); }
      });
    })(root);
    return root.innerHTML;
  }

  // ---------- Data ops ----------
  function blankNote(type) {
    var nb = state.filter.kind === 'notebook' ? state.filter.value : '';
    var tags = state.filter.kind === 'tag' ? [state.filter.value] : [];
    var scriptures = state.filter.kind === 'book' ? [state.filter.value] : [];
    return {
      id: uid(), type: type || 'idea', title: '', body: '', author: '', url: '',
      scriptures: scriptures, tags: tags, notebook: nb, favorite: false,
      usedIn: [], images: [], created: now(), updated: now()
    };
  }

  var saveNow = function (n) {
    n.updated = now();
    setSaveState('Saving…');
    return store.put(n).then(function () { setSaveState('Saved'); }, function (e) {
      setSaveState('Not saved!'); toast('Could not save: ' + (e && e.message || e));
    });
  };
  var saveSoon = debounce(function () { var n = current(); if (n) { saveNow(n).then(renderNav).then(renderList); } }, 500);
  function setSaveState(s) { $('#saveState').textContent = s; }

  function parsedRefs(n) {
    return (n.scriptures || []).map(Bible.parse).filter(Boolean);
  }

  // ---------- Filtering & search ----------
  function matchesFilter(n) {
    var f = state.filter;
    switch (f.kind) {
      case 'favorites': return n.favorite;
      case 'unused': return !n.usedIn || !n.usedIn.length;
      case 'type': return n.type === f.value;
      case 'notebook': return (n.notebook || '') === f.value;
      case 'tag': return (n.tags || []).some(function (t) { return t.toLowerCase() === f.value.toLowerCase(); });
      case 'book': return parsedRefs(n).some(function (r) { return r.book === f.value; });
      default: return true;
    }
  }
  function haystack(n) {
    if (!n._hay || n._hayAt !== n.updated) {
      n._hay = [n.title, htmlToText(n.body), n.author, n.url, (n.tags || []).join(' '), (n.scriptures || []).join(' '),
        (TYPE[n.type] || {}).label, (n.usedIn || []).map(function (u) { return u.sermon; }).join(' ')]
        .join(' \n ').toLowerCase();
      n._hayAt = n.updated;
    }
    return n._hay;
  }
  function matchesQuery(n) {
    var q = state.query.trim();
    if (!q) return true;
    // Scripture-aware: if the whole query looks like a passage, match by passage
    var ref = /\d|^[1-3]?\s*[a-z]{3,}$/i.test(q) ? Bible.parse(q) : null;
    if (ref && parsedRefs(n).some(function (r) { return Bible.matches(r, ref); })) return true;
    if (ref && (ref.chapter || /^[1-3]/.test(q))) {
      // A clear passage query (e.g. "Rom 8") shouldn't also fall back to fuzzy text
      return false;
    }
    var h = haystack(n);
    return q.toLowerCase().split(/\s+/).every(function (tok) {
      if (tok.charAt(0) === '#') return (n.tags || []).some(function (t) { return t.toLowerCase().indexOf(tok.slice(1)) === 0; });
      return h.indexOf(tok) !== -1;
    });
  }
  function visibleNotes() {
    var list = state.notes.filter(function (n) { return matchesFilter(n) && matchesQuery(n); });
    var s = state.sort;
    list.sort(function (a, b) {
      if (s === 'title') return (a.title || '~').localeCompare(b.title || '~');
      if (s === 'created') return b.created < a.created ? -1 : 1;
      if (s === 'used') {
        var d = (a.usedIn || []).length - (b.usedIn || []).length;
        return d || (b.updated < a.updated ? -1 : 1);
      }
      return b.updated < a.updated ? -1 : 1;
    });
    return list;
  }

  // ---------- Render: sidebar ----------
  function navItem(label, kind, value, count, opts) {
    opts = opts || {};
    var active = state.filter.kind === kind && state.filter.value === value;
    return el('button', {
      class: 'nav-item' + (active ? ' active' : ''),
      onclick: function () { setFilter(kind, value); }
    }, [
      opts.dot ? el('span', { class: 'dot', style: 'background:' + opts.dot }) : (opts.icon ? el('span', { class: 'nav-ico', text: opts.icon }) : null),
      el('span', { class: 'nav-label', text: label }),
      opts.action || null,
      count != null ? el('span', { class: 'count', text: String(count) }) : null
    ]);
  }
  function navSection(id, title, items, extra) {
    var collapsed = !!state.collapsed[id];
    var head = el('div', { class: 'nav-head' }, [
      el('button', {
        class: 'nav-toggle', 'aria-expanded': String(!collapsed),
        onclick: function () { state.collapsed[id] = !collapsed; store.setMeta('collapsed', state.collapsed); renderNav(); }
      }, [el('span', { class: 'caret', text: collapsed ? '▸' : '▾' }), title]),
      extra || null
    ]);
    var wrap = el('div', { class: 'nav-section' }, [head]);
    if (!collapsed) items.forEach(function (i) { wrap.appendChild(i); });
    return wrap;
  }

  function renderNav() {
    var nav = $('#nav'); nav.innerHTML = '';
    var notes = state.notes;
    var count = function (fn) { return notes.filter(fn).length; };

    nav.appendChild(el('div', { class: 'nav-section' }, [
      navItem('All notes', 'all', null, notes.length, { icon: '▤' }),
      navItem('Favorites', 'favorites', null, count(function (n) { return n.favorite; }), { icon: '★' }),
      navItem('Not yet used', 'unused', null, count(function (n) { return !n.usedIn || !n.usedIn.length; }), { icon: '○' })
    ]));

    nav.appendChild(navSection('types', 'Types', TYPES.map(function (t) {
      return navItem(t.label + 's', 'type', t.id, count(function (n) { return n.type === t.id; }), { dot: t.color });
    })));

    var addNb = el('button', { class: 'mini-btn', title: 'New notebook', text: '+', onclick: addNotebook });
    var nbItems = state.notebooks.map(function (nb) {
      var edit = el('span', {
        class: 'nav-edit', title: 'Rename or delete', text: '⋯',
        onclick: function (e) { e.stopPropagation(); editNotebook(nb); }
      });
      return navItem(nb.name, 'notebook', nb.id, count(function (n) { return n.notebook === nb.id; }), { icon: '▭', action: edit });
    });
    if (!nbItems.length) nbItems.push(el('p', { class: 'nav-empty', text: 'Group notes by series or season — e.g. "Romans series", "Advent 2026".' }));
    nav.appendChild(navSection('notebooks', 'Notebooks / series', nbItems, addNb));

    // Tags
    var tagCounts = {};
    notes.forEach(function (n) { (n.tags || []).forEach(function (t) { var k = t.toLowerCase(); tagCounts[k] = tagCounts[k] || { name: t, n: 0 }; tagCounts[k].n++; }); });
    var tags = Object.keys(tagCounts).sort().map(function (k) { return tagCounts[k]; });
    var tagWrap = el('div', { class: 'tag-cloud' }, tags.map(function (t) {
      var active = state.filter.kind === 'tag' && state.filter.value.toLowerCase() === t.name.toLowerCase();
      return el('button', { class: 'tag' + (active ? ' active' : ''), onclick: function () { setFilter('tag', t.name); } }, ['#' + t.name, el('span', { text: ' ' + t.n })]);
    }));
    nav.appendChild(navSection('tags', 'Themes', tags.length ? [tagWrap] : [el('p', { class: 'nav-empty', text: 'Tags you add appear here.' })]));

    // Scripture books
    var bookCounts = {};
    notes.forEach(function (n) {
      var seen = {};
      parsedRefs(n).forEach(function (r) { if (!seen[r.book]) { seen[r.book] = 1; bookCounts[r.book] = (bookCounts[r.book] || 0) + 1; } });
    });
    var bookItems = Bible.books.filter(function (b) { return bookCounts[b.name]; }).map(function (b) {
      return navItem(b.name, 'book', b.name, bookCounts[b.name], { icon: b.index < 39 ? 'OT' : 'NT' });
    });
    nav.appendChild(navSection('books', 'Scripture', bookItems.length ? bookItems : [el('p', { class: 'nav-empty', text: 'Passages you attach are indexed here by book.' })]));

    // datalist for tag suggestions
    var dl = $('#tagSuggest'); dl.innerHTML = '';
    tags.forEach(function (t) { dl.appendChild(el('option', { value: t.name })); });
  }

  function filterTitle() {
    var f = state.filter;
    switch (f.kind) {
      case 'favorites': return 'Favorites';
      case 'unused': return 'Not yet used';
      case 'type': return TYPE[f.value].label + 's';
      case 'notebook': var nb = state.notebooks.find(function (x) { return x.id === f.value; }); return nb ? nb.name : 'Notebook';
      case 'tag': return '#' + f.value;
      case 'book': return f.value;
      default: return 'All notes';
    }
  }

  // ---------- Render: list ----------
  function renderList() {
    var ul = $('#noteList'); ul.innerHTML = '';
    var list = visibleNotes();
    $('#listTitle').textContent = filterTitle() + (state.query ? ' · “' + state.query + '”' : '');
    var empty = $('#listEmpty');
    if (!list.length) {
      empty.hidden = false;
      empty.innerHTML = '';
      if (!state.notes.length) {
        empty.appendChild(el('div', {}, [
          el('p', { class: 'empty-title', text: 'Your sermon file is empty.' }),
          el('p', { text: 'Capture the story you heard today, the quote that stopped you, the line that might become next month’s big idea.' }),
          el('button', { class: 'btn primary', text: 'Write your first note', onclick: function () { newNote('idea'); } }),
          el('button', { class: 'btn ghost', text: 'Load a few examples', onclick: loadSamples })
        ]));
      } else {
        empty.appendChild(el('p', { text: 'No notes match.' }));
      }
    } else empty.hidden = true;

    list.forEach(function (n) {
      var t = TYPE[n.type] || TYPES[0];
      var text = htmlToText(n.body);
      var refs = parsedRefs(n).map(Bible.format);
      var li = el('li', {
        class: 'note-card' + (n.id === state.currentId ? ' active' : ''),
        tabindex: '0',
        onclick: function () { openNote(n.id); },
        onkeydown: function (e) { if (e.key === 'Enter') openNote(n.id); }
      }, [
        el('div', { class: 'card-top' }, [
          el('span', { class: 'type-badge', style: '--c:' + t.color, text: t.label }),
          n.favorite ? el('span', { class: 'star', text: '★' }) : null,
          (n.images && n.images.length) ? el('span', { class: 'clip', title: n.images.length + ' image(s)', text: '🖼' }) : null,
          el('span', { class: 'card-date', text: relDate(n.updated) })
        ]),
        el('div', { class: 'card-title', text: n.title || firstLine(text) || 'Untitled' }),
        text ? el('div', { class: 'card-snippet', text: n.title ? text : text.slice(firstLine(text).length).trim() }) : null,
        el('div', { class: 'card-meta' }, [
          refs.length ? el('span', { class: 'card-ref', text: refs.join(' · ') }) : null,
          n.author ? el('span', { class: 'card-author', text: '— ' + n.author }) : null
        ]),
        (n.tags && n.tags.length) || (n.usedIn && n.usedIn.length) ? el('div', { class: 'card-tags' },
          (n.tags || []).map(function (tg) { return el('span', { class: 'tag small', text: '#' + tg }); })
            .concat(n.usedIn && n.usedIn.length ? [el('span', { class: 'used-badge', title: 'Times used in a sermon', text: 'Used ×' + n.usedIn.length })] : [])
        ) : null
      ]);
      ul.appendChild(li);
    });
  }
  function firstLine(text) { return (text || '').split('\n')[0].slice(0, 90); }

  // ---------- Render: editor ----------
  function renderEditor() {
    var n = current();
    $('#editor').hidden = !n;
    $('#editorEmpty').hidden = !!n;
    if (!n) return;
    var t = TYPE[n.type] || TYPES[0];

    $('#fType').value = n.type;
    $('#fType').style.setProperty('--c', t.color);
    fillNotebookSelect(n.notebook);
    $('#fTitle').value = n.title;
    $('#fAuthor').value = n.author || '';
    $('#authorLabel').textContent = t.author;
    $('#fUrl').value = n.url || '';
    updateUrlOpen();
    var body = $('#fBody');
    body.innerHTML = sanitize(n.body);
    body.setAttribute('data-placeholder', t.hint);
    $('#favBtn').classList.toggle('on', !!n.favorite);
    renderChips('scriptures'); renderChips('tags');
    renderImages(); renderUsed();
    $('#stamps').textContent = 'Created ' + fmtDate(n.created, true) + ' · Edited ' + fmtDate(n.updated, true);
    setSaveState('');
  }
  function fillNotebookSelect(val) {
    var s = $('#fNotebook'); s.innerHTML = '';
    s.appendChild(el('option', { value: '', text: 'No notebook' }));
    state.notebooks.forEach(function (nb) { s.appendChild(el('option', { value: nb.id, text: nb.name })); });
    s.appendChild(el('option', { value: '__new', text: '+ New notebook…' }));
    s.value = val || '';
  }
  function updateUrlOpen() {
    var u = $('#fUrl').value.trim(), a = $('#urlOpen');
    a.hidden = !/^https?:\/\//i.test(u);
    if (!a.hidden) a.href = u;
  }

  function renderChips(field) {
    var n = current(); if (!n) return;
    var wrap = $('.chip-input[data-field="' + field + '"] .chips');
    wrap.innerHTML = '';
    var vals = n[field] || [];
    if (field === 'scriptures') {
      vals = vals.slice().sort(function (a, b) {
        var ra = Bible.parse(a), rb = Bible.parse(b);
        return (ra ? Bible.sortKey(ra) : 1e9) - (rb ? Bible.sortKey(rb) : 1e9);
      });
    }
    vals.forEach(function (v) {
      var ok = field !== 'scriptures' || Bible.parse(v);
      wrap.appendChild(el('span', { class: 'chip' + (ok ? '' : ' warn'), title: ok ? '' : 'Not recognized as a Bible reference (it will still be searchable)' }, [
        el('button', { class: 'chip-label', type: 'button', text: field === 'tags' ? '#' + v : v, title: 'Show all notes with this', onclick: function () {
          var r = Bible.parse(v);
          if (field === 'tags') setFilter('tag', v);
          else if (r) { setFilter('all', null); setQuery(Bible.format(r)); }
        } }),
        el('button', { class: 'chip-x', type: 'button', 'aria-label': 'Remove', text: '×', onclick: function () {
          n[field] = n[field].filter(function (x) { return x !== v; });
          renderChips(field); saveSoon();
        } })
      ]));
    });
  }
  function addChips(field, raw) {
    var n = current(); if (!n) return;
    var parts = raw.split(field === 'scriptures' ? /[;,]+/ : /[,;]+/).map(function (s) { return s.trim().replace(/^#/, ''); }).filter(Boolean);
    if (!parts.length) return;
    // Scripture: support "Rom 8:1, 28" style shorthand (verse continues previous book/chapter)
    var lastRef = null;
    parts.forEach(function (p) {
      var v = p;
      if (field === 'scriptures') {
        if (lastRef && /^\d+([-–]\d+)?$/.test(p) && lastRef.chapter) v = lastRef.book + ' ' + lastRef.chapter + ':' + p;
        else if (lastRef && /^\d+:\d+/.test(p)) v = lastRef.book + ' ' + p;
        var r = Bible.parse(v);
        if (r) { v = Bible.format(r); lastRef = r; }
      }
      var exists = (n[field] || []).some(function (x) { return x.toLowerCase() === v.toLowerCase(); });
      if (!exists) n[field] = (n[field] || []).concat(v);
    });
    renderChips(field); saveSoon();
  }

  function renderImages() {
    var n = current(), wrap = $('#images'); wrap.innerHTML = '';
    (n.images || []).forEach(function (img) {
      wrap.appendChild(el('figure', { class: 'thumb' }, [
        el('img', { src: img.data, alt: img.name || '', onclick: function () { showLightbox(img.data); } }),
        el('button', { class: 'thumb-x', title: 'Remove image', text: '×', onclick: function () {
          if (!confirm('Remove this image?')) return;
          n.images = n.images.filter(function (x) { return x.id !== img.id; });
          renderImages(); saveSoon();
        } })
      ]));
    });
  }
  function showLightbox(src) { var lb = $('#lightbox'); $('img', lb).src = src; lb.hidden = false; }

  function renderUsed() {
    var n = current(), ul = $('#usedList'); ul.innerHTML = '';
    var list = (n.usedIn || []).slice().sort(function (a, b) { return (b.date || '') < (a.date || '') ? -1 : 1; });
    if (!list.length) ul.appendChild(el('li', { class: 'muted', text: 'Not used yet. Log it here after you preach it so you don’t repeat yourself.' }));
    list.forEach(function (u) {
      ul.appendChild(el('li', {}, [
        el('span', { class: 'used-date', text: u.date ? fmtDate(u.date + 'T12:00:00') : '—' }),
        el('span', { class: 'used-title', text: u.sermon || '' }),
        el('button', { class: 'chip-x', title: 'Remove', text: '×', onclick: function () {
          n.usedIn = n.usedIn.filter(function (x) { return x !== u; }); renderUsed(); saveSoon();
        } })
      ]));
    });
  }

  // ---------- Images ----------
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 1600, w = img.width, h = img.height, scale = Math.min(1, max / Math.max(w, h));
          if (scale === 1 && file.size < 600000) { resolve(fr.result); return; }
          var c = document.createElement('canvas');
          c.width = Math.round(w * scale); c.height = Math.round(h * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = reject;
        img.src = fr.result;
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  function addImages(files) {
    var n = current(); if (!n || !files.length) return;
    Promise.all(Array.prototype.map.call(files, function (f) {
      return readImage(f).then(function (data) { return { id: uid(), name: f.name, data: data }; });
    })).then(function (imgs) {
      n.images = (n.images || []).concat(imgs);
      renderImages(); saveSoon();
    }, function () { toast('Could not read that image.'); });
  }

  // ---------- Actions ----------
  function setFilter(kind, value) {
    state.filter = { kind: kind, value: value };
    closeDrawer(); renderNav(); renderList();
  }
  function setQuery(q) { $('#search').value = q; state.query = q; renderList(); }

  function openNote(id) {
    flushEditor();
    state.currentId = id;
    renderList(); renderEditor();
    document.body.className = 'view-editor';
  }
  function newNote(type) {
    flushEditor();
    var n = blankNote(type);
    state.notes.unshift(n);
    store.put(n);
    state.currentId = n.id;
    if (!matchesFilter(n)) state.filter = { kind: 'all', value: null };
    state.query = ''; $('#search').value = '';
    renderNav(); renderList(); renderEditor();
    document.body.className = 'view-editor';
    closeDrawer(); $('#newTypes').classList.remove('open');
    setTimeout(function () { $('#fTitle').focus(); }, 30);
  }
  // Drop notes that were created but never written in
  function isBlank(n) {
    return !n.title.trim() && !htmlToText(n.body) && !(n.images || []).length && !(n.author || '').trim() && !(n.url || '').trim() && !(n.usedIn || []).length;
  }
  function flushEditor() {
    var n = current();
    if (!n) return;
    commitPendingChipInputs();
    if (isBlank(n) && !(n.tags || []).length && !(n.scriptures || []).length) {
      state.notes = state.notes.filter(function (x) { return x.id !== n.id; });
      store.del(n.id);
    }
  }
  function commitPendingChipInputs() {
    var s = $('#fScripture'), t = $('#fTags');
    if (s.value.trim()) { addChips('scriptures', s.value); s.value = ''; }
    if (t.value.trim()) { addChips('tags', t.value); t.value = ''; }
  }
  function deleteNote() {
    var n = current(); if (!n) return;
    if (!isBlank(n) && !confirm('Delete “' + (n.title || 'Untitled') + '”? This cannot be undone.')) return;
    state.notes = state.notes.filter(function (x) { return x.id !== n.id; });
    store.del(n.id);
    state.currentId = null;
    document.body.className = 'view-list';
    renderNav(); renderList(); renderEditor();
    toast('Note deleted');
  }
  function copyNote() {
    var n = current(); if (!n) return;
    var parts = [];
    if (n.title) parts.push(n.title);
    var body = htmlToText(n.body); if (body) parts.push(body);
    if (n.author) parts.push('— ' + n.author);
    var refs = parsedRefs(n).map(Bible.format); if (refs.length) parts.push(refs.join('; '));
    if (n.url) parts.push(n.url);
    var text = parts.join('\n\n');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      function () { toast('Copied to clipboard'); },
      function () { prompt('Copy this text:', text); }
    );
  }
  function addNotebook() {
    var name = prompt('Name for the new notebook (e.g. "Romans series", "Advent 2026"):');
    if (!name || !name.trim()) return null;
    var nb = { id: uid(), name: name.trim() };
    state.notebooks.push(nb);
    state.notebooks.sort(function (a, b) { return a.name.localeCompare(b.name); });
    store.setMeta('notebooks', state.notebooks);
    renderNav();
    return nb;
  }
  function editNotebook(nb) {
    var name = prompt('Rename notebook — or clear the name to delete it (notes are kept):', nb.name);
    if (name === null) return;
    if (!name.trim()) {
      if (!confirm('Delete notebook “' + nb.name + '”? Its notes will stay, just without a notebook.')) return;
      state.notebooks = state.notebooks.filter(function (x) { return x.id !== nb.id; });
      state.notes.forEach(function (n) { if (n.notebook === nb.id) { n.notebook = ''; store.put(n); } });
      if (state.filter.kind === 'notebook' && state.filter.value === nb.id) state.filter = { kind: 'all', value: null };
    } else {
      nb.name = name.trim();
    }
    store.setMeta('notebooks', state.notebooks);
    renderNav(); renderList(); if (current()) fillNotebookSelect(current().notebook);
  }
  function randomNote() {
    var list = visibleNotes();
    if (!list.length) return;
    openNote(list[Math.floor(Math.random() * list.length)].id);
  }

  // ---------- Backup ----------
  function exportAll() {
    var data = {
      app: 'sermon-notebook', version: 1, exported: now(),
      notebooks: state.notebooks,
      notes: state.notes.map(function (n) { var c = Object.assign({}, n); delete c._hay; delete c._hayAt; return c; })
    };
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'sermon-notebook-' + now().slice(0, 10) + '.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    store.setMeta('lastExport', now());
    toast('Backup downloaded');
  }
  function importAll(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var data;
      try { data = JSON.parse(fr.result); } catch (e) { toast('That file is not a valid backup.'); return; }
      if (!data || !Array.isArray(data.notes)) { toast('That file is not a Sermon Notebook backup.'); return; }
      var merge = true;
      if (state.notes.length) {
        merge = confirm('Import ' + data.notes.length + ' notes.\n\nOK = MERGE with your current notes (the newer copy of each note wins).\nCancel = choose to replace instead.');
        if (!merge && !confirm('REPLACE everything currently here with the backup? This deletes your current notes.')) return;
      }
      var byId = {};
      (merge ? state.notes : []).forEach(function (n) { byId[n.id] = n; });
      data.notes.forEach(function (n) {
        if (!n || !n.id) return;
        n.body = sanitize(n.body); n.tags = n.tags || []; n.scriptures = n.scriptures || [];
        n.usedIn = n.usedIn || []; n.images = n.images || [];
        if (!byId[n.id] || (n.updated || '') > (byId[n.id].updated || '')) byId[n.id] = n;
      });
      var nbs = {};
      (merge ? state.notebooks : []).concat(data.notebooks || []).forEach(function (nb) { if (nb && nb.id) nbs[nb.id] = nb; });
      var p = merge ? Promise.resolve() : store.clear();
      p.then(function () {
        state.notes = Object.keys(byId).map(function (k) { return byId[k]; });
        state.notebooks = Object.keys(nbs).map(function (k) { return nbs[k]; });
        return Promise.all(state.notes.map(store.put).concat([store.setMeta('notebooks', state.notebooks)]));
      }).then(function () {
        state.currentId = null; renderNav(); renderList(); renderEditor();
        toast('Imported ' + data.notes.length + ' notes');
      });
    };
    fr.readAsText(file);
  }

  // ---------- Samples ----------
  function loadSamples() {
    var nbId = uid();
    state.notebooks.push({ id: nbId, name: 'Sample: Grace series' });
    store.setMeta('notebooks', state.notebooks);
    var d = function (days) { return new Date(Date.now() - days * 86400000).toISOString(); };
    var samples = [
      { type: 'quote', title: 'More sinful… more loved', author: 'Tim Keller, The Meaning of Marriage',
        body: '<blockquote>The gospel is this: We are more sinful and flawed in ourselves than we ever dared believe, yet at the very same time we are more loved and accepted in Jesus Christ than we ever dared hope.</blockquote>',
        scriptures: ['Romans 5:8', 'Ephesians 2:4–5'], tags: ['grace', 'gospel', 'identity'], notebook: nbId, favorite: true },
      { type: 'illustration', title: 'Prodigal’s ring and robe', author: 'Kenneth Bailey, The Cross and the Prodigal',
        body: '<p>In a Middle Eastern village, a father running was shameful — he would have to hitch up his robes and expose his legs. The father in Luke 15 takes the shame on himself <i>before</i> the son can finish his speech.</p><p><b>Connection:</b> grace runs to us before our repentance is polished.</p>',
        scriptures: ['Luke 15:20–24'], tags: ['grace', 'repentance', 'father'], notebook: nbId },
      { type: 'motto', title: 'Grace isn’t opposed to effort; it’s opposed to earning.', author: 'Dallas Willard',
        body: '', scriptures: ['Philippians 2:12–13'], tags: ['grace', 'discipleship'] },
      { type: 'statement', title: 'Big idea: the Spirit’s new-creation life is breaking in now',
        body: '<p>Resurrection isn’t just life after death — it’s life after life after death (N. T. Wright). The Spirit is the down payment, so ordinary faithfulness now is not wasted.</p><ul><li>Rom 8 — groaning and hope</li><li>1 Cor 15:58 — your labor is not in vain</li></ul>',
        scriptures: ['Romans 8:18–25', '1 Corinthians 15:58'], tags: ['resurrection', 'hope', 'new creation'] },
      { type: 'idea', title: 'Series idea: “The Unseen Realm” in Psalm 82',
        body: '<p>Divine council worldview (Heiser) as a lens for Deut 32:8–9, Psalm 82, and Acts 2 as reversal of Babel. Possible 4-week series before Pentecost.</p>',
        scriptures: ['Psalm 82', 'Deuteronomy 32:8–9', 'Acts 2'], tags: ['spiritual warfare', 'pentecost', 'series idea'] },
      { type: 'reference', title: 'Bock on Luke 15 (BECNT)', author: 'Darrell Bock, Luke vol. 2, pp. 1301ff',
        body: '<p>Good on the older brother as the real target audience (Pharisees, 15:1–2). Check notes on “compassion” (σπλαγχνίζομαι).</p>',
        scriptures: ['Luke 15'], tags: ['commentary', 'grace'], notebook: nbId }
    ];
    samples.forEach(function (s, i) {
      var n = Object.assign(blankNote(s.type), s, { id: uid(), created: d(i * 3 + 1), updated: d(i * 2) });
      if (i === 1) n.usedIn = [{ date: d(40).slice(0, 10), sermon: 'The Running Father (Luke 15)' }];
      state.notes.push(n); store.put(n);
    });
    renderNav(); renderList();
    toast('Added ' + samples.length + ' example notes');
  }

  // ---------- Drawer (mobile) ----------
  function openDrawer() { document.documentElement.classList.add('drawer-open'); }
  function closeDrawer() { document.documentElement.classList.remove('drawer-open'); }

  // ---------- Wire up ----------
  function bind() {
    // New note menu
    var nt = $('#newTypes');
    TYPES.forEach(function (t) {
      nt.appendChild(el('button', { class: 'new-type', onclick: function () { newNote(t.id); } }, [
        el('span', { class: 'dot', style: 'background:' + t.color }), t.label
      ]));
    });
    $('#newBtn').addEventListener('click', function () { nt.classList.toggle('open'); });

    var ts = $('#fType');
    TYPES.forEach(function (t) { ts.appendChild(el('option', { value: t.id, text: t.label })); });
    ts.addEventListener('change', function () {
      var n = current(); n.type = ts.value;
      var t = TYPE[n.type];
      ts.style.setProperty('--c', t.color);
      $('#authorLabel').textContent = t.author;
      $('#fBody').setAttribute('data-placeholder', t.hint);
      saveSoon();
    });

    $('#fNotebook').addEventListener('change', function (e) {
      var n = current();
      if (e.target.value === '__new') {
        var nb = addNotebook();
        n.notebook = nb ? nb.id : n.notebook;
        fillNotebookSelect(n.notebook);
      } else n.notebook = e.target.value;
      saveSoon();
    });

    $('#fTitle').addEventListener('input', function (e) { current().title = e.target.value; saveSoon(); });
    $('#fTitle').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#fBody').focus(); } });
    $('#fAuthor').addEventListener('input', function (e) { current().author = e.target.value; saveSoon(); });
    $('#fUrl').addEventListener('input', function (e) { current().url = e.target.value.trim(); updateUrlOpen(); saveSoon(); });

    var body = $('#fBody');
    body.addEventListener('input', function () { current().body = body.innerHTML; saveSoon(); });
    body.addEventListener('paste', function (e) {
      var cd = e.clipboardData; if (!cd) return;
      var files = Array.prototype.filter.call(cd.files || [], function (f) { return /^image\//.test(f.type); });
      if (files.length) { e.preventDefault(); addImages(files); return; }
      var html = cd.getData('text/html');
      e.preventDefault();
      if (html) document.execCommand('insertHTML', false, sanitize(html));
      else document.execCommand('insertText', false, cd.getData('text/plain'));
    });
    body.addEventListener('drop', function (e) {
      var files = Array.prototype.filter.call(e.dataTransfer.files || [], function (f) { return /^image\//.test(f.type); });
      if (files.length) { e.preventDefault(); addImages(files); }
    });

    document.querySelectorAll('.toolbar [data-cmd]').forEach(function (b) {
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () {
        var c = b.getAttribute('data-cmd');
        body.focus();
        if (c === 'h3' || c === 'blockquote') {
          var cur = (document.queryCommandValue('formatBlock') || '').toLowerCase();
          document.execCommand('formatBlock', false, cur === c ? 'p' : c);
        } else document.execCommand(c, false, null);
        current().body = body.innerHTML; saveSoon();
      });
    });

    $('#imgInput').addEventListener('change', function (e) { addImages(e.target.files); e.target.value = ''; });
    $('#lightbox').addEventListener('click', function () { this.hidden = true; });

    // Chip inputs
    [['#fScripture', 'scriptures'], ['#fTags', 'tags']].forEach(function (p) {
      var inp = $(p[0]);
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || (e.key === ',' && p[1] === 'tags')) {
          e.preventDefault(); addChips(p[1], inp.value); inp.value = '';
        } else if (e.key === 'Backspace' && !inp.value) {
          var n = current(); if (n[p[1]].length) { n[p[1]] = n[p[1]].slice(0, -1); renderChips(p[1]); saveSoon(); }
        }
      });
      inp.addEventListener('blur', function () { if (inp.value.trim()) { addChips(p[1], inp.value); inp.value = ''; } });
      inp.addEventListener('change', function () {
        // datalist selection on some browsers fires change without Enter
        if (p[1] === 'tags' && inp.value && document.activeElement !== inp) { addChips('tags', inp.value); inp.value = ''; }
      });
    });
    document.querySelectorAll('.chip-input').forEach(function (w) {
      w.addEventListener('click', function (e) { if (e.target === w || e.target.classList.contains('chips')) $('input', w).focus(); });
    });

    $('#usedDate').value = new Date().toISOString().slice(0, 10);
    $('#usedForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var n = current(), s = $('#usedSermon').value.trim(), d = $('#usedDate').value;
      if (!s && !d) return;
      n.usedIn = (n.usedIn || []).concat({ date: d, sermon: s });
      $('#usedSermon').value = '';
      renderUsed(); saveSoon();
    });

    $('#favBtn').addEventListener('click', function () {
      var n = current(); n.favorite = !n.favorite;
      $('#favBtn').classList.toggle('on', n.favorite); saveSoon();
    });
    $('#deleteBtn').addEventListener('click', deleteNote);
    $('#copyBtn').addEventListener('click', copyNote);
    $('#backBtn').addEventListener('click', function () {
      flushEditor(); state.currentId = null;
      document.body.className = 'view-list'; renderNav(); renderList(); renderEditor();
    });

    $('#search').addEventListener('input', debounce(function (e) { state.query = e.target.value; renderList(); }, 120));
    $('#sort').addEventListener('change', function (e) { state.sort = e.target.value; store.setMeta('sort', state.sort); renderList(); });
    $('#randomBtn').addEventListener('click', randomNote);

    $('#menuBtn').addEventListener('click', openDrawer);
    $('#scrim').addEventListener('click', closeDrawer);

    $('#exportBtn').addEventListener('click', exportAll);
    $('#importInput').addEventListener('change', function (e) { if (e.target.files[0]) importAll(e.target.files[0]); e.target.value = ''; });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.new-wrap')) $('#newTypes').classList.remove('open');
    });
    document.addEventListener('keydown', function (e) {
      var typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
      if (e.key === 'Escape') { $('#lightbox').hidden = true; $('#newTypes').classList.remove('open'); closeDrawer(); }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n') { e.preventDefault(); newNote('idea'); }
      if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    });
    window.addEventListener('beforeunload', function () { var n = current(); if (n) { commitPendingChipInputs(); store.put(n); } });
    document.addEventListener('visibilitychange', function () { if (document.hidden) { var n = current(); if (n) store.put(n); } });
  }

  // ---------- Boot ----------
  openDB().then(function (d) {
    db = d;
    return Promise.all([store.all(), store.getMeta('notebooks'), store.getMeta('sort'), store.getMeta('collapsed')]);
  }).then(function (r) {
    state.notes = r[0] || [];
    state.notebooks = r[1] || [];
    state.sort = r[2] || 'updated';
    state.collapsed = r[3] || {};
    $('#sort').value = state.sort;
    bind(); renderNav(); renderList(); renderEditor();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  }).catch(function (e) {
    document.body.innerHTML = '<p style="padding:2rem">Could not open local storage: ' + (e && e.message || e) + '. Private browsing can block it.</p>';
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
