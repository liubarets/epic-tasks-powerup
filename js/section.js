/* global TrelloPowerUp, EpicCore, EpicAuth, EpicTodo, EpicPoints */
// Card-back section: priorities + "add to TO DO" buttons per assignee for every checklist item,
// and "＋ Cards" per checklist (one card with a checklist, or a card for each item, for anyone tagged in its items).
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

  // "＋ Assign to me": only adds my @username to the item. Cards are made later with the chip or "＋ Cards".
  function assignToMe(itemId) {
    var f = Todo.findItem(data, itemId);
    if (!f || !data.me || !data.me.username) return Promise.resolve();
    var newName = f.item.name.replace(/\s+$/, '') + ' @' + data.me.username;
    f.item.name = newName;
    render();
    return runOps([{ method: 'PUT', path: '/cards/' + data.card.id + '/checkItem/' + itemId, params: { name: newName } }]);
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
    if (info) {
      // The person has a card: the chip shows its status; a click opens a menu to change it (anyone can).
      var st = Todo.statusOf(data, info);
      var kid = info.kind === 'kid';
      var label = st === 'done' ? (kid ? '✓' : 'DONE') : esc(data.listName[info.card.idList] || 'TO DO');
      return '<button class="' + cls + (st === 'done' ? ' done' : ' linked') + (kid ? ' kid' : '') + '" data-action="status" data-item="' + esc(item.id) +
        '" data-member="' + esc(a.id) + '" title="Change status">' + who +
        ' <span class="st">' + (kid ? '☰ ' : '✓ ') + label + ' ▾</span></button>';
    }
    if (item.state === 'complete') return '<span class="' + cls + '">' + who + '</span>';
    return '<button class="' + cls + ' add" data-action="todo" data-item="' + esc(item.id) + '" data-member="' + esc(a.id) +
      '" title="Create a TO DO card for @' + esc(a.username) + '">' + who + ' <span class="st">＋ TO DO</span></button>';
  }

  // Trello's own drop-down list (t.popup with items): TO DO / IN PROGRESS / DONE.
  function statusMenu(e, itemId, memberId) {
    var info = Todo.linkInfo(data, itemId, memberId);
    if (!info) return null;
    var cur = Todo.statusOf(data, info), prog = Todo.progressListId(data);
    var up = function (x) { return String(x).toUpperCase(); };
    var opts = [['todo', up(data.listName[data.cfg.todoListId] || 'TO DO')]]
      .concat(prog ? [['prog', up(data.listName[prog] || 'IN PROGRESS')]] : []).concat([['done', 'DONE']]);
    return t.popup({ title: 'Status', mouseEvent: e, items: opts.map(function (o) {
      return { text: (cur === o[0] ? '✓ ' : '') + o[1], callback: function (tt) {
        tt.closePopup();
        if (cur !== o[0]) changeStatus(itemId, memberId, o[0]);
      } };
    }) });
  }

  function changeStatus(itemId, memberId, st) {
    var bkey = itemId + ':' + memberId;
    if (ui.busy[bkey]) return;
    ui.busy[bkey] = 1; render();
    var free = function () { delete ui.busy[bkey]; };
    run(Todo.setStatus(t, data, itemId, memberId, st).then(free, function (err) { free(); throw err; })).then(render);
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
        '<button class="chip ghost" data-action="assign" data-item="' + esc(item.id) + '"' +
        ' title="Add @' + esc(data.me.username) + ' to this item (no TO DO card yet)">＋ Assign to me</button>';
    }
    var due = item.due ? '<span class="due' + (!done && new Date(item.due) < new Date() ? ' overdue' : '') + '">' + fmtDate(item.due) + '</span>' : '';

    return '<li class="item' + (done ? ' done' : '') + '">' +
      '<select class="prio" data-action="prio" data-item="' + esc(item.id) + '" title="Priority">' + opts + '</select>' +
      '<div class="body"><div class="title">' + esc(Core.cleanTitle(item.name)) + due + '</div>' +
      '<div class="chips">' + chips + '</div></div></li>';
  }

  // "＋ Cards (n) ▾": open items of this checklist without a card yet, for anyone tagged in them.
  // Anyone on the board can create the cards for any of these people (no separate "manager" role).
  function myCardsHtml(cl) {
    if (ui.busy['my:' + cl.id]) return '<span class="my-busy">Creating cards…</span>';
    var n = Todo.pendingInChecklist(data, cl).length;
    if (!n) return '<button class="my-btn off" disabled title="Every open item already has a card">＋ Cards</button>';
    return '<button class="my-btn" data-action="mymenu" data-cl="' + esc(cl.id) + '" aria-expanded="' + (ui.menu === cl.id) + '"' +
      ' title="Create TO DO cards for the open items of this checklist">＋ Cards (' + n + ') ▾</button>';
  }

  function avatarHtml(m) {
    var ini = m.initials ? m.initials.slice(0, 2).toUpperCase()
      : ((m.fullName || m.username || '?').trim().split(/\s+/).map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join('')).toUpperCase();
    var a = m.avatar || m.avatarUrl;
    if (a && /^https:\/\//.test(a)) {
      var src = /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a) ? a : a.replace(/\/$/, '') + '/50.png';
      return '<img class="my-av" src="' + esc(src) + '" alt="' + esc(ini) + '">';
    }
    return '<span class="my-av">' + esc(ini) + '</span>';
  }

  function personRow(cl, label, av, count, member, extra) {
    var b = function (kind, text, title) {
      return '<button class="my-act" role="menuitem" data-action="' + kind + '" data-cl="' + esc(cl.id) + '" data-member="' + esc(member) + '" title="' + title + '">' + text + '</button>';
    };
    return '<div class="my-row' + (extra || '') + '">' + av + '<span class="my-name">' + label + '</span><span class="my-n">' + count + '</span>' +
      b('mykid', '☰ Checklist', 'One card “Epic / Checklist” with these items (added to the card if it exists)') +
      b('mysep', '▤ Each', 'A separate TO DO card for every item') + '</div>';
  }

  function myMenuHtml(cl) {
    if (ui.menu !== cl.id) return '';
    var people = Todo.pendingPeople(data, cl);
    if (!people.length) return '';
    var meId = data.me && data.me.id, total = 0;
    var rows = people.map(function (p) {
      total += p.count;
      var nm = p.member.id === meId ? 'Me' : esc(p.member.fullName || p.member.username || 'Unknown');
      return personRow(cl, nm, avatarHtml(p.member), p.count, p.member.id);
    }).join('');
    if (people.length > 1) rows += personRow(cl, '<b>Everyone</b>', '<span class="my-av all">∗</span>', total, '*', ' all');
    return '<div class="my-menu" role="menu">' +
      '<div class="my-menu-head">Open items without a card in “' + esc(cl.name) + '”</div>' + rows + '</div>';
  }

  // Priority of a whole checklist (a task of the epic): the emoji at the start of the checklist name.
  function clPrioHtml(cl) {
    var level = Core.parsePriority(cl.name);
    var opts = '<option value="0"' + (level ? '' : ' selected') + '>—</option>' +
      Core.PRIORITIES.map(function (p) {
        return '<option value="' + p.level + '"' + (p.level === level ? ' selected' : '') + '>' + p.emoji + ' ' + p.short + '</option>';
      }).join('');
    return '<select class="prio cl-prio" data-action="clprio" data-cl="' + esc(cl.id) + '" title="Priority of this task">' + opts + '</select>';
  }

  function setChecklistPriority(clId, level) {
    var cl = data.checklists.filter(function (x) { return x.id === clId; })[0];
    if (!cl) return Promise.resolve();
    var name = Core.withPriority(cl.name, level);
    cl.name = name;
    render();
    return runOps([{ method: 'PUT', path: '/checklists/' + clId, params: { name: name } }]);
  }

  function checklistHtml(cl) {
    var total = cl.checkItems.length;
    var done = cl.checkItems.filter(function (i) { return i.state === 'complete'; }).length;
    var rows = cl.checkItems.map(itemHtml).join('');
    if (!rows && (ui.mine || ui.hideDone)) return '';
    var pct = total ? Math.round(done / total * 100) : 0;
    return '<section class="cl"><div class="cl-head">' +
      clPrioHtml(cl) +
      '<span class="cl-name">' + esc(Core.withPriority(cl.name, 0)) + '</span>' +
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
    } else if (a === 'status') {
      statusMenu(e, el.getAttribute('data-item'), el.getAttribute('data-member'));
    } else if (a === 'assign') {
      var ak = el.getAttribute('data-item') + ':' + data.me.id;
      if (ui.busy[ak]) return;
      ui.busy[ak] = 1; render();
      run(assignToMe(el.getAttribute('data-item'))).then(function () { delete ui.busy[ak]; render(); });
    } else if (a === 'sort') {
      el.disabled = true; el.textContent = 'Sorting…';
      run(sortChecklist(el.getAttribute('data-cl')));
    } else if (a === 'mymenu') {
      var mc = el.getAttribute('data-cl');
      ui.menu = ui.menu === mc ? null : mc;
      render();
    } else if (a === 'mykid' || a === 'mysep') {
      var clId = el.getAttribute('data-cl'), bk = 'my:' + clId, who = el.getAttribute('data-member') || data.me.id;
      if (ui.busy[bk]) return;
      ui.menu = null; ui.busy[bk] = 1; render();
      var job = a === 'mykid' ? Todo.addChecklistCards(t, data, clId, who) : Todo.addSeparateCards(t, data, clId, who);
      var free = function () { delete ui.busy[bk]; };
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
    } else if (a === 'clprio') {
      run(setChecklistPriority(el.getAttribute('data-cl'), Number(el.value)));
    } else if (a === 'mine') {
      ui.mine = el.checked; render();
    } else if (a === 'hideDone') {
      ui.hideDone = el.checked; render();
    }
  });

  // Trello calls this on load and whenever pluginData/context changes. While cards are being created here,
  // Trello's calls are skipped: a refresh half-way would see a new card without its items yet and add them
  // again; the refresh after the job catches up.
  t.render(function () {
    if (Object.keys(ui.busy).length) { refreshAgain = true; return null; }
    return refresh();
  });
})();
