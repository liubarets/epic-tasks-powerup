/* global TrelloPowerUp, EpicCore, EpicAuth, EpicTodo */
// Card-back section: priorities + "add to TO DO" buttons per assignee for every checklist item.
// "Add all to TO DO" lives in the section header (see client.js).
(function () {
  'use strict';
  var Core = EpicCore;
  var Todo = EpicTodo;
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var root = document.getElementById('root');

  var ui = { mine: false, hideDone: false, busy: {}, error: null };
  var data = null;

  function api(method, path, params) { return Todo.api(t, method, path, params); }

  // Hands REST calls to the connector (client.js), which stays loaded while the board is open,
  // so they finish even if the epic is closed right after the click. Without an answer from it
  // (e.g. an old cached version) the calls run here.
  var channel = null;
  try { channel = new BroadcastChannel('epic-tasks-addall'); } catch (e) { channel = null; }
  var pendingOps = {};
  if (channel) {
    channel.onmessage = function (ev) {
      var m = ev.data || {};
      var p = m.id && pendingOps[m.id];
      if (!p) return;
      if (m.type === 'ops-ack') p.acked = true;
      else if (m.type === 'ops-done') { delete pendingOps[m.id]; if (m.error) p.reject(new Error(m.error)); else p.resolve(); }
    };
  }

  function runOps(ops) {
    function here() {
      return ops.reduce(function (p, op) { return p.then(function () { return api(op.method, op.path, op.params); }); }, Promise.resolve());
    }
    if (!channel || !ops.length) return here();
    return new Promise(function (resolve, reject) {
      var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var p = pendingOps[id] = { acked: false, resolve: resolve, reject: reject };
      channel.postMessage({ type: 'ops', id: id, ops: ops });
      setTimeout(function () {
        if (p.acked || !pendingOps[id]) return;
        delete pendingOps[id];
        here().then(resolve, reject);
      }, 700);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2);
  }

  function resize() { return t.sizeTo(document.body).catch(function () {}); }

  function linkedCard(itemId, memberId) { return Todo.linkedCard(data, itemId, memberId); }

  // Keeps epic items in step with their TO DO cards:
  // - an open item whose assignees all have cards in Done is ticked;
  // - a ticked item is unticked when one of its cards left Done after the item was ticked
  //   (from Trello's action history, so manual ticks made after that are respected).
  function syncItems(d) {
    if (d.cfg.autoComplete === false) return Promise.resolve();
    var done = d.cfg.doneListIds;
    var jobs = [];
    var candidates = []; // ticked items with a live card outside Done: [{ item, cards }]
    function setState(it, state) {
      it.state = state;
      jobs.push(api('PUT', '/cards/' + d.card.id + '/checkItem/' + it.id, { state: state }));
    }
    d.checklists.forEach(function (cl) {
      cl.checkItems.forEach(function (it) {
        var cards = Core.allAssignees(it, d.board.members, d.alive)
          .filter(function (a) { return !a.unknown; })
          .map(function (a) { return Todo.linkedCard(d, it.id, a.id); });
        if (it.state !== 'complete') {
          if (cards.length && cards.every(function (c) { return Core.isCardDone(c, done); })) setState(it, 'complete');
          return;
        }
        var open = cards.filter(function (c) { return c && !Core.isCardDone(c, done); });
        if (open.length) candidates.push({ item: it, cards: open });
      });
    });
    if (!candidates.length) return Promise.all(jobs);
    // 1) When did those cards last leave Done? One batched request for all of them.
    var cards = [];
    candidates.forEach(function (x) { x.cards.forEach(function (c) { if (cards.indexOf(c) === -1) cards.push(c); }); });
    return Todo.moveHistory(t, cards.map(function (c) { return c.id; })).then(function (hist) {
      var leftAt = {};
      cards.forEach(function (c, i) { leftAt[c.id] = Core.lastLeftDone(hist[i], done); });
      var moved = candidates.filter(function (x) { return x.cards.some(function (c) { return leftAt[c.id]; }); });
      if (!moved.length) return null;  // no card left Done: nothing to reopen, no need for the epic's history
      // 2) Only then: the epic's ticks since the earliest of those moves (a tick before it means "reopen").
      var since = moved.map(function (x) {
        return x.cards.map(function (c) { return leftAt[c.id]; }).filter(Boolean).sort()[0];
      }).sort()[0];
      return api('GET', '/cards/' + d.card.id + '/actions', { filter: 'updateCheckItemStateOnCard', since: since, limit: 1000, fields: 'date,data' })
        .then(function (ticks) {
          moved.forEach(function (x) {
            var tickedAt = Core.lastTicked(ticks, x.item.id);
            if (x.cards.some(function (c) { return Core.shouldReopen(tickedAt, leftAt[c.id]); })) setState(x.item, 'incomplete');
          });
        });
    }).then(function () { return Promise.all(jobs); });
  }

  // ------------------------------------------------------------------ actions

  // The item and its linked TO DO cards (not done yet) get the new emoji, wherever it stands in the name.
  // The change is shown at once and finished in the background (see runOps).
  function setPriority(itemId, level) {
    var f = Todo.findItem(data, itemId);
    if (!f) return Promise.resolve();
    var newName = Core.withPriority(f.item.name, level);
    var ops = [{ method: 'PUT', path: '/cards/' + data.card.id + '/checkItem/' + itemId, params: { name: newName } }];
    Core.allAssignees(f.item, data.board.members, data.alive)
      .filter(function (a) { return !a.unknown; })
      .map(function (a) { return linkedCard(itemId, a.id); })
      .filter(function (c, i, all) { return c && !Core.isCardDone(c, data.cfg.doneListIds) && all.indexOf(c) === i; })
      .forEach(function (c) {
        c.name = Core.withPriority(c.name, level);
        ops.push({ method: 'PUT', path: '/cards/' + c.id, params: { name: c.name } });
      });
    f.item.name = newName;
    render();
    return runOps(ops);
  }

  function sortChecklist(clId) {
    var cl = data.checklists.filter(function (c) { return c.id === clId; })[0];
    if (!cl) return Promise.resolve();
    var sorted = Core.sortByPriority(cl.checkItems);
    if (Core.sameOrder(sorted, cl.checkItems)) return Promise.resolve();
    // Sequential "bottom" moves give a deterministic final order.
    return runOps(sorted.map(function (it) {
      return { method: 'PUT', path: '/cards/' + data.card.id + '/checkItem/' + it.id, params: { pos: 'bottom' } };
    }));
  }

  // ------------------------------------------------------------------ render

  function chipHtml(item, a) {
    var isMe = data.me && a.id === data.me.id;
    var cls = 'chip' + (isMe ? ' me' : '');
    var who = '@' + esc(a.username);
    if (a.unknown) {
      return '<span class="' + cls + ' unknown" title="Not a member of this board">' + who + '</span>';
    }
    var busyKey = item.id + ':' + a.id;
    if (ui.busy[busyKey]) return '<span class="' + cls + ' busy">' + who + ' · …</span>';
    var c = linkedCard(item.id, a.id);
    if (c) {
      var done = Core.isCardDone(c, data.cfg.doneListIds);
      var where = '✓ ' + (done ? 'DONE' : esc(data.listName[c.idList] || 'TO DO'));
      return '<button class="' + cls + (done ? ' done' : ' linked') + '" data-action="open" data-card="' + esc(c.id) +
        '" title="Open card">' + who + ' <span class="st">' + where + '</span></button>';
    }
    if (item.state === 'complete') return '<span class="' + cls + '">' + who + '</span>';
    return '<button class="' + cls + ' add" data-action="todo" data-item="' + esc(item.id) + '" data-member="' + esc(a.id) +
      '" title="Create a TO DO card for @' + esc(a.username) + '">' + who + ' <span class="st">＋ TO DO</span></button>';
  }

  function itemHtml(item) {
    // Mentioned people + those who took the item via "Assign to me".
    var people = Core.allAssignees(item, data.board.members, data.alive);
    var mine = people.some(function (a) { return data.me && a.id === data.me.id; });
    if (ui.mine && !mine) return '';
    var done = item.state === 'complete';
    if (ui.hideDone && done) return '';
    var level = Core.parsePriority(item.name);

    var opts = '<option value="0"' + (level ? '' : ' selected') + '>—</option>' +
      Core.PRIORITIES.map(function (p) {
        return '<option value="' + p.level + '"' + (p.level === level ? ' selected' : '') + '>' + p.emoji + ' ' + p.short + '</option>';
      }).join('');

    var chips = people.map(function (a) { return chipHtml(item, a); }).join('');
    if (!mine && !done && data.me) {
      var bk = item.id + ':' + data.me.id;
      chips += ui.busy[bk] ? '<span class="chip busy">…</span>' :
        '<button class="chip ghost" data-action="todo" data-item="' + esc(item.id) + '" data-member="' + esc(data.me.id) +
        '">＋ Assign to me</button>';
    }
    var due = item.due ? '<span class="due' + (!done && new Date(item.due) < new Date() ? ' overdue' : '') + '">' + fmtDate(item.due) + '</span>' : '';

    return '<li class="item' + (done ? ' done' : '') + '">' +
      '<select class="prio" data-action="prio" data-item="' + esc(item.id) + '" title="Priority">' + opts + '</select>' +
      '<div class="body"><div class="title">' + esc(Core.cleanTitle(item.name)) + due + '</div>' +
      '<div class="chips">' + chips + '</div></div></li>';
  }

  function checklistHtml(cl) {
    var total = cl.checkItems.length;
    var done = cl.checkItems.filter(function (i) { return i.state === 'complete'; }).length;
    var rows = cl.checkItems.map(itemHtml).join('');
    if (!rows && (ui.mine || ui.hideDone)) return '';
    var pct = total ? Math.round(done / total * 100) : 0;
    return '<section class="cl"><div class="cl-head">' +
      '<span class="cl-name">' + esc(cl.name) + '</span>' +
      '<span class="cl-count">' + done + '/' + total + '</span>' +
      '<span class="bar"><span style="width:' + pct + '%"></span></span>' +
      '<span class="cl-actions">' +
      '<button class="link" data-action="sort" data-cl="' + esc(cl.id) + '" title="Sort items: P1 → P2 → P3 → no priority">↕ Sort by priority</button>' +
      '</span>' +
      '</div><ul>' + rows + '</ul></section>';
  }

  function render() {
    if (!data) return;
    var d = data;
    var openP1 = 0;
    d.checklists.forEach(function (cl) {
      cl.checkItems.forEach(function (i) { if (i.state !== 'complete' && Core.parsePriority(i.name) === 1) openP1++; });
    });
    var html = '<div class="toolbar">' +
      '<label class="toggle"><input type="checkbox" data-action="mine"' + (ui.mine ? ' checked' : '') + '> Only mine</label>' +
      '<label class="toggle"><input type="checkbox" data-action="hideDone"' + (ui.hideDone ? ' checked' : '') + '> Hide completed</label>' +
      (openP1 ? '<span class="pill p1">🔴 open P1: ' + openP1 + '</span>' : '') +
      '<span class="spacer"></span>' +
      '<button class="icon" data-action="refresh" title="Refresh">⟳</button>' +
      '<button class="icon" data-action="settings" title="Settings">⚙</button></div>';
    if (ui.error) html += '<div class="error">' + esc(ui.error) + '</div>';
    if (!d.cfg.todoListId) {
      html += '<div class="notice">Choose the list for TO DO cards. ' +
        '<button class="link" data-action="settings">Open settings</button></div>';
    }
    var body = d.checklists.map(checklistHtml).join('');
    html += body || '<div class="muted">No items match the filter.</div>';
    root.innerHTML = html;
    resize();
  }

  function renderAuth() {
    root.innerHTML = '<div class="auth"><p>To set priorities and add items to TO DO, ' +
      'connect Teamload to your Trello account. You only need to do this <b>once</b>.</p>' +
      '<button class="mod-primary" data-action="auth">Connect</button></div>';
    resize();
  }

  // Trello re-renders the section when Power-Up data changes, often right after our own refresh:
  // overlapping refreshes are merged into one more run after the current one.
  var refreshing = null;
  var refreshAgain = false;
  function refresh() {
    if (refreshing) { refreshAgain = true; return refreshing; }
    refreshing = doRefresh().then(function () {
      refreshing = null;
      if (refreshAgain) { refreshAgain = false; return refresh(); }
    });
    return refreshing;
  }

  function doRefresh() {
    return EpicAuth.isAuthorized(t).then(function (ok) {
      if (!ok) { data = null; renderAuth(); return; }
      return Todo.load(t).then(function (d) {
        data = d;
        return syncItems(d);
      }).then(render);
    }).catch(handleError);
  }

  function handleError(e) {
    if (e && e.isAuthError) { data = null; renderAuth(); return; }
    ui.error = (e && e.message) || String(e);
    if (data) render();
    else { root.innerHTML = '<div class="error">' + esc(ui.error) + '</div>'; resize(); }
  }

  function run(promise) {
    ui.error = null;
    return promise.then(refresh, function (e) { handleError(e); return refresh(); });
  }

  // ------------------------------------------------------------------ events

  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT' || el.type === 'checkbox') return;
    var a = el.getAttribute('data-action');
    if (a === 'auth') {
      EpicAuth.authorize(t).then(refresh).catch(handleError);
    } else if (a === 'refresh') {
      refresh();
    } else if (a === 'settings') {
      t.popup({ title: 'Teamload — settings', url: './settings.html', height: 420, mouseEvent: e });
    } else if (a === 'open') {
      t.showCard(el.getAttribute('data-card'));
    } else if (a === 'todo') {
      var key = el.getAttribute('data-item') + ':' + el.getAttribute('data-member');
      if (ui.busy[key]) return;
      ui.busy[key] = 1; render();
      run(Todo.addToTodo(t, data, el.getAttribute('data-item'), el.getAttribute('data-member')))
        .then(function () { delete ui.busy[key]; render(); });
    } else if (a === 'sort') {
      el.disabled = true; el.textContent = 'Sorting…';
      run(sortChecklist(el.getAttribute('data-cl')));
    }
  });

  root.addEventListener('change', function (e) {
    var el = e.target;
    var a = el.getAttribute('data-action');
    if (a === 'prio') {
      run(setPriority(el.getAttribute('data-item'), Number(el.value)));
    } else if (a === 'mine') {
      ui.mine = el.checked; render();
    } else if (a === 'hideDone') {
      ui.hideDone = el.checked; render();
    }
  });

  // Trello calls this on load and whenever pluginData/context changes.
  t.render(function () { return refresh(); });
})();
