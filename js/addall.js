/* global TrelloPowerUp, EpicAuth, EpicTodo */
// "Add to TO DO" popup, opened by the "＋ Add all to TO DO" button in the TASKS header.
// Trello only lets a button open a popup straight away, so the data is loaded here, inside it.
(function () {
  'use strict';
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var root = document.getElementById('root');
  var state = { d: null, items: [], busy: false, finished: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function plural(n) { return n + ' TO DO card' + (n === 1 ? '' : 's'); }

  function show(html) {
    root.innerHTML = html;
    return Promise.resolve(t.sizeTo('#root')).catch(function () {});
  }

  function message(text, cls) { return show('<p class="msg' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</p>'); }

  function load() {
    return EpicAuth.isAuthorized(t).then(function (ok) {
      if (!ok) {
        return show('<p class="msg">Connect Epic Tasks to your Trello account first.</p>' +
          '<button class="mod-primary" data-action="auth">Connect</button>');
      }
      return EpicTodo.load(t).then(function (d) {
        var err = EpicTodo.todoListError(d);
        if (err) return message(err.message);
        var groups = d.checklists
          .map(function (cl) { return { cl: cl, jobs: EpicTodo.pendingInChecklist(d, cl) }; })
          .filter(function (g) { return g.jobs.length; });
        if (!groups.length) return message('Nothing to add: every open item with an assignee already has a TO DO card.');
        var items = groups.map(function (g) { return { text: g.cl.name + ' (' + g.jobs.length + ')', jobs: g.jobs }; });
        if (groups.length > 1) {
          var all = [];
          groups.forEach(function (g) { all = all.concat(g.jobs); });
          items.unshift({ text: 'All tasks (' + all.length + ')', jobs: all });
        }
        state.d = d;
        state.items = items;
        return show('<ul class="menu">' + items.map(function (it, i) {
          return '<li><button data-i="' + i + '">' + esc(it.text) + '</button></li>';
        }).join('') + '</ul>');
      });
    }).catch(function (e) {
      return message((e && e.message) || String(e), 'error');
    });
  }

  function add(item) {
    state.busy = true;
    message('Creating ' + plural(item.jobs.length) + '…');
    return EpicTodo.addMany(t, state.d, item.jobs).then(function (n) {
      state.finished = true;
      // The TASKS section reloads by itself: Trello re-renders it when the links in pluginData change.
      return Promise.resolve(t.alert({ message: '✓ Created ' + plural(n), display: 'success', duration: 5 }))
        .catch(function () {})
        .then(function () { return t.closePopup(); })
        .catch(function () { return message('✓ Created ' + plural(n)); });
    }, function (e) {
      state.busy = false;
      return message((e && e.message) || String(e), 'error');
    });
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || state.busy) return;
    if (b.getAttribute('data-action') === 'auth') {
      EpicAuth.authorize(t).then(load).catch(function (err) { message((err && err.message) || String(err), 'error'); });
      return;
    }
    var item = state.items[Number(b.getAttribute('data-i'))];
    if (item) add(item);
  });

  // Trello also calls this when pluginData changes (e.g. right after cards were created): don't redraw then.
  t.render(function () {
    if (state.busy || state.finished) return;
    return load();
  });
})();
