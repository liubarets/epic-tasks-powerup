/* global TrelloPowerUp, EpicAuth, EpicPoints */
// "Estimate story points" window (a Trello modal opened from the panel at the bottom of the board):
// the TO DO cards of the person picked in the panel, one row each with quick values, so points can be set
// without opening every card. Cards estimated here stay in the "No estimate" tab (marked ✓) until the
// window is closed, so the rows don't jump under the mouse.
(function () {
  'use strict';
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var P = EpicPoints;
  var root = document.getElementById('root');
  var VALUES = [0.5, 1, 2, 3, 5, 8, 13, 21];
  var PAL = ['#1f845a', '#c9372c', '#6e5dc6', '#0c66e4', '#a54800', '#943d73', '#206a83', '#5e4db2', '#7f5f01', '#44546f'];
  var BOLT = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2L4.5 14h6.5l-1 8 9-12h-6.5z" fill="currentColor"/></svg>';
  var CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SEARCH = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" aria-label="Saved" role="img"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var DONE = '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#dcfff1"/><path d="M8 12.5l2.8 2.7L16.5 9.5" fill="none" stroke="#216e4e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var channel = null;
  try { channel = new BroadcastChannel('epic-tasks-sp'); } catch (e) { channel = null; }

  var data = null;
  var ui = {
    person: undefined, // '' = everyone, '_none' = cards without members, else a member id
    tab: 'none',
    keep: {},          // cards estimated in this window: stay listed with ✓
    base: [],          // cards that had no estimate when the person was picked (for the progress line)
    pending: {},       // cardId -> value being saved
    saved: {},         // cardId -> value saved here, until Trello reports it back
    errors: {},        // cardId -> message
    dd: false, q: '', authed: true,
  };
  var queue = Promise.resolve();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function colorFor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return PAL[h % PAL.length];
  }

  function initials(m) {
    if (m.initials) return m.initials.slice(0, 2).toUpperCase();
    var parts = String(m.fullName || m.username || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function avatar(m, cls) {
    if (m.id === '') return '<span class="sp-av sp-av-pick ' + cls + '">&#931;</span>';
    if (m.id === '_none') return '<span class="sp-av sp-av-none ' + cls + '">–</span>';
    var a = m.avatar || m.avatarUrl;
    if (a && /^https:\/\//.test(a)) {
      var src = /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a) ? a : a.replace(/\/$/, '') + '/50.png';
      return '<img class="sp-av ' + cls + '" src="' + esc(src) + '" alt="" data-ini="' + esc(initials(m)) + '" data-bg="' + colorFor(m.id) + '">';
    }
    return '<span class="sp-av ' + cls + '" style="background:' + colorFor(m.id) + '">' + esc(initials(m)) + '</span>';
  }

  function memberById(id) { return data.members.filter(function (m) { return m.id === id; })[0] || null; }

  function personObj(pid) {
    if (!pid) return { id: '', fullName: 'Everyone' };
    if (pid === '_none') return { id: '_none', fullName: 'No members' };
    return memberById(pid) || { id: '', fullName: 'Everyone' };
  }

  function ids(card) { return (card.members || []).map(function (m) { return m.id; }); }

  function mine() {
    var pid = ui.person;
    return data.todo.filter(function (c) {
      if (!pid) return true;
      if (pid === '_none') return ids(c).length === 0;
      return ids(c).indexOf(pid) !== -1;
    });
  }

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // What the window shows for a card: the value being saved, else the one just saved, else Trello's.
  function value(c) {
    if (has(ui.pending, c.id)) return ui.pending[c.id];
    if (has(ui.saved, c.id)) return ui.saved[c.id];
    return P.cardPoints(c, data.field && data.field.id);
  }

  function setPerson(pid) {
    ui.person = pid;
    ui.keep = {};
    ui.errors = {};
    ui.base = mine().filter(function (c) { return value(c) == null; }).map(function (c) { return c.id; });
    ui.tab = ui.base.length ? 'none' : 'all';
  }

  function load() {
    return Promise.all([
      t.get('board', 'shared', 'cfg', {}),
      t.board('id', 'members', 'customFields'),
      t.member('id', 'fullName', 'username', 'avatar', 'initials'),
      t.cards('id', 'name', 'idList', 'closed', 'members', 'customFieldItems', 'pos'),
      t.lists('id', 'name'),
      t.get('member', 'private', 'spPerson'),
      EpicAuth.isAuthorized(t),
    ]).then(function (r) {
      var cfg = r[0] || {}, board = r[1] || {}, cards = r[3] || [];
      var field = P.findField(board.customFields, cfg);
      var list = (r[4] || []).filter(function (l) { return l.id === cfg.todoListId; })[0];
      // Same order as in the list.
      var todo = cards.map(function (c, i) { return { c: c, i: i }; })
        .filter(function (x) { return !x.c.closed && x.c.idList === cfg.todoListId; })
        .sort(function (a, b) { return ((a.c.pos || 0) - (b.c.pos || 0)) || (a.i - b.i); })
        .map(function (x) { return x.c; });
      data = { cfg: cfg, field: field, me: r[2] || {}, members: board.members || [], cards: cards, todo: todo,
        listName: list ? list.name : 'TO DO' };
      ui.authed = !!r[6];
      // Trello now has the values saved here: stop overriding them.
      todo.forEach(function (c) {
        if (has(ui.saved, c.id) && P.cardPoints(c, field && field.id) === ui.saved[c.id]) delete ui.saved[c.id];
      });
      var pid = r[5] || '';
      if (pid !== '_none' && pid && !memberById(pid)) pid = '';
      if (ui.person === undefined || pid !== ui.person) setPerson(pid);
      render();
    }).catch(function (e) {
      root.innerHTML = '<p class="msg error est-msg">' + esc((e && e.message) || e) + '</p>';
    });
  }

  function stats() { return P.summarize(data.cards, data.field && data.field.id, data.cfg.todoListId); }

  function ddRows() {
    var sum = stats();
    var me = memberById(data.me.id) || { id: data.me.id, fullName: data.me.fullName, avatar: data.me.avatar, initials: data.me.initials };
    var others = data.members.filter(function (m) { return m.id !== data.me.id; }).slice()
      .sort(function (a, b) { return String(a.fullName || a.username).localeCompare(String(b.fullName || b.username)); });
    var opts = [
      { m: { id: '', fullName: 'Everyone' }, label: 'Everyone', s: { points: sum.total, none: sum.none } },
      { m: me, label: 'Me · ' + (me.fullName || me.username) },
      { m: { id: '_none', fullName: 'No members' }, label: 'No members' },
    ].concat(others.map(function (m) { return { m: m, label: m.fullName || m.username }; }));
    var q = ui.q.trim().toLowerCase();
    if (q) opts = opts.filter(function (o) { return (o.label + ' ' + (o.m.username || '')).toLowerCase().indexOf(q) !== -1; });
    var html = opts.map(function (o, i) {
      var s = o.s || sum.by[o.m.id] || { points: 0, none: 0 };
      var on = o.m.id === ui.person;
      return ((i === 1 || i === 3) && !q ? '<div class="sp-divider"></div>' : '') +
        '<button type="button" class="sp-row' + (on ? ' on' : '') + '" role="option" aria-selected="' + on + '" data-pid="' + esc(o.m.id) + '">' +
          '<span class="sp-check' + (on ? ' on' : '') + '"></span>' + avatar(o.m, 'sp-av-24') +
          '<span class="sp-row-name">' + esc(o.label) + '</span>' +
          (s.none ? '<span class="est-q" title="' + s.none + ' without estimate">?' + s.none + '</span>' : '') +
          '<span class="sp-pill' + (s.points ? '' : ' zero') + '">' + BOLT + P.fmt(s.points) + '</span>' +
        '</button>';
    }).join('');
    return html || '<p class="msg muted">Nobody found</p>';
  }

  function rowHtml(c, showMembers) {
    var cur = value(c), busy = has(ui.pending, c.id), err = ui.errors[c.id];
    var st = err ? '<span class="est-st err" title="' + esc(err) + '">!</span>'
      : (ui.keep[c.id] && cur != null && !busy ? '<span class="est-st">' + CHECK + '</span>' : '<span class="est-st"></span>');
    var ms = showMembers ? '<span class="est-ms">' + (c.members || []).slice(0, 2).map(function (m) {
      return avatar(memberById(m.id) || m, 'sp-av-24');
    }).join('') + '</span>' : '';
    return '<div class="est-row" data-row="' + esc(c.id) + '">' + st +
      '<button type="button" class="est-title" data-open="' + esc(c.id) + '" title="' + esc(c.name) + '">' + esc(c.name) + '</button>' + ms +
      '<div class="est-chips" role="group" aria-label="' + esc('Story points for ' + c.name) + '">' +
        VALUES.map(function (v) {
          var on = cur === v;
          return '<button type="button" class="est-chip' + (on ? ' on' : '') + '" data-card="' + esc(c.id) + '" data-v="' + v + '" aria-pressed="' + on + '"' +
            (ui.authed ? '' : ' disabled') + '>' + P.fmt(v) + '</button>';
        }).join('') +
      '</div>' +
      (err ? '<div class="est-rowerr">' + esc(err) + '</div>' : '') +
    '</div>';
  }

  function render() {
    var cfg = data.cfg;
    if (!cfg.sp || !cfg.sp.on) {
      root.innerHTML = '<p class="msg est-msg">Story points are turned off on this board. Turn them on in Teamload settings.</p>';
      return;
    }
    if (!cfg.todoListId) {
      root.innerHTML = '<p class="msg est-msg">Choose the TO DO list in Teamload settings first.</p>';
      return;
    }
    if (!data.field) {
      root.innerHTML = '<p class="msg est-msg">The “' + esc(P.FIELD_NAME) + '” field isn’t on this board yet. Create it in Teamload settings.</p>';
      return;
    }
    // Keep the scroll position and the focused button across redraws.
    var oldList = document.getElementById('list');
    var scroll = oldList ? oldList.scrollTop : 0;
    var a = document.activeElement, focusSel = null;
    if (a && a.getAttribute) {
      if (a.getAttribute('data-card')) focusSel = '[data-card="' + a.getAttribute('data-card') + '"][data-v="' + a.getAttribute('data-v') + '"]';
      else if (a.getAttribute('data-tab')) focusSel = '[data-tab="' + a.getAttribute('data-tab') + '"]';
    }

    var p = personObj(ui.person);
    var all = mine();
    var none = all.filter(function (c) { return value(c) == null; }).length;
    var rows = ui.tab === 'none' ? all.filter(function (c) { return value(c) == null || ui.keep[c.id]; }) : all;
    var done = ui.base.filter(function (id) {
      var c = data.todo.filter(function (x) { return x.id === id; })[0];
      return c && value(c) != null;
    }).length;
    var pct = ui.base.length ? Math.round(done * 100 / ui.base.length) : 100;
    var empty = ui.tab === 'none'
      ? '<div class="est-empty">' + DONE + 'All cards in ' + esc(data.listName) + ' have an estimate.</div>'
      : '<div class="est-empty">No cards in ' + esc(data.listName) + '.</div>';

    root.innerHTML =
      '<div class="est">' +
        (ui.authed ? '' : '<div class="est-banner"><span>Connect Teamload to set story points here.</span>' +
          '<button type="button" class="mod-primary" data-action="connect">Connect</button></div>') +
        '<div class="est-bar">' +
          '<div class="est-who">' +
            '<button type="button" class="est-person" data-action="dd" aria-haspopup="listbox" aria-expanded="' + ui.dd + '">' +
              avatar(p, 'sp-av-24') + '<span>' + esc((p.fullName || p.username) + ' · ' + data.listName) + '</span>' + CHEV + '</button>' +
            (ui.dd ? '<div class="est-dd"><label class="sp-search">' + SEARCH +
              '<input type="text" id="q" placeholder="Find a person" aria-label="Find a person" value="' + esc(ui.q) + '"></label>' +
              '<div class="est-dd-list" id="ddlist" role="listbox" aria-label="Person">' + ddRows() + '</div></div>' : '') +
          '</div>' +
          '<div class="est-tabs" role="tablist" aria-label="Cards">' +
            '<button type="button" role="tab" class="est-tab' + (ui.tab === 'none' ? ' on' : '') + '" data-tab="none" aria-selected="' + (ui.tab === 'none') + '">' +
              'No estimate<span class="est-count' + (none ? ' warn' : '') + '">' + none + '</span></button>' +
            '<button type="button" role="tab" class="est-tab' + (ui.tab === 'all' ? ' on' : '') + '" data-tab="all" aria-selected="' + (ui.tab === 'all') + '">' +
              'All<span class="est-count">' + all.length + '</span></button>' +
          '</div>' +
          '<span class="est-grow"></span>' +
          (ui.base.length ? '<div class="est-prog"><span>' + done + ' of ' + ui.base.length + ' estimated</span>' +
            '<div class="est-track"><span style="width:' + pct + '%"></span></div></div>' : '') +
        '</div>' +
        '<div class="est-head"><span class="c1"></span><span class="c2">Card</span><span class="c3">Story points</span></div>' +
        '<div class="est-list" id="list">' + (rows.length ? rows.map(function (c) { return rowHtml(c, !ui.person); }).join('') : empty) + '</div>' +
        '<div class="est-foot">Cards are in the same order as in the ' + esc(data.listName) + ' list. Click a card name to open it.</div>' +
      '</div>';

    var list = document.getElementById('list');
    if (list) list.scrollTop = scroll;
    if (focusSel) { var f = root.querySelector(focusSel); if (f) f.focus(); }
    if (ui.dd) {
      var q = document.getElementById('q');
      q.addEventListener('input', function () { ui.q = q.value; document.getElementById('ddlist').innerHTML = ddRows(); fixAvatars(); });
    }
    fixAvatars();
  }

  // A member photo that fails to load falls back to initials.
  function fixAvatars() {
    Array.prototype.forEach.call(root.querySelectorAll('img.sp-av'), function (img) {
      img.addEventListener('error', function () {
        var s = document.createElement('span');
        s.className = img.className;
        s.style.background = img.getAttribute('data-bg');
        s.textContent = img.getAttribute('data-ini');
        img.replaceWith(s);
      }, { once: true });
    });
  }

  function save(id, v) {
    var c = data.todo.filter(function (x) { return x.id === id; })[0];
    if (!c || !data.field || !ui.authed) return;
    if (value(c) === v && !has(ui.pending, id)) return;
    var fieldId = data.field.id, cfg = data.cfg, name = c.name;
    ui.pending[id] = v;
    ui.keep[id] = true;
    delete ui.errors[id];
    render();
    // One request at a time, in the order of the clicks.
    queue = queue.then(function () {
      return P.setValue(t, id, fieldId, v).then(function () {
        // With "move [n] from titles" on, a leftover [n] would overwrite the value picked here, so it goes too.
        var clean = P.strip(name);
        if (cfg.sp && cfg.sp.migrate && clean && clean !== name) return EpicAuth.request(t, 'PUT', '/cards/' + id, { name: clean });
      }).then(function () {
        if (ui.pending[id] === v) { delete ui.pending[id]; ui.saved[id] = v; }
        render();
      }, function (e) {
        if (ui.pending[id] === v) delete ui.pending[id];
        ui.errors[id] = (e && e.message) || String(e);
        if (e && e.isAuthError) ui.authed = false;
        render();
      });
    });
  }

  root.addEventListener('click', function (e) {
    if (!data) return;
    var b = e.target.closest('button');
    if (!b) return;
    var action = b.getAttribute('data-action');
    if (action === 'connect') {
      Promise.resolve(EpicAuth.authorize(t)).then(load).catch(function () {});
      return;
    }
    if (action === 'dd') {
      ui.dd = !ui.dd; ui.q = '';
      render();
      if (ui.dd) document.getElementById('q').focus();
      return;
    }
    if (b.hasAttribute('data-pid')) {
      var pid = b.getAttribute('data-pid');
      ui.dd = false;
      setPerson(pid);
      render();
      // The panel at the bottom shows the same person.
      Promise.resolve(t.set('member', 'private', 'spPerson', pid)).catch(function () {}).then(function () {
        if (channel) channel.postMessage({ type: 'person', id: pid });
      });
      return;
    }
    if (b.hasAttribute('data-tab')) { ui.tab = b.getAttribute('data-tab'); render(); return; }
    if (b.hasAttribute('data-open')) { t.showCard(b.getAttribute('data-open')); return; }
    if (b.hasAttribute('data-card')) { save(b.getAttribute('data-card'), parseFloat(b.getAttribute('data-v'))); }
  });

  // Clicking elsewhere or Esc closes the person list.
  document.addEventListener('click', function (e) {
    if (ui.dd && !e.target.closest('.est-who')) { ui.dd = false; render(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.dd) { ui.dd = false; render(); }
  });

  t.render(load);
})();
