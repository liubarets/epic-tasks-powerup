/* global TrelloPowerUp, EpicCore, EpicAuth, EpicTodo, EpicPoints */
// Card-back section: priorities + "add to TO DO" buttons per assignee for every checklist item,
// and "＋ My cards" per checklist (one card with a checklist, or a card for each item, for the person who clicks).
// "Add all to TO DO" lives in the section header (see client.js).
(function () {
  'use strict';
  var Core = EpicCore;
  var Todo = EpicTodo;
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var root = document.getElementById('root');

  var ui = { mine: false, hideDone: false, busy: {}, error: null, menu: null };
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

  // ------------------------------------------------------------------ actions

  // The item and its linked TO DO cards (not done yet) get the new emoji, wherever it stands in the name.
  // The change is shown at once and finished in the background (see runOps).
  function setPriority(itemId, level) {
    var f = Todo.findItem(data, itemId);
    if (!f) return Promise.resolve();
    var newName = Core.withPriority(f.item.name, level);
    var ops = [{ method: 'PUT', path: '/cards/' + data.card.id + '/checkItem/' + itemId, params: { name: newName } }];
    var infos = Core.allAssignees(f.item, data.board.members, data.alive)
      .filter(function (a) { return !a.unknown; })
      .map(function (a) { return Todo.linkInfo(data, itemId, a.id); })
      .filter(Boolean);
    infos.filter(function (i) { return i.kind === 'card'; }).map(function (i) { return i.card; })
      .filter(function (c, i, all) { return !Core.isCardDone(c, data.cfg.doneListIds) && all.indexOf(c) === i; })
      .forEach(function (c) {
        c.name = Core.withPriority(c.name, level);
        ops.push({ method: 'PUT', path: '/cards/' + c.id, params: { name: c.name } });
      });
    // The item in people's checklist cards gets the new emoji too.
    infos.filter(function (i) { return i.kind === 'kid'; }).forEach(function (i) {
      i.item.name = Core.kidItemName(newName, window.EpicPoints ? EpicPoints.strip : null);
      ops.push({ method: 'PUT', path: '/cards/' + i.card.id + '/checkItem/' + i.item.id, params: { name: i.item.name } });
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
    var info = Todo.linkInfo(data, item.id, a.id);
    if (info && info.kind === 'kid') {
      // The item sits in the person's checklist card: "☰ TO DO" (its list), or "☰ ✓" once ticked there.
      var ticked = info.item.state === 'complete';
      return '<button class="' + cls + (ticked ? ' done' : ' linked') + ' kid" data-action="open" data-card="' + esc(info.card.id) +
        '" title="In ' + (isMe ? 'your' : '@' + esc(a.username) + '’s') + ' checklist card. Open card">' + who +
        ' <span class="st">☰ ' + (ticked ? '✓' : esc(data.listName[info.card.idList] || 'TO DO')) + '</span></button>';
    }
    var c = info && info.card;
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

  // "＋ My cards (n) ▾": only for the person who looks, only their open items without a card yet.
  function myCardsHtml(cl) {
    if (!data.me) return '';
    if (ui.busy['my:' + cl.id]) return '<span class="my-busy">Creating your cards…</span>';
    var n = Todo.myPending(data, cl, data.me.id).length;
    if (!n) return '';
    return '<button class="my-btn" data-action="mymenu" data-cl="' + esc(cl.id) + '" aria-expanded="' + (ui.menu === cl.id) + '"' +
      ' title="Create TO DO cards for your items in this checklist">＋ My cards (' + n + ') ▾</button>';
  }

  function myMenuHtml(cl) {
    if (ui.menu !== cl.id || !data.me) return '';
    var n = Todo.myPending(data, cl, data.me.id).length;
    if (!n) return '';
    var mine = Todo.groupCard(data, cl.id, data.me.id);
    var items = n + ' item' + (n === 1 ? '' : 's');
    return '<div class="my-menu" role="menu">' +
      '<div class="my-menu-head">Your ' + items + ' in “' + esc(cl.name) + '”</div>' +
      '<button role="menuitem" data-action="mykid" data-cl="' + esc(cl.id) + '"><b>☰ One card with a checklist</b>' +
        '<small>' + (mine ? 'Adds them to your card “' + esc(mine.name) + '”' : '“' + esc(Core.kidCardName(data.card.name, cl.name)) + '” with ' + items) + '</small></button>' +
      '<button role="menuitem" data-action="mysep" data-cl="' + esc(cl.id) + '"><b>▤ A card for each item</b>' +
        '<small>' + n + ' separate card' + (n === 1 ? '' : 's') + ', as the ＋ TO DO chips do</small></button>' +
      '</div>';
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
      myCardsHtml(cl) +
      '</span>' +
      '</div>' + myMenuHtml(cl) + '<ul>' + rows + '</ul></section>';
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
    // While cards are being created here, no refresh: one half-way would see a new card without its items
    // yet and add them again. The refresh after the job catches up.
    if (Object.keys(ui.busy).length) { refreshAgain = true; return Promise.resolve(); }
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
        // Keeps the epic and the cards in step: new items into people's checklist cards, names and dates
        // into the cards, ticks both ways (see todo.js).
        return Todo.sync(t, d);
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
    } else if (a === 'mymenu') {
      var mc = el.getAttribute('data-cl');
      ui.menu = ui.menu === mc ? null : mc;
      render();
    } else if (a === 'mykid' || a === 'mysep') {
      var clId = el.getAttribute('data-cl'), bk = 'my:' + clId;
      if (ui.busy[bk]) return;
      ui.menu = null; ui.busy[bk] = 1; render();
      var job = a === 'mykid' ? Todo.addMyChecklistCard(t, data, clId) : Todo.addMySeparateCards(t, data, clId);
      var free = function () { delete ui.busy[bk]; refreshAgain = false; };
      run(job.then(free, function (err) { free(); throw err; })).then(render);
    }
  });

  // A click outside the "My cards" menu closes it.
  document.addEventListener('click', function (e) {
    if (ui.menu && !e.target.closest('.my-menu, .my-btn')) { ui.menu = null; render(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.menu) { ui.menu = null; render(); }
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

  // Trello calls this on load and whenever pluginData/context changes. While cards are being created here,
  // Trello's calls are skipped: a refresh half-way would see a new card without its items yet and add them
  // again; the refresh after the job catches up.
  t.render(function () { return refresh(); });
})();
