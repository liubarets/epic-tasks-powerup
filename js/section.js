/* global TrelloPowerUp, EpicCore, EpicAuth */
// Card-back section: priorities + "to TODO" buttons per assignee for every checklist item.
(function () {
  'use strict';
  var Core = EpicCore;
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var root = document.getElementById('root');

  var ui = { mine: false, hideDone: false, busy: {}, error: null };
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
      t.board('id', 'members', 'labels'),
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
    return sl ? d.linked[sl] || null : null;
  }

  // If every assignee has a TODO card and all of them are done → tick the item in the epic.
  function autoComplete(d) {
    if (d.cfg.autoComplete === false) return Promise.resolve();
    var jobs = [];
    d.checklists.forEach(function (cl) {
      cl.checkItems.forEach(function (it) {
        if (it.state === 'complete') return;
        var people = Core.resolveAssignees(it, d.board.members).filter(function (a) { return !a.unknown; });
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

  // ------------------------------------------------------------------ actions

  function priorityLabelIds() {
    var names = Core.PRIORITIES.map(function (p) { return p.labelName; });
    return (data.board.labels || []).filter(function (l) { return names.indexOf(l.name) !== -1; })
      .map(function (l) { return l.id; });
  }

  function ensureLabel(level) {
    var p = Core.byLevel(level);
    return t.board('labels').then(function (b) {
      var found = (b.labels || []).filter(function (l) { return l.name === p.labelName; })[0];
      if (found) return found.id;
      return api('POST', '/boards/' + data.board.id + '/labels', { name: p.labelName, color: p.color })
        .then(function (l) { data.board.labels.push(l); return l.id; });
    });
  }

  function saveLinks(mutator) {
    // Re-read right before writing to reduce clobbering when two people click at once.
    return t.get('card', 'shared', 'links', {}).then(function (links) {
      mutator(links);
      var ids = [];
      data.checklists.forEach(function (cl) { cl.checkItems.forEach(function (it) { ids.push(it.id); }); });
      return t.set('card', 'shared', 'links', Core.pruneLinks(links, ids));
    });
  }

  function addToTodo(itemId, memberId) {
    var f = findItem(itemId);
    var cfg = data.cfg;
    if (!f) return Promise.reject(new Error('Пункт не знайдено — оновіть блок.'));
    if (!cfg.todoListId) return Promise.reject(new Error('Спершу оберіть список TODO в налаштуваннях (⚙).'));
    var level = Core.parsePriority(f.item.name);
    var labelP = level && cfg.priorityLabels !== false ? ensureLabel(level) : Promise.resolve(null);
    return labelP.then(function (labelId) {
      return api('POST', '/cards', {
        idList: cfg.todoListId,
        name: Core.todoCardName(f.item.name, f.checklist.name),
        desc: Core.todoCardDesc(data.card, f.checklist.name, f.item.name),
        idMembers: memberId,
        idLabels: labelId || undefined,
        due: f.item.due || undefined,
        pos: cfg.position === 'bottom' ? 'bottom' : 'top',
      });
    }).then(function (created) {
      return api('POST', '/cards/' + created.id + '/attachments', { url: data.card.url, name: 'Епік: ' + data.card.name })
        .catch(function () { /* link back is nice-to-have */ })
        .then(function () {
          return saveLinks(function (links) { links[Core.linkKey(itemId, memberId)] = created.shortLink; });
        });
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

  // Keep already-created TODO cards in sync with the new priority (name emoji + label).
  function syncLinkedPriority(item, level) {
    var people = Core.resolveAssignees(item, data.board.members).filter(function (a) { return !a.unknown; });
    var cards = people.map(function (a) { return linkedCard(data, item.id, a.id); })
      .filter(function (c) { return c && !Core.isCardDone(c, data.cfg.doneListIds); });
    if (!cards.length) return Promise.resolve();
    var labelP = level && data.cfg.priorityLabels !== false ? ensureLabel(level) : Promise.resolve(null);
    return labelP.then(function (labelId) {
      var prioIds = priorityLabelIds();
      return Promise.all(cards.map(function (c) {
        var ids = (c.idLabels || []).filter(function (id) { return prioIds.indexOf(id) === -1; });
        if (labelId) ids.push(labelId);
        return api('PUT', '/cards/' + c.id, { name: Core.withPriority(c.name, level), idLabels: ids.join(',') });
      }));
    });
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

  function toggleItem(itemId, checked) {
    return api('PUT', '/cards/' + data.card.id + '/checkItem/' + itemId, { state: checked ? 'complete' : 'incomplete' });
  }

  // ------------------------------------------------------------------ render

  function chipHtml(item, a) {
    var isMe = data.me && a.id === data.me.id;
    var cls = 'chip' + (isMe ? ' me' : '');
    var who = '@' + esc(a.username);
    if (a.unknown) {
      return '<span class="' + cls + ' unknown" title="Не учасник цієї дошки">' + who + '</span>';
    }
    var busyKey = item.id + ':' + a.id;
    if (ui.busy[busyKey]) return '<span class="' + cls + ' busy">' + who + ' · …</span>';
    var c = linkedCard(data, item.id, a.id);
    if (c) {
      var done = Core.isCardDone(c, data.cfg.doneListIds);
      var where = done ? '✔ готово' : '✓ ' + esc(data.listName[c.idList] || 'у TODO');
      return '<button class="' + cls + (done ? ' done' : ' linked') + '" data-action="open" data-card="' + esc(c.id) +
        '" title="Відкрити картку">' + who + ' <span class="st">' + where + '</span></button>';
    }
    if (item.state === 'complete') return '<span class="' + cls + '">' + who + '</span>';
    return '<button class="' + cls + ' add" data-action="todo" data-item="' + esc(item.id) + '" data-member="' + esc(a.id) +
      '" title="Створити картку в TODO для @' + esc(a.username) + '">' + who + ' <span class="st">＋ TODO</span></button>';
  }

  function itemHtml(item) {
    var people = Core.resolveAssignees(item, data.board.members);
    // People who took the item via "Взяти собі" without being mentioned in it.
    (data.board.members || []).forEach(function (m) {
      if (people.some(function (a) { return a.id === m.id; })) return;
      if (data.links[Core.linkKey(item.id, m.id)]) people.push({ id: m.id, username: m.username, fullName: m.fullName, unknown: false });
    });
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
        '">＋ Взяти собі</button>';
    }
    var due = item.due ? '<span class="due' + (!done && new Date(item.due) < new Date() ? ' overdue' : '') + '">' + fmtDate(item.due) + '</span>' : '';

    return '<li class="item' + (done ? ' done' : '') + ' p' + level + '">' +
      '<input type="checkbox" data-action="toggle" data-item="' + esc(item.id) + '"' + (done ? ' checked' : '') + ' aria-label="Виконано">' +
      '<select class="prio" data-action="prio" data-item="' + esc(item.id) + '" title="Пріоритет">' + opts + '</select>' +
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
      '<button class="link" data-action="sort" data-cl="' + esc(cl.id) + '" title="Впорядкувати пункти: P1 → P2 → P3 → без пріоритету">↕ За пріоритетом</button>' +
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
      '<label class="toggle"><input type="checkbox" data-action="mine"' + (ui.mine ? ' checked' : '') + '> Лише мої</label>' +
      '<label class="toggle"><input type="checkbox" data-action="hideDone"' + (ui.hideDone ? ' checked' : '') + '> Сховати виконані</label>' +
      (openP1 ? '<span class="pill p1">🔴 відкритих P1: ' + openP1 + '</span>' : '') +
      '<span class="spacer"></span>' +
      '<button class="icon" data-action="refresh" title="Оновити">⟳</button>' +
      '<button class="icon" data-action="settings" title="Налаштування">⚙</button></div>';
    if (ui.error) html += '<div class="error">' + esc(ui.error) + '</div>';
    if (!d.cfg.todoListId) {
      html += '<div class="notice">Оберіть список, куди класти задачі «в TODO». ' +
        '<button class="link" data-action="settings">Відкрити налаштування</button></div>';
    }
    var body = d.checklists.map(checklistHtml).join('');
    html += body || '<div class="muted">Немає задач за цим фільтром.</div>';
    root.innerHTML = html;
    resize();
  }

  function renderAuth() {
    root.innerHTML = '<div class="auth"><p>Щоб керувати пріоритетами й додавати задачі в TODO, ' +
      'підключіть Epic Tasks до свого акаунта Trello. Це потрібно зробити <b>один раз</b>.</p>' +
      '<button class="mod-primary" data-action="auth">Підключити</button></div>';
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
      t.popup({ title: 'Epic Tasks — налаштування', url: './settings.html', height: 470, mouseEvent: e });
    } else if (a === 'open') {
      t.showCard(el.getAttribute('data-card'));
    } else if (a === 'todo') {
      var key = el.getAttribute('data-item') + ':' + el.getAttribute('data-member');
      if (ui.busy[key]) return;
      ui.busy[key] = 1; render();
      run(addToTodo(el.getAttribute('data-item'), el.getAttribute('data-member')))
        .then(function () { delete ui.busy[key]; render(); });
    } else if (a === 'sort') {
      el.disabled = true; el.textContent = 'Сортую…';
      run(sortChecklist(el.getAttribute('data-cl')));
    }
  });

  root.addEventListener('change', function (e) {
    var el = e.target;
    var a = el.getAttribute('data-action');
    if (a === 'prio') {
      el.disabled = true;
      run(setPriority(el.getAttribute('data-item'), Number(el.value)));
    } else if (a === 'toggle') {
      el.disabled = true;
      run(toggleItem(el.getAttribute('data-item'), el.checked));
    } else if (a === 'mine') {
      ui.mine = el.checked; render();
    } else if (a === 'hideDone') {
      ui.hideDone = el.checked; render();
    }
  });

  // Trello calls this on load and whenever pluginData/context changes.
  t.render(function () { return refresh(); });
})();
