/* global TrelloPowerUp, EpicAuth, EpicPoints, EpicCore, EpicDropdown */
// "STORY POINTS" section on the back of a card with a checklist (a TO DO card, or a person's checklist card):
// for every item a points drop-down and a status drop-down (TO DO / IN PROGRESS / DONE). The card's "Story points" field is the sum of its open items, kept up to
// date here (on every change Trello reports for the card) and by the connector's card badges (client.js).
// The points live in Teamload data "pts" on the card: { last 8 characters of the item id: n }; the items that are
// IN PROGRESS in "st": { last 8 characters of the item id: 1 }.
(function () {
  'use strict';
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var P = EpicPoints;
  var Core = EpicCore;
  var root = document.getElementById('root');
  var VALUES = [0.5, 1, 2, 3, 5, 8, 13, 21];
  var data = null;
  var ui = { authed: true, error: null };
  var queue = Promise.resolve();
  var tried = {};  // items whose "[n]" was already moved in this session: never retried in a loop

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function byPos(a, b) { return (a.pos || 0) - (b.pos || 0); }

  function checklistsOf(cardId) {
    return EpicAuth.request(t, 'GET', '/cards/' + cardId + '/checklists', {
      checkItems: 'all', checkItem_fields: 'name,state,pos', fields: 'name,pos',
    });
  }

  function resize() { return Promise.resolve(t.sizeTo(document.body)).catch(function () {}); }

  function load() {
    return Promise.all([
      t.card('id', 'name', 'checklists', 'customFieldItems', 'idList'),
      t.lists('id', 'name'),
      t.get('board', 'shared', 'cfg', {}),
      t.board('customFields'),
      t.get('card', 'shared', 'pts', {}),
      EpicAuth.isAuthorized(t),
      t.get('card', 'shared', 'st', {}),
    ]).then(function (r) {
      var lists = r.splice(1, 1)[0] || [];
      r.lists = lists;
      r.st = r.splice(5, 1)[0] || {};
      // The checklists come from Trello's REST API: t.card('checklists') returns none on a real board.
      if (!r[4]) return r;
      return checklistsOf(r[0].id).then(function (lists) { r[0].checklists = lists; return r; }, function () { return r; });
    }).then(function (r) {
      var card = r[0] || {}, cfg = r[1] || {};
      (card.checklists || []).sort(byPos);
      (card.checklists || []).forEach(function (cl) { (cl.checkItems || []).sort(byPos); });
      data = { card: card, cfg: cfg, field: P.findField((r[2] || {}).customFields, cfg), pts: r[3] || {}, lists: r.lists || [], st: r.st || {} };
      ui.authed = !!r[4];
      render();
      return ui.authed ? tidy() : null;
    }).catch(function (e) {
      ui.error = (e && e.message) || String(e);
      render();
    });
  }

  // With "move [n] from titles" on, "[3]" typed into an item moves into the data. Then the card's field
  // gets the sum of its open items, if it differs (an item was ticked, added or removed).
  function tidy() {
    var d = data;
    var moves = [], changes = {};
    // The card was moved to a Done list: all its items are done.
    var done = d.cfg.doneListIds || [];
    var open = done.indexOf(d.card.idList) !== -1 && d.cfg.autoComplete !== false
      ? P.allItems(d.card).filter(function (it) { return it.state !== 'complete'; }) : [];
    if (d.cfg.sp && d.cfg.sp.migrate) {
      P.allItems(d.card).forEach(function (it) {
        var v = P.parse(it.name), name = P.strip(it.name), k = P.itemKey(it.id);
        if (v == null || !name || tried[it.id]) return;
        tried[it.id] = true;
        if (d.pts[k] !== v) changes[k] = d.pts[k] = v;
        it.name = name;
        moves.push(it);
      });
    }
    return enqueue(function () {
      // The value goes into the data first, so nothing is lost if renaming the item fails.
      var first = Object.keys(changes).length ? savePts(changes) : Promise.resolve();
      return first.then(function () {
        return Promise.all(moves.map(function (it) {
          return EpicAuth.request(t, 'PUT', '/cards/' + d.card.id + '/checkItem/' + it.id, { name: it.name });
        }).concat(open.map(function (it) {
          return EpicAuth.request(t, 'PUT', '/cards/' + d.card.id + '/checkItem/' + it.id, { state: 'complete' }).then(function () { it.state = 'complete'; });
        })));
      }).then(function () {
        return open.length ? saveSt({}) : null;
      }).then(function () { return syncField(); }).then(function () { if (open.length) render(); });
    });
  }

  function enqueue(fn) {
    queue = queue.then(fn).catch(function (e) {
      if (e && e.isAuthError) ui.authed = false;
      ui.error = (e && e.message) || String(e);
      render();
    });
    return queue;
  }

  // changes = { itemKey: n, or null to clear }. Re-read right before writing: someone else may be
  // estimating another item of this card at the same time.
  function savePts(changes) {
    return Promise.resolve(t.get('card', 'shared', 'pts', {})).then(function (pts) {
      pts = pts || {};
      Object.keys(changes).forEach(function (k) { if (changes[k] == null) delete pts[k]; else pts[k] = changes[k]; });
      data.pts = P.prunePoints(pts, data.card);
      return t.set('card', 'shared', 'pts', data.pts);
    });
  }

  function syncField() {
    var d = data;
    if (!d.field) return Promise.resolve();
    var v = P.checklistField(d.card, d.pts);
    if (v === undefined || v === P.fieldValue(d.card, d.field.id)) return Promise.resolve();
    return P.setValue(t, d.card.id, d.field.id, v).then(function () {
      d.card.customFieldItems = (d.card.customFieldItems || []).filter(function (x) { return x.idCustomField !== d.field.id; });
      if (v != null) d.card.customFieldItems.push({ idCustomField: d.field.id, value: { number: String(v) } });
    });
  }

  // A click on a value sets it; a click on the value already set clears it.
  function setPoints(itemId, v, keep) {
    var k = P.itemKey(itemId);
    var cur = P.itemPoints({ id: itemId, name: '' }, data.pts);
    if (keep && cur === v) return Promise.resolve();
    var change = {};
    change[k] = cur === v ? null : v;
    if (cur === v) delete data.pts[k]; else data.pts[k] = v;
    var it = P.allItems(data.card).filter(function (x) { return x.id === itemId; })[0];
    var clean = it ? P.strip(it.name) : '';
    var rename = it && clean && clean !== it.name;  // "[3]" left in the text would count instead of the data
    if (rename) it.name = clean;
    ui.error = null;
    render();
    return enqueue(function () {
      return savePts(change).then(function () {
        return rename ? EpicAuth.request(t, 'PUT', '/cards/' + data.card.id + '/checkItem/' + itemId, { name: clean }) : null;
      }).then(syncField).then(render);
    });
  }

  // ---- status of an item in this card (TO DO / IN PROGRESS / DONE): every item has its own ----
  function progressListId() { return Core.progressListId(data.lists, data.cfg); }
  function listName(id, fallback) {
    var l = (data.lists || []).filter(function (x) { return x.id === id; })[0];
    return l ? l.name : fallback;
  }
  function statusOf(it) {
    return Core.itemStatus(data.card.idList, it, !!(data.st || {})[P.itemKey(it.id)], data.cfg.doneListIds);
  }
  // The TO DO column for this card: the one it is in, else the newest sprint's (or the TO DO list from settings).
  function todoId() {
    if (Core.isTodoList(data.lists, data.cfg, data.card.idList)) return data.card.idList;
    var cols = Core.todoColumns(data.lists, data.cfg);
    return cols.length ? cols[cols.length - 1].id : data.cfg.todoListId;
  }
  function statusLabel(st) {
    if (st === 'done') return 'DONE';
    if (st === 'prog') return String(listName(progressListId(), 'IN PROGRESS')).toUpperCase();
    return String(listName(todoId(), 'TO DO')).toUpperCase();
  }
  function moveCard(listId) {
    if (!listId || data.card.idList === listId) return Promise.resolve();
    return EpicAuth.request(t, 'PUT', '/cards/' + data.card.id, { idList: listId, pos: 'top' }).then(function () { data.card.idList = listId; });
  }
  function saveSt(st) {
    var a = Object.keys(data.st || {}).sort().join(), b = Object.keys(st).sort().join();
    data.st = st;
    return a === b ? Promise.resolve() : Promise.resolve(t.set('card', 'shared', 'st', st));
  }
  // The other items keep their status (Core.statusPlan): IN PROGRESS moves the card out of TO DO (or back from
  // Done), DONE ticks the item and the card goes to Done when every item is done.
  function setStatus(itemId, st) {
    var all = P.allItems(data.card);
    if (!all.some(function (x) { return x.id === itemId; })) return Promise.resolve();
    ui.error = null;
    return enqueue(function () {
      var plan = Core.statusPlan({
        listId: data.card.idList, itemId: itemId, status: st, todoListId: todoId(),
        progListId: progressListId(), doneListIds: data.cfg.doneListIds,
        items: all.map(function (x) { return { id: x.id, state: x.state, prog: !!(data.st || {})[P.itemKey(x.id)] }; }),
      });
      var next = {};
      var reqs = plan.items.map(function (p) {
        if (p.prog) next[P.itemKey(p.id)] = 1;
        var x = all.filter(function (y) { return y.id === p.id; })[0];
        if (!x || x.state === p.state) return null;
        return EpicAuth.request(t, 'PUT', '/cards/' + data.card.id + '/checkItem/' + x.id, { state: p.state }).then(function () { x.state = p.state; });
      });
      return Promise.all(reqs).then(function () { return saveSt(next); })
        .then(function () { return moveCard(plan.moveTo); }).then(syncField).then(render);
    });
  }

  // Drop-down lists like Trello's, drawn here so they always open down (js/dropdown.js).
  function pointsMenu(btn, itemId) {
    var cur = P.itemPoints({ id: itemId, name: '' }, data.pts);
    var items = VALUES.map(function (x) {
      return { text: P.fmt(x), checked: cur === x, onPick: function () { setPoints(itemId, x, true); } };
    }).concat([{ text: 'No estimate', checked: cur == null, onPick: function () { if (cur != null) setPoints(itemId, cur); } }]);
    return EpicDropdown.open(btn, { title: 'Story points', items: items, resize: resize });
  }
  function statusMenu(btn, itemId) {
    var it = P.allItems(data.card).filter(function (x) { return x.id === itemId; })[0];
    if (!it) return null;
    var cur = statusOf(it), prog = progressListId();
    var opts = [['todo', statusLabel('todo')]].concat(prog ? [['prog', statusLabel('prog')]] : []).concat([['done', 'DONE']]);
    return EpicDropdown.open(btn, { title: 'Status', resize: resize, items: opts.map(function (o) {
      return { text: o[1], checked: cur === o[0], onPick: function () { if (cur !== o[0]) setStatus(itemId, o[0]); } };
    }) });
  }

  function render() {
    if (!data) {
      root.innerHTML = ui.error ? '<div class="error">' + esc(ui.error) + '</div>' : '<div class="muted">Loading…</div>';
      return resize();
    }
    var d = data;
    EpicDropdown.close();
    if (!d.field) {
      root.innerHTML = '<p class="msg">The “' + esc(P.FIELD_NAME) + '” field isn’t on this board yet. Create it in Teamload settings.</p>';
      return resize();
    }
    var sum = P.checklistField(d.card, d.pts);
    var own = P.fieldValue(d.card, d.field.id);
    // The sum is shown next to the section's title (Trello's own header, see client.js); here only a hint
    // while nothing is estimated yet.
    var head = sum !== undefined ? ''
      : own != null
        ? '<span class="cp-note">This card has <b>' + P.fmt(own) + '</b> points as a whole. Estimate its items and their sum replaces it.</span>'
        : '<span class="cp-note">Estimate each item: the card’s points are the sum of its open items.</span>';
    var lists = d.card.checklists || [];
    var body = lists.map(function (cl) {
      var items = (cl.checkItems || []).map(function (it) {
        var v = P.itemPoints(it, d.pts);
        var st = statusOf(it);
        var dis = ui.authed ? '' : ' disabled';
        // Name, then points and status on the right; the status buttons get one width (see alignStatus) so the
        // points stand in one column whatever the status says.
        return '<li class="cp-item' + (st === 'done' ? ' done' : '') + '">' +
          '<span class="cp-name">' + esc(it.name) + '</span>' +
          '<button type="button" class="tsel cp-sp' + (v == null ? ' none' : '') + '" data-action="sp" data-item="' + esc(it.id) + '"' + dis +
            ' title="Story points">⚡ ' + (v == null ? '?' : P.fmt(v)) + ' <span class="cv">▾</span></button>' +
          '<button type="button" class="tsel cp-st st-' + st + '" data-action="st" data-item="' + esc(it.id) + '"' + dis + ' title="Status">' +
            '<span>' + esc(statusLabel(st)) + '</span> <span class="cv">▾</span></button></li>';
      }).join('');
      return (lists.length > 1 ? '<div class="cp-cl">' + esc(cl.name) + '</div>' : '') + '<ul class="cp-list">' + items + '</ul>';
    }).join('');
    var all = P.allItems(d.card), ticked = all.filter(function (it) { return it.state === 'complete'; }).length;
    var warn = Core.leftDoneTicked({ listId: d.card.idList, lists: d.lists, cfg: d.cfg, total: all.length, checked: ticked })
      ? '<div class="warn-left" role="status"><span class="warn-i">⚠</span><div><b>This card was moved out of Done, but ' +
        (all.length === 1 ? 'its task is' : 'all ' + all.length + ' tasks are') + ' still marked DONE.</b><br>' +
        'Change the status of the tasks that are still in progress, or move the card back to Done.</div></div>'
      : '';
    root.innerHTML =
      (ui.authed ? '' : '<div class="notice">Connect Teamload to set points. <button class="link" data-action="auth">Connect</button></div>') +
      (ui.error ? '<div class="error">' + esc(ui.error) + '</div>' : '') + warn +
      (head ? '<div class="cp-head">' + head + '</div>' : '') + body;
    alignStatus();
    return resize();
  }

  // Every status button as wide as the widest one ("IN PROGRESS" vs "TO DO SP48" vs "DONE").
  function alignStatus() {
    var bs = root.querySelectorAll('.cp-st'), w = 0, i;
    for (i = 0; i < bs.length; i++) { bs[i].style.width = ''; w = Math.max(w, bs[i].getBoundingClientRect().width); }
    for (i = 0; i < bs.length; i++) bs[i].style.width = Math.ceil(w) + 'px';
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !data) return;
    if (b.getAttribute('data-action') === 'auth') {
      Promise.resolve(EpicAuth.authorize(t)).then(load).catch(function () {});
      return;
    }
    if (b.getAttribute('data-action') === 'sp') pointsMenu(b, b.getAttribute('data-item'));
    else if (b.getAttribute('data-action') === 'st') statusMenu(b, b.getAttribute('data-item'));
  });

  // Trello calls this on load and whenever the card or its Power-Up data changes (an item ticked, for example).
  t.render(load);
})();
