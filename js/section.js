/* global TrelloPowerUp, EpicCore, EpicAuth, EpicTodo, EpicPoints, EpicDropdown */
// Card-back section: priorities + "add to TO DO" buttons per assignee for every checklist item,
// and "＋ Cards" per checklist (one card with a checklist, or a card for each item, for anyone tagged in its items).
(function () {
  'use strict';
  var Core = EpicCore;
  var Todo = EpicTodo;
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var root = document.getElementById('root');

  var ui = { mine: false, hideDone: false, busy: {}, error: null, menu: null, jobs: [] };
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

  // The item gets the new emoji, and so do the cards made from it (Todo.itemPriorityOps: separate TO DO cards
  // and the item in people's checklist cards, not done yet; only the emoji changes, edited names keep the rest).
  // The change is shown at once and finished in the background (see runOps).
  function setPriority(itemId, level) {
    var f = Todo.findItem(data, itemId);
    if (!f) return Promise.resolve();
    var newName = Core.withPriority(f.item.name, level);
    var ops = [{ method: 'PUT', path: '/cards/' + data.card.id + '/checkItem/' + itemId, params: { name: newName } }]
      .concat(Todo.itemPriorityOps(data, f.item, level));
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
      // The list's own name, as on the board ("In progress", "TO DO"), or DONE.
      var label = st === 'done' ? 'DONE' : esc(data.listName[st === 'prog' ? Todo.progressListId(data) : st === 'todo' ? todoOf(info) : info.card.idList] || 'TO DO');
      return '<button class="' + cls + (st === 'done' ? ' done' : ' linked') + (kid ? ' kid' : '') + '" data-action="status" data-item="' + esc(item.id) +
        '" data-member="' + esc(a.id) + '" title="Change status">' + who +
        ' <span class="st">' + (kid ? '☰ ' : '✓ ') + label + ' ▾</span></button>';
    }
    if (item.state === 'complete') return '<span class="' + cls + '">' + who + '</span>';
    return '<button class="' + cls + ' add" data-action="todo" data-item="' + esc(item.id) + '" data-member="' + esc(a.id) +
      '" title="Create a TO DO card for @' + esc(a.username) + '">' + who + ' <span class="st">＋ ' + esc(todoName()) + '</span></button>';
  }

  // Where new cards go: the epic's TO DO column by name ("TO DO SP48", even before it is made), else "TO DO".
  function todoName() {
    return data.listName[data.todo] || (data.sprint != null ? EpicCore.sprintTodoName(data.sprint) : 'TO DO');
  }

  // The TO DO column of a card: the one it is in, else the epic's ("TO DO SP48", maybe not made yet).
  function todoOf(info) { return Todo.isTodo(data, info.card.idList) ? info.card.idList : data.todo; }

  function statusLabel(st, info) {
    var up = function (x) { return String(x).toUpperCase(); };
    if (st === 'done') return 'DONE';
    if (st === 'prog') return up(data.listName[Todo.progressListId(data)] || 'IN PROGRESS');
    if (st === 'todo') return up(data.listName[todoOf(info)] || todoName());
    return up(data.listName[info.card.idList] || '');
  }

  // A drop-down list like Trello's (js/dropdown.js), opening down from the chip: TO DO / IN PROGRESS / DONE.
  function statusMenu(el, itemId, memberId) {
    var info = Todo.linkInfo(data, itemId, memberId);
    if (!info) return null;
    var cur = Todo.statusOf(data, info), prog = Todo.progressListId(data);
    var opts = [['todo', statusLabel('todo', info)]].concat(prog ? [['prog', statusLabel('prog', info)]] : []).concat([['done', 'DONE']]);
    return EpicDropdown.open(el, { title: 'Status', resize: resize, items: opts.map(function (o) {
      return { text: o[1], checked: cur === o[0], onPick: function () { if (cur !== o[0]) changeStatus(itemId, memberId, o[0]); } };
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

  function activeJob(j) { return j.state === 'wait' || j.state === 'run'; }
  function pct(j) { return j.total ? Math.round(j.n / j.total * 100) : 0; }

  // "＋ Cards (n) ▾": open items of this checklist without a card yet, for anyone tagged in them.
  // Anyone on the board can create the cards for any of these people (no separate "manager" role).
  // While cards are being made the button shows how far it got.
  function myCardsHtml(cl) {
    var act = ui.jobs.filter(function (j) { return j.clId === cl.id && activeJob(j); });
    if (act.length) {
      var run = act.filter(function (j) { return j.state === 'run'; })[0];
      return '<button class="my-btn" data-action="mymenu" data-cl="' + esc(cl.id) + '" aria-expanded="' + (ui.menu === cl.id) + '" title="Creating cards">' +
        'Creating… <span class="my-bprog"><span style="width:' + (run ? pct(run) : 0) + '%"></span></span></button>';
    }
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

  // A row of a job: waiting, a progress bar while the cards are made, then "✓ n added".
  function jobRow(j) {
    var what = j.kind === 'mykid' ? '☰' : '▤';
    var right;
    if (j.state === 'wait') right = '<span class="my-prog wait"><span></span></span><span class="my-pn">Waiting…</span>';
    else if (j.state === 'run') right = '<span class="my-prog"><span style="width:' + pct(j) + '%"></span></span><span class="my-pn">' + what + ' ' + j.n + ' / ' + j.total + '</span>';
    else if (j.state === 'ok') right = '<span class="my-ok">✓ ' + what + ' ' + (j.total === 1 ? '1 item' : j.total + ' items') + ' added</span>';
    else right = '<span class="my-pn">Failed</span>';
    return '<div class="my-row job' + (j.member === '*' ? ' all' : '') + '" data-job="' + j.id + '">' + j.av + '<span class="my-name">' + j.label + '</span>' + right + '</div>';
  }

  // The menu stays open while cards are made, so cards for several people can be started one after another
  // without reopening it; it closes with ×, Esc or a click anywhere else.
  // Rows keep the order they had when the menu was opened (ui.order): a person whose cards are being made, or
  // are done, stays in the same place — the list is not re-sorted. People who show up later go to the end.
  function myMenuHtml(cl) {
    if (ui.menu !== cl.id) return '';
    var people = peopleOf(cl);
    var jobs = ui.jobs.filter(function (j) { return j.clId === cl.id; });
    var allJob = jobs.filter(function (j) { return j.member === '*' && activeJob(j); })[0];
    var meId = data.me && data.me.id, total = 0, byId = {};
    people.forEach(function (p) { total += p.count; byId[p.member.id] = p; });
    var order = (ui.order || []).slice();
    var add = function (id) { if (order.indexOf(id) === -1) order.splice(order.indexOf('*') === -1 ? order.length : order.indexOf('*'), 0, id); };
    people.forEach(function (p) { add(p.member.id); });
    jobs.forEach(function (j) { if (j.member !== '*') add(j.member); });
    if (order.indexOf('*') === -1 && (people.length > 1 || jobs.some(function (j) { return j.member === '*'; }))) order.push('*');
    ui.order = order;
    // The job to show for a row: the running/waiting one, else the latest finished one.
    var jobFor = function (id) {
      var mine = jobs.filter(function (j) { return j.member === id; });
      return mine.filter(activeJob)[0] || mine[mine.length - 1] || null;
    };
    var rows = order.map(function (id) {
      var j = jobFor(id);
      if (id === '*') {
        if (j && (activeJob(j) || people.length <= 1)) return jobRow(j);
        return people.length > 1 ? personRow(cl, '<b>Everyone</b>', '<span class="my-av all">∗</span>', total, '*', ' all') : (j ? jobRow(j) : '');
      }
      var p = byId[id];
      if (j && (activeJob(j) || !p)) return jobRow(j);
      if (!p) return '';
      var nm = id === meId ? 'Me' : esc(p.member.fullName || p.member.username || 'Unknown');
      if (allJob) return '<div class="my-row">' + avatarHtml(p.member) + '<span class="my-name">' + nm + '</span><span class="my-pn">With everyone…</span></div>';
      return personRow(cl, nm, avatarHtml(p.member), p.count, id);
    }).join('');
    if (!rows) rows = '<div class="my-empty">Every open item has a card ✓</div>';
    var head = cl.id === ALL
      ? 'Open items without a card in this epic · ' + plural(pendingChecklists('*').length, 'checklist')
      : 'Open items without a card in “' + esc(Core.withPriority(cl.name, 0)) + '”';
    var foot = cl.id === ALL && people.length ? '<div class="my-foot">☰ Checklist: a card for every checklist, for each person · ▤ Each: a card for every item</div>' : '';
    return '<div class="my-menu' + (cl.id === ALL ? ' all-menu' : '') + '" role="menu">' +
      '<div class="my-menu-head">' + head +
      '<button class="my-x" data-action="myclose" aria-label="Close" title="Close">×</button></div>' + rows + foot + '</div>';
  }

  // ---- "＋ All cards": the same menu for the whole epic (every checklist at once) ----
  // ☰ Checklist makes a card per checklist for each person (as if "＋ Cards → ☰ Checklist" was pressed on
  // every checklist); ▤ Each makes a card per item. Items that already have a card are skipped.
  var ALL = 'ALL';
  var allCl = { id: ALL, name: '', checkItems: [] };
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // The checklists with open items without a card (for one person, or for anyone with '*').
  function pendingChecklists(member) {
    return data.checklists.filter(function (cl) {
      return Todo.pendingInChecklist(data, cl).some(function (j) { return member === '*' || j.memberId === member; });
    });
  }

  // People with items to add: in one checklist, or summed over the whole epic (me first, then by name).
  function peopleOf(cl) {
    if (cl.id !== ALL) return Todo.pendingPeople(data, cl);
    var by = {}, list = [];
    data.checklists.forEach(function (c) {
      Todo.pendingPeople(data, c).forEach(function (p) {
        if (!by[p.member.id]) { by[p.member.id] = { member: p.member, count: 0 }; list.push(by[p.member.id]); }
        by[p.member.id].count += p.count;
      });
    });
    var meId = data.me && data.me.id;
    var name = function (p) { return (p.member.fullName || p.member.username || '').toLowerCase(); };
    return list.sort(function (a, b) {
      if (a.member.id === meId) return -1;
      if (b.member.id === meId) return 1;
      return name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0;
    });
  }

  function allCardsHtml() {
    if (data.checklists.length < 2) return '';
    var act = ui.jobs.filter(function (j) { return j.clId === ALL && activeJob(j); });
    var attrs = ' data-action="mymenu" data-cl="' + ALL + '" aria-expanded="' + (ui.menu === ALL) + '"';
    if (act.length) {
      var run = act.filter(function (j) { return j.state === 'run'; })[0];
      return '<button class="all-btn"' + attrs + ' title="Creating cards">Creating… <span class="my-bprog"><span style="width:' + (run ? pct(run) : 0) + '%"></span></span></button>';
    }
    var n = 0;
    data.checklists.forEach(function (cl) { n += Todo.pendingInChecklist(data, cl).length; });
    if (!n) return '<button class="all-btn off" disabled title="Every open item already has a card">＋ All cards</button>';
    return '<button class="all-btn"' + attrs + ' title="Create TO DO cards for the open items of every checklist">＋ All cards (' + n + ') ▾</button>';
  }

  // Runs a menu choice over every checklist, one after another, with one progress bar for all of them.
  function addAll(kind, member, tell) {
    var cls = pendingChecklists(member);
    var counts = cls.map(function (cl) {
      return Todo.pendingInChecklist(data, cl).filter(function (j) { return member === '*' || j.memberId === member; }).length;
    });
    var grand = counts.reduce(function (a, b) { return a + b; }, 0), base = 0;
    tell(0, grand);
    return cls.reduce(function (p, cl, i) {
      return p.then(function () {
        var step = function (n) { tell(Math.min(base + n, grand), grand); };
        var f = kind === 'mykid' ? Todo.addChecklistCards : Todo.addSeparateCards;
        return Promise.resolve(f(t, data, cl.id, member, step)).then(function () { base += counts[i]; tell(base, grand); });
      });
    }, Promise.resolve());
  }

  function closeMenu() {
    if (!ui.menu) return;
    ui.menu = null;
    ui.jobs = ui.jobs.filter(activeJob);
    render();
  }

  // Jobs from the menu run one after another (each rewrites the epic's Teamload data).
  var jobSeq = 0, pumping = false;
  function queueJob(kind, clId, member) {
    var cl = clId === ALL ? allCl : data.checklists.filter(function (x) { return x.id === clId; })[0];
    if (!cl) return;
    var label, av;
    if (member === '*') { label = '<b>Everyone</b>'; av = '<span class="my-av all">∗</span>'; }
    else {
      var m = (data.board.members || []).filter(function (x) { return x.id === member; })[0] || { id: member };
      label = data.me && member === data.me.id ? 'Me' : esc(m.fullName || m.username || 'Unknown');
      av = avatarHtml(m);
    }
    ui.jobs.push({ id: ++jobSeq, kind: kind, clId: clId, member: member, label: label, av: av, state: 'wait', n: 0, total: 0 });
    ui.busy['my:' + clId] = 1;
    render();
    pump();
  }

  function pump() {
    if (pumping) return;
    var j = ui.jobs.filter(function (x) { return x.state === 'wait'; })[0];
    if (!j) {
      Object.keys(ui.busy).forEach(function (k) { if (k.indexOf('my:') === 0) delete ui.busy[k]; });
      run(Promise.resolve()).then(render);
      return;
    }
    pumping = true;
    j.state = 'run';
    render();
    var tell = function (n, total) { j.n = n; j.total = total; render(); };
    var p = j.clId === ALL ? addAll(j.kind, j.member, tell)
      : j.kind === 'mykid' ? Todo.addChecklistCards(t, data, j.clId, j.member, tell) : Todo.addSeparateCards(t, data, j.clId, j.member, tell);
    Promise.resolve(p).then(function () {
      j.state = 'ok'; j.n = j.total;
    }, function (e) {
      j.state = 'err';
      ui.error = (e && e.message) || String(e);
    }).then(function () {
      pumping = false;
      pump();
    });
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
    // The cards made from this checklist follow: their name, the checklist inside and the description line
    // (Todo.checklistPriorityOps; only the emoji changes).
    var ops = [{ method: 'PUT', path: '/checklists/' + clId, params: { name: name } }]
      .concat(Todo.checklistPriorityOps(data, cl, level));
    cl.name = name;
    render();
    return runOps(ops);
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
      '<button class="icon" data-action="settings" title="Settings">⚙</button>' + allCardsHtml() + '</div>' + myMenuHtml(allCl);
    if (ui.error) html += '<div class="error">' + esc(ui.error) + '</div>';
    // A re-render replaces the buttons: an open drop-down would point at nothing.
    if (window.EpicDropdown) EpicDropdown.close();
    if (Todo.todoListError(d)) {
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
        // Keeps the epic and the cards in step: new items into people's checklist cards, priorities and dates
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
      var si = el.getAttribute('data-item'), sm = el.getAttribute('data-member');
      if (ui.menu) {
        // Close the "＋ Cards" menu first (the page shifts), then open the list under the chip where it is now.
        ui.menu = null; ui.jobs = ui.jobs.filter(activeJob); render();
        el = root.querySelector('[data-action=status][data-item="' + si + '"][data-member="' + sm + '"]');
        if (!el) return;
      }
      statusMenu(el, si, sm);
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
      if (ui.menu === mc) closeMenu();
      else { ui.menu = mc; ui.order = null; ui.jobs = ui.jobs.filter(activeJob); render(); }
    } else if (a === 'myclose') {
      closeMenu();
    } else if (a === 'mykid' || a === 'mysep') {
      queueJob(a, el.getAttribute('data-cl'), el.getAttribute('data-member') || data.me.id);
    }
  });

  // A click outside the "＋ Cards" menu, Esc, or a click outside the iframe (it loses focus) closes it.
  document.addEventListener('click', function (e) {
    if (ui.menu && !e.target.closest('.my-menu, .my-btn, .all-btn')) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.menu) closeMenu();
  });
  window.addEventListener('blur', function () { if (ui.menu) closeMenu(); });

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
