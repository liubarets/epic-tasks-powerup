/* global TrelloPowerUp, EpicAuth, EpicPoints */
// "Σ" board button popup: story points of one person in the TO DO list, plus a person picker
// that looks like Trello's own filter (checkbox on the left, points on the right, total on top).
// Reads everything through the Power-Up client (no token needed).
(function () {
  'use strict';
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var P = EpicPoints;
  var root = document.getElementById('root');
  var PAL = ['#1f845a', '#c9372c', '#6e5dc6', '#0c66e4', '#a54800', '#943d73', '#206a83', '#5e4db2', '#7f5f01', '#44546f'];
  var BOLT = '<svg class="sp-bolt" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2L4.5 14h6.5l-1 8 9-12h-6.5z" fill="currentColor"/></svg>';
  var CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SEARCH = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  // mode "pick": opened from the panel at the bottom of the board, shows only the person list.
  var mode = (t.arg && t.arg('mode')) || '';
  var state = mode === 'pick' ? { view: 'pick', q: '', focus: true } : { view: 'sum', q: '' };
  var channel = null;
  try { channel = new BroadcastChannel('epic-tasks-sp'); } catch (e) { channel = null; }
  var data = null;

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

  function avatarSrc(m) {
    var a = m.avatar || m.avatarUrl;
    if (!a || !/^https:\/\//.test(a)) return '';
    return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a) ? a : a.replace(/\/$/, '') + '/50.png';
  }

  function avatar(m, cls) {
    if (m.id === '_none') return '<span class="sp-av sp-av-none ' + cls + '">–</span>';
    var ini = '<span class="sp-av ' + cls + '" style="background:' + colorFor(m.id) + '">' + esc(initials(m)) + '</span>';
    var src = avatarSrc(m);
    return src ? '<img class="sp-av ' + cls + '" src="' + esc(src) + '" alt="" data-ini="' + esc(initials(m)) + '" data-bg="' + colorFor(m.id) + '">' : ini;
  }

  function load() {
    return Promise.all([
      t.get('board', 'shared', 'cfg', {}),
      t.board('id', 'members', 'customFields'),
      t.member('id', 'fullName', 'username', 'avatar', 'initials'),
      t.cards('id', 'name', 'idList', 'closed', 'members', 'customFieldItems'),
      t.lists('id', 'name'),
      t.get('member', 'private', 'spPerson'),
    ]).then(function (r) {
      var cfg = r[0] || {}, board = r[1] || {}, me = r[2] || {};
      var field = P.findField(board.customFields, cfg);
      var list = (r[4] || []).filter(function (l) { return l.id === cfg.todoListId; })[0];
      data = {
        cfg: cfg, me: me, members: board.members || [], field: field,
        listName: list ? list.name : 'TO DO',
        sum: P.summarize(r[3] || [], field && field.id, cfg.todoListId),
        person: r[5],
      };
      render();
    }).catch(function (e) {
      root.innerHTML = '<p class="msg error">' + esc((e && e.message) || e) + '</p>';
      return t.sizeTo('#root');
    });
  }

  function personOf(id) {
    if (id === '_none') return { id: '_none', fullName: 'No members' };
    return data.members.filter(function (m) { return m.id === id; })[0] || null;
  }

  // The person picked in the list; null until someone is picked (or after unpicking).
  function current() {
    return (data.person && personOf(data.person)) || null;
  }

  function stats(id) { return data.sum.by[id] || { points: 0, cards: 0, none: 0 }; }

  function subline(s) { return P.cardsWord(s.cards) + (s.none ? ' · ' + s.none + ' unestimated' : ''); }

  function render() {
    var cfg = data.cfg;
    if (!cfg.sp || !cfg.sp.on) {
      root.innerHTML = '<p class="msg">Story points are turned off on this board. Turn them on in Teamload settings.</p>';
    } else if (!cfg.todoListId) {
      root.innerHTML = '<p class="msg">Choose the TO DO list in Teamload settings first.</p>';
    } else if (state.view === 'pick') {
      renderPicker();
    } else {
      renderSum();
    }
    fixAvatars();
    return t.sizeTo('#root');
  }

  function renderSum() {
    var p = current();
    // Nobody picked: the button invites to pick, the number is the whole list.
    var s = p ? stats(p.id) : { points: data.sum.total, cards: data.sum.cards, none: data.sum.none };
    var who = p
      ? avatar(p, 'sp-av-28') + '<span class="sp-name">' + esc(p.fullName || p.username) + '</span>'
      : '<span class="sp-av sp-av-28 sp-av-pick">&#931;</span><span class="sp-name sp-name-pick">Choose a person</span>';
    root.innerHTML =
      '<div class="sp">' +
        '<div class="sp-label">Person</div>' +
        '<button type="button" class="sp-person" data-action="pick" aria-haspopup="listbox">' + who + CHEV + '</button>' +
        '<div class="sp-sum">' +
          '<div class="sp-big">' + P.fmt(s.points) + '</div>' +
          '<div class="sp-cap">story points in ' + esc(data.listName) + (p ? '' : ' · everyone') + '</div>' +
          '<div class="sp-sub">' + esc(subline(s)) + '</div>' +
        '</div>' +
      '</div>';
  }

  function options() {
    var meM = personOf(data.me.id) || { id: data.me.id, fullName: data.me.fullName, avatar: data.me.avatar, initials: data.me.initials };
    var others = data.members.filter(function (m) { return m.id !== data.me.id; }).slice()
      .sort(function (a, b) { return String(a.fullName || a.username).localeCompare(String(b.fullName || b.username)); });
    var opts = [{ m: meM, label: 'Me · ' + (meM.fullName || meM.username) }, { m: { id: '_none', fullName: 'No members' }, label: 'No members' }]
      .concat(others.map(function (m) { return { m: m, label: m.fullName || m.username }; }));
    var q = state.q.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter(function (o) { return (o.label + ' ' + (o.m.username || '')).toLowerCase().indexOf(q) !== -1; });
  }

  function renderPicker() {
    var tot = data.sum;
    root.innerHTML =
      '<div class="sp">' +
        (mode === 'pick' ? '' : '<button type="button" class="sp-back" data-action="back">‹ Back</button>') +
        '<div class="sp-total">' +
          '<span class="sp-sigma">&#931;</span>' +
          '<span class="sp-total-text"><b>Total in ' + esc(data.listName) + '</b><span>' + esc(subline({ cards: tot.cards, none: tot.none })) + '</span></span>' +
          '<span class="sp-total-num">' + BOLT.replace('width="12" height="12"', 'width="16" height="16"') + P.fmt(tot.total) + '</span>' +
        '</div>' +
        '<label class="sp-search">' + SEARCH + '<input type="text" id="q" placeholder="Find a person" aria-label="Find a person" value="' + esc(state.q) + '"></label>' +
        '<div class="sp-list" id="list" role="listbox" aria-label="Person"></div>' +
      '</div>';
    renderList();
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; renderList(); fixAvatars(); t.sizeTo('#root'); });
    if (state.focus) { q.focus(); state.focus = false; }
  }

  function renderList() {
    var cur = (current() || {}).id;
    var opts = options();
    var html = opts.map(function (o, i) {
      var s = stats(o.m.id), on = o.m.id === cur;
      return (i === 2 && !state.q.trim() ? '<div class="sp-divider"></div>' : '') +
        '<button type="button" class="sp-row' + (on ? ' on' : '') + '" role="option" aria-selected="' + on + '" data-id="' + esc(o.m.id) + '">' +
          '<span class="sp-check' + (on ? ' on' : '') + '"></span>' + avatar(o.m, 'sp-av-24') +
          '<span class="sp-row-name">' + esc(o.label) + '</span>' +
          '<span class="sp-pill' + (s.points ? '' : ' zero') + '">' + BOLT + P.fmt(s.points) + '</span>' +
        '</button>';
    }).join('');
    document.getElementById('list').innerHTML = html || '<p class="msg muted">Nobody found</p>';
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

  root.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !data) return;
    if (b.getAttribute('data-action') === 'pick') { state.view = 'pick'; state.q = ''; state.focus = true; render(); return; }
    if (b.getAttribute('data-action') === 'back') { state.view = 'sum'; render(); return; }
    var id = b.getAttribute('data-id');
    if (id) {
      // A click on the ticked person unpicks them (then the total for everyone is shown).
      if (current() && current().id === id) id = '';
      data.person = id;
      if (mode === 'pick') {
        // Picked from the panel: save, tell the panel, close this popup.
        Promise.resolve(t.set('member', 'private', 'spPerson', id)).catch(function () {}).then(function () {
          if (channel) channel.postMessage({ type: 'person', id: id });
          return t.closePopup();
        });
        return;
      }
      state.view = 'sum';
      render();
      Promise.resolve(t.set('member', 'private', 'spPerson', id)).catch(function () {});
    }
  });

  t.render(load);
})();
