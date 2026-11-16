/* global TrelloPowerUp, EpicCore, EpicAuth */
// Card-back section: priorities + "add to TO DO" buttons per assignee for every checklist item.
(function () {
  'use strict';
  var Core = EpicCore;
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var root = document.getElementById('root');

  var ui = { mine: false, hideDone: false, busy: {}, bulk: {}, error: null };
  var data = null;

  function api(method, path, params) { return EpicAuth.request(t, method, path, params); }

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

  // ------------------------------------------------------------------ data

  function fetchCards(shortLinks) {
    var out = {};
    var chunks = [];
    for (var i = 0; i < shortLinks.length; i += 10) chunks.push(shortLinks.slice(i, i + 10));
    return Promise.all(chunks.map(function (chunk) {
      var urls = chunk.map(function (s) { return '/cards/' + s; }).join(',');
      return api('GET', '/batch', { urls: urls }).then(function (res) {
        (res || []).forEach(function (r, j) { out[chunk[j]] = (r && r['200']) || null; });
      });
    })).then(function () { return out; });
  }

  function load() {
    return Promise.all([
      t.card('id', 'name', 'url', 'shortLink'),
      t.board('id', 'members'),
      t.member('id', 'username', 'fullName'),
      t.lists('id', 'name'),
      t.get('board', 'shared', 'cfg', {}),
      t.get('card', 'shared', 'links', {}),
    ]).then(function (r) {
      var d = { card: r[0], board: r[1], me: r[2], lists: r[3], cfg: r[4] || {}, links: r[5] || {} };
      d.listName = {};
      d.lists.forEach(function (l) { d.listName[l.id] = l.name; });
      return api('GET', '/cards/' + d.card.id + '/checklists', {
        checkItems: 'all',
        checkItem_fields: 'name,state,pos,due,idMember',
        fields: 'name,pos',
      }).then(function (checklists) {
        checklists.sort(Core.byPos);
        checklists.forEach(function (cl) { cl.checkItems.sort(Core.byPos); });
        d.checklists = checklists;
        var shortLinks = Object.keys(d.links).map(function (k) { return d.links[k]; })
          .filter(function (v, i, a) { return v && a.indexOf(v) === i; });
        return fetchCards(shortLinks).then(function (cards) { d.linked = cards; return d; });
      });
    });
  }

  function linkedCard(d, itemId, memberId) {
    var sl = d.links[Core.linkKey(itemId, memberId)];
    var c = sl ? d.linked[sl] || null : null;
    // A card archived outside the Done lists was cancelled: the item is open again.
    return Core.isCardCancelled(c, d.cfg.doneListIds) ? null : c;
  }

  // If every assignee has a TO DO card and all of them are done → tick the item in the epic.
  function autoComplete(d) {
    if (d.cfg.autoComplete === false) return Promise.resolve();
    var jobs = [];
    d.checklists.forEach(function (cl) {
      cl.checkItems.forEach(function (it) {
        if (it.state === 'complete') return;
        var people = Core.allAssignees(it, d.board.members, d.links).filter(function (a) { return !a.unknown; });
        if (!people.length) return;
        var allDone = people.every(function (a) {
          return Core.isCardDone(linkedCard(d, it.id, a.id), d.cfg.doneListIds);
        });
        if (allDone) {
          it.state = 'complete';
          jobs.push(api('PUT', '/cards/' + d.card.id + '/checkItem/' + it.id, { state: 'complete' }));
        }
      });
    });
    return Promise.all(jobs);
  }

  function findItem(itemId) {
    for (var i = 0; i < data.checklists.length; i++) {
      var cl = data.checklists[i];
      for (var j = 0; j < cl.checkItems.length; j++) {
        if (cl.checkItems[j].id === itemId) return { item: cl.checkItems[j], checklist: cl };
      }
    }
    return null;
  }

  // Open items × board-member assignees that don't have a TO DO card yet.
  function pendingInChecklist(cl) {
    var out = [];
    cl.checkItems.forEach(function (it) {
      if (it.state === 'complete') return;
      Core.allAssignees(it, data.board.members, data.links).forEach(function (a) {
        if (!a.unknown && !linkedCard(data, it.id, a.id)) out.push({ item: it, memberId: a.id });
      });
    });
    return out;
  }

  // ------------------------------------------------------------------ actions

  function noTodoList() {
    return data.cfg.todoListId ? null : new Error('Choose the TO DO list in settings (⚙) first.');
  }

  function saveLinks(newLinks) {
    if (!Object.keys(newLinks).length) return Promise.resolve();
    // Re-read right before writing to reduce clobbering when two people click at once.
    return t.get('card', 'shared', 'links', {}).then(function (links) {
      Object.keys(newLinks).forEach(function (k) { links[k] = newLinks[k]; });
      var ids = [];
      data.checklists.forEach(function (cl) { cl.checkItems.forEach(function (it) { ids.push(it.id); }); });
      return t.set('card', 'shared', 'links', Core.pruneLinks(links, ids));
    });
  }

  // Creates one TO DO card for (item, member); resolves with its shortLink.
  function createTodoCard(item, checklist, memberId) {
    return api('POST', '/cards', {
      idList: data.cfg.todoListId,
      name: Core.todoCardName(item.name, checklist.name),
      desc: Core.todoCardDesc(data.card, checklist.name),
      idMembers: memberId,
      due: item.due || undefined,
      pos: data.cfg.position === 'bottom' ? 'bottom' : 'top',
    }).then(function (created) {
      return api('POST', '/cards/' + created.id + '/attachments', { url: data.card.url, name: data.card.name })
        .catch(function () { /* link back is nice-to-have */ })
        .then(function () { return created.shortLink; });
    });
  }

  function addToTodo(itemId, memberId) {
    var f = findItem(itemId);
    if (!f) return Promise.reject(new Error('Item not found. Refresh the block (⟳).'));
    var err = noTodoList();
    if (err) return Promise.reject(err);
    return createTodoCard(f.item, f.checklist, memberId).then(function (shortLink) {
      var nl = {};
      nl[Core.linkKey(itemId, memberId)] = shortLink;
      return saveLinks(nl);
    });
  }

  // "Add all to TO DO": one card per open item × assignee that doesn't have one yet.
  function addAllToTodo(clId) {
    var cl = data.checklists.filter(function (c) { return c.id === clId; })[0];
    if (!cl) return Promise.resolve();
    var err = noTodoList();
    if (err) return Promise.reject(err);
    var jobs = pendingInChecklist(cl);
    // With "top" placement each new card lands above the previous one,
    // so create in reverse to keep the checklist order in the TO DO list.
    if (data.cfg.position !== 'bottom') jobs.reverse();
    var newLinks = {};
    return jobs.reduce(function (p, j) {
      return p.then(function () {
        return createTodoCard(j.item, cl, j.memberId).then(function (shortLink) {
          newLinks[Core.linkKey(j.item.id, j.memberId)] = shortLink;
        });
      });
    }, Promise.resolve()).then(function () {
      return saveLinks(newLinks);
    }, function (e) {
      // Keep links to the cards created before the failure.
      return saveLinks(newLinks).then(function () { throw e; });
    });
  }

  function setPriority(itemId, level) {
    var f = findItem(itemId);
    if (!f) return Promise.resolve();
    var newName = Core.withPriority(f.item.name, level);
    return api('PUT', '/cards/' + data.card.id + '/checkItem/' + itemId, { name: newName }).then(function () {
      f.item.name = newName;
      return syncLinkedPriority(f.item, Number(level));
    });
  }

  // Keep the emoji in already-created (not yet done) TO DO cards in sync with the item.
  function syncLinkedPriority(item, level) {
    var people = Core.allAssignees(item, data.board.members, data.links).filter(function (a) { return !a.unknown; });
    var cards = people.map(function (a) { return linkedCard(data, item.id, a.id); })
      .filter(function (c) { return c && !Core.isCardDone(c, data.cfg.doneListIds); });
    return Promise.all(cards.map(function (c) {
      return api('PUT', '/cards/' + c.id, { name: Core.withPriority(c.name, level) });
    }));
  }

  function sortChecklist(clId) {
    var cl = data.checklists.filter(function (c) { return c.id === clId; })[0];
    if (!cl) return Promise.resolve();
    var sorted = Core.sortByPriority(cl.checkItems);
    if (Core.sameOrder(sorted, cl.checkItems)) return Promise.resolve();
    // Sequential "bottom" moves give a deterministic final order.
    return sorted.reduce(function (p, it) {
      return p.then(function () {
        return api('PUT', '/cards/' + data.card.id + '/checkItem/' + it.id, { pos: 'bottom' });
      });
    }, Promise.resolve());
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
    var c = linkedCard(data, item.id, a.id);
    if (c) {
      var done = Core.isCardDone(c, data.cfg.doneListIds);
      var where = done ? '✔ DONE' : '✓ ' + esc(data.listName[c.idList] || 'TO DO');
      return '<button class="' + cls + (done ? ' done' : ' linked') + '" data-action="open" data-card="' + esc(c.id) +
        '" title="Open card">' + who + ' <span class="st">' + where + '</span></button>';
    }
    if (item.state === 'complete') return '<span class="' + cls + '">' + who + '</span>';
    return '<button class="' + cls + ' add" data-action="todo" data-item="' + esc(item.id) + '" data-member="' + esc(a.id) +
      '" title="Create a TO DO card for @' + esc(a.username) + '">' + who + ' <span class="st">＋ TO DO</span></button>';
  }

  function itemHtml(item) {
    // Mentioned people + those who took the item via "Assign to me".
    var people = Core.allAssignees(item, data.board.members, data.links);
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
    var pending = pendingInChecklist(cl).length;
    var addAll = ui.bulk[cl.id] ? '<span class="link-busy">Adding…</span>' :
      pending ? '<button class="link" data-action="addall" data-cl="' + esc(cl.id) + '" title="Create TO DO cards for every open item of this checklist that doesn\'t have one yet (items without assignees are skipped)">＋ Add all to TO DO (' + pending + ')</button>' : '';
    return '<section class="cl"><div class="cl-head">' +
      '<span class="cl-name">' + esc(cl.name) + '</span>' +
      '<span class="cl-count">' + done + '/' + total + '</span>' +
      '<span class="bar"><span style="width:' + pct + '%"></span></span>' +
      '<span class="cl-actions">' +
      '<button class="link" data-action="sort" data-cl="' + esc(cl.id) + '" title="Sort items: P1 → P2 → P3 → no priority">↕ Sort by priority</button>' +
      addAll + '</span>' +
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
      'connect Epic Tasks to your Trello account. You only need to do this <b>once</b>.</p>' +
      '<button class="mod-primary" data-action="auth">Connect</button></div>';
    resize();
  }

  function refresh() {
    return EpicAuth.isAuthorized(t).then(function (ok) {
      if (!ok) { data = null; renderAuth(); return; }
      return load().then(function (d) {
        data = d;
        return autoComplete(d);
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
      t.popup({ title: 'Epic Tasks — settings', url: './settings.html', height: 420, mouseEvent: e });
    } else if (a === 'open') {
      t.showCard(el.getAttribute('data-card'));
    } else if (a === 'todo') {
      var key = el.getAttribute('data-item') + ':' + el.getAttribute('data-member');
      if (ui.busy[key]) return;
      ui.busy[key] = 1; render();
      run(addToTodo(el.getAttribute('data-item'), el.getAttribute('data-member')))
        .then(function () { delete ui.busy[key]; render(); });
    } else if (a === 'addall') {
      var clId = el.getAttribute('data-cl');
      if (ui.bulk[clId]) return;
      ui.bulk[clId] = 1; render();
      run(addAllToTodo(clId)).then(function () { delete ui.bulk[clId]; render(); });
    } else if (a === 'sort') {
      el.disabled = true; el.textContent = 'Sorting…';
      run(sortChecklist(el.getAttribute('data-cl')));
    }
  });

  root.addEventListener('change', function (e) {
    var el = e.target;
    var a = el.getAttribute('data-action');
    if (a === 'prio') {
      el.disabled = true;
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
