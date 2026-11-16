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

  // Keeps epic items in step with their TO DO cards: ticks an item when all its cards are in Done
  // and unticks it again when one of those cards is moved out of Done (see Core.planItemSync).
  function syncItems(d) {
    if (d.cfg.autoComplete === false) return Promise.resolve();
    var items = [];
    d.checklists.forEach(function (cl) {
      cl.checkItems.forEach(function (it) {
        var people = Core.allAssignees(it, d.board.members, d.alive)
          .filter(function (a) { return !a.unknown; })
          .map(function (a) {
            var c = Todo.linkedCard(d, it.id, a.id);
            return { done: c ? Core.isCardDone(c, d.cfg.doneListIds) : null };
          });
        items.push({ id: it.id, state: it.state, people: people });
      });
    });
    var plan = Core.planItemSync(items, d.doneItems);
    var jobs = [];
    function setState(id, state) {
      var f = Todo.findItem(d, id);
      if (f) f.item.state = state;
      jobs.push(api('PUT', '/cards/' + d.card.id + '/checkItem/' + id, { state: state }));
    }
    plan.tick.forEach(function (id) { setState(id, 'complete'); });
    plan.untick.forEach(function (id) { setState(id, 'incomplete'); });
    var changed = plan.tracked.slice().sort().join() !== (d.doneItems || []).slice().sort().join();
    return Promise.all(jobs).then(function () {
      if (changed) return t.set('card', 'shared', 'doneItems', plan.tracked);
    });
  }

  // ------------------------------------------------------------------ actions

  function setPriority(itemId, level) {
    var f = Todo.findItem(data, itemId);
    if (!f) return Promise.resolve();
    var newName = Core.withPriority(f.item.name, level);
    return api('PUT', '/cards/' + data.card.id + '/checkItem/' + itemId, { name: newName }).then(function () {
      f.item.name = newName;
      return syncLinkedPriority(f.item, Number(level));
    });
  }

  // Keep the emoji in already-created (not yet done) TO DO cards in sync with the item.
  function syncLinkedPriority(item, level) {
    var people = Core.allAssignees(item, data.board.members, data.alive).filter(function (a) { return !a.unknown; });
    var cards = people.map(function (a) { return linkedCard(item.id, a.id); })
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
      'connect Epic Tasks to your Trello account. You only need to do this <b>once</b>.</p>' +
      '<button class="mod-primary" data-action="auth">Connect</button></div>';
    resize();
  }

  function refresh() {
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
      t.popup({ title: 'Epic Tasks — settings', url: './settings.html', height: 420, mouseEvent: e });
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
