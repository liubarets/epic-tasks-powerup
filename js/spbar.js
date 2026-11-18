/* global TrelloPowerUp, EpicAuth, EpicPoints */
// Story points panel at the bottom of the board (Trello's board bar). One line: the picked person and
// their points in TO DO. It refreshes by itself: whenever Trello reports a change, and every 10 s as a fallback.
// A click on the person opens Trello's popup with the person list (storypoints.html in "pick" mode);
// "N unestimated" opens a big window to set points without opening the cards (estimate.html).
(function () {
  'use strict';
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var P = EpicPoints;
  var root = document.getElementById('root');
  var PAL = ['#1f845a', '#c9372c', '#6e5dc6', '#0c66e4', '#a54800', '#943d73', '#206a83', '#5e4db2', '#7f5f01', '#44546f'];
  var BOLT = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2L4.5 14h6.5l-1 8 9-12h-6.5z" fill="currentColor"/></svg>';
  var CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var loading = false, again = false, last = '';
  var channel = null;
  try { channel = new BroadcastChannel('epic-tasks-sp'); } catch (e) { channel = null; }

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

  function avatar(m) {
    if (m.id === '_none') return '<span class="sp-av sp-av-24 sp-av-none">–</span>';
    var a = m.avatar || m.avatarUrl;
    if (a && /^https:\/\//.test(a)) {
      var src = /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a) ? a : a.replace(/\/$/, '') + '/50.png';
      return '<img class="sp-av sp-av-24" src="' + esc(src) + '" alt="" data-ini="' + esc(initials(m)) + '" data-bg="' + colorFor(m.id) + '">';
    }
    return '<span class="sp-av sp-av-24" style="background:' + colorFor(m.id) + '">' + esc(initials(m)) + '</span>';
  }

  // Coalesced: a burst of changes on the board causes one recount, not many.
  function load() {
    if (loading) { again = true; return Promise.resolve(); }
    loading = true;
    return Promise.all([
      t.get('board', 'shared', 'cfg', {}),
      t.board('members', 'customFields'),
      t.cards('id', 'name', 'idList', 'closed', 'members', 'customFieldItems'),
      t.lists('id', 'name'),
      t.get('member', 'private', 'spPerson'),
    ]).then(function (r) {
      render(r[0] || {}, r[1] || {}, r[2] || [], r[3] || [], r[4]);
    }).catch(function () { /* keep the last numbers */ }).then(function () {
      loading = false;
      if (again) { again = false; load(); }
    });
  }

  function render(cfg, board, cards, lists, pid) {
    var html;
    if (!cfg.sp || !cfg.sp.on || !cfg.todoListId) {
      html = '<div class="spbar"><span class="spbar-msg">Turn on story points and choose the TO DO list in Teamload settings.</span></div>';
    } else {
      var field = P.findField(board.customFields, cfg);
      var sum = P.summarize(cards, field && field.id, cfg.todoListId);
      var list = lists.filter(function (l) { return l.id === cfg.todoListId; })[0];
      var person = pid === '_none' ? { id: '_none', fullName: 'No members' }
        : (board.members || []).filter(function (m) { return m.id === pid; })[0];
      var s = person ? (sum.by[person.id] || { points: 0, cards: 0, none: 0 }) : { points: sum.total, cards: sum.cards, none: sum.none };
      var who = person
        ? avatar(person) + '<span class="spbar-name">' + esc(person.fullName || person.username) + '</span>'
        : '<span class="sp-av sp-av-24 sp-av-pick">&#931;</span><span class="spbar-name sp-name-pick">Choose a person</span>';
      html =
        '<div class="spbar">' +
          '<span class="spbar-pill">' + esc(list ? list.name : 'TO DO') + '</span>' +
          '<button type="button" class="spbar-person" data-action="pick" aria-haspopup="listbox">' + who + CHEV + '</button>' +
          '<span class="spbar-sep"></span>' +
          '<span class="spbar-num">' + P.fmt(s.points) + '</span>' +
          '<span class="spbar-unit">' + (person ? 'points' : 'points · everyone') + '</span>' +
          '<span class="spbar-sub">' + esc(P.cardsWord(s.cards)) + '</span>' +
          // Opens the big "Estimate story points" window (estimate.html).
          (s.cards ? '<button type="button" class="spbar-est' + (s.none ? ' warn' : ' ok') + '" data-action="estimate" aria-haspopup="dialog">' +
            BOLT + esc(s.none ? s.none + ' unestimated' : 'All estimated') + '</button>' : '') +
        '</div>';
    }
    if (html === last) return;  // nothing changed: don't touch the page (keeps it calm)
    last = html;
    root.innerHTML = html;
    Array.prototype.forEach.call(root.querySelectorAll('img.sp-av'), function (img) {
      img.addEventListener('error', function () {
        var sp = document.createElement('span');
        sp.className = img.className;
        sp.style.background = img.getAttribute('data-bg');
        sp.textContent = img.getAttribute('data-ini');
        img.replaceWith(sp);
      }, { once: true });
    });
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.getAttribute('data-action') === 'estimate') {
      // Big window in the middle of the screen: every card of the person in one row, with quick values.
      t.modal({ url: './estimate.html', title: 'Estimate story points', height: 680, callback: function () { load(); } });
      return;
    }
    // From inside an iframe Trello needs the click to place the popup next to it.
    t.popup({ title: 'Story points', url: './storypoints.html', args: { mode: 'pick' }, mouseEvent: e, height: 420 });
  });

  if (channel) channel.onmessage = function (ev) { if ((ev.data || {}).type === 'person') load(); };
  t.render(load);
  setInterval(load, 10000);
})();
