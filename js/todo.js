/* global EpicCore, EpicAuth */
// Shared "TO DO cards" logic: loading the epic, link validity, creating cards.
// Used by the card-back section (section.js) and by the "Add all to TO DO" header button (client.js).
(function (root) {
  'use strict';
  var Core = root.EpicCore;

  function api(t, method, path, params) { return root.EpicAuth.request(t, method, path, params); }

  // GET /batch for up to 10 routes per request; commas inside a route must be encoded.
  // Resolves with the responses in the same order (null for failed ones).
  function batch(t, routes) {
    var out = [];
    var chunks = [];
    for (var i = 0; i < routes.length; i += 10) chunks.push(i);
    return Promise.all(chunks.map(function (start) {
      var part = routes.slice(start, start + 10);
      return api(t, 'GET', '/batch', { urls: part.join(',') }).then(function (res) {
        part.forEach(function (r, j) { var x = res && res[j]; out[start + j] = (x && x['200']) || null; });
      });
    })).then(function () { return out; });
  }

  function q(params) {
    return '?' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  }

  // Linked TO DO cards, only the fields the Power-Up needs (≈10× less data than full cards).
  function fetchCards(t, shortLinks) {
    var routes = shortLinks.map(function (s) { return '/cards/' + s + q({ fields: 'name,idList,closed,idMembers' }); });
    return batch(t, routes).then(function (res) {
      var out = {};
      shortLinks.forEach(function (s, i) { out[s] = res[i]; });
      return out;
    });
  }

  // List moves of several cards in one request: [[actions of card 1], [actions of card 2], …].
  function moveHistory(t, cardIds) {
    return batch(t, cardIds.map(function (id) {
      return '/cards/' + id + '/actions' + q({ filter: 'updateCard:idList', limit: 50, fields: 'date,data' });
    })).then(function (res) { return res.map(function (r) { return r || []; }); });
  }

  // Everything needed to render the section or add cards: the epic, its checklists,
  // board members and lists, settings, item → card links and the linked cards themselves.
  function load(t) {
    return Promise.all([
      t.card('id', 'name', 'url', 'shortLink'),
      t.board('id', 'members'),
      t.member('id', 'username', 'fullName'),
      t.lists('id', 'name'),
      t.get('board', 'shared', 'cfg', {}),
      t.get('card', 'shared', 'links', {}),
    ]).then(function (r) {
      var cfg = r[4] || {};
      // The TO DO list never counts as done, even if it was ticked under "Done lists" in older settings.
      cfg.doneListIds = (cfg.doneListIds || []).filter(function (id) { return id !== cfg.todoListId; });
      var d = { card: r[0], board: r[1], me: r[2], lists: r[3], cfg: cfg, links: r[5] || {} };
      d.listName = {};
      d.lists.forEach(function (l) { d.listName[l.id] = l.name; });
      var shortLinks = Object.keys(d.links).map(function (k) { return d.links[k]; })
        .filter(function (v, i, a) { return v && a.indexOf(v) === i; });
      // Both requests at once: the links are already known from the Power-Up data.
      return Promise.all([
        api(t, 'GET', '/cards/' + d.card.id + '/checklists', {
          checkItems: 'all',
          checkItem_fields: 'name,state,pos,due,idMember',
          fields: 'name,pos',
        }),
        fetchCards(t, shortLinks),
      ]).then(function (res) {
        var checklists = res[0];
        checklists.sort(Core.byPos);
        checklists.forEach(function (cl) { cl.checkItems.sort(Core.byPos); });
        d.checklists = checklists;
        d.linked = res[1];
        d.alive = aliveLinks(d);
        return d;
      });
    });
  }

  // A link counts only while its card exists, isn't cancelled (archived outside Done) and the
  // person is still a member of the card. Otherwise the item is "＋ TO DO" for them again.
  function linkedCard(d, itemId, memberId) {
    var sl = d.links[Core.linkKey(itemId, memberId)];
    var c = sl ? d.linked[sl] || null : null;
    return Core.isLinkAlive(c, memberId, d.cfg.doneListIds) ? c : null;
  }

  // Links that are still alive. "Assign to me" takers are derived from these, so someone who
  // removed themselves from the card is no longer shown on the item.
  function aliveLinks(d) {
    var out = {};
    d.checklists.forEach(function (cl) {
      cl.checkItems.forEach(function (it) {
        (d.board.members || []).forEach(function (m) {
          var k = Core.linkKey(it.id, m.id);
          if (d.links[k] && linkedCard(d, it.id, m.id)) out[k] = d.links[k];
        });
      });
    });
    return out;
  }

  function findItem(d, itemId) {
    for (var i = 0; i < d.checklists.length; i++) {
      var cl = d.checklists[i];
      for (var j = 0; j < cl.checkItems.length; j++) {
        if (cl.checkItems[j].id === itemId) return { item: cl.checkItems[j], checklist: cl };
      }
    }
    return null;
  }

  // Open items × board-member assignees of one checklist that don't have a TO DO card yet.
  function pendingInChecklist(d, cl) {
    var out = [];
    cl.checkItems.forEach(function (it) {
      if (it.state === 'complete') return;
      Core.allAssignees(it, d.board.members, d.alive).forEach(function (a) {
        if (!a.unknown && !linkedCard(d, it.id, a.id)) out.push({ item: it, checklist: cl, memberId: a.id });
      });
    });
    return out;
  }

  function todoListError(d) {
    return d.cfg.todoListId ? null : new Error('Choose the TO DO list in settings (⚙) first.');
  }

  function saveLinks(t, d, newLinks) {
    if (!Object.keys(newLinks).length) return Promise.resolve();
    // Re-read right before writing to reduce clobbering when two people click at once.
    return t.get('card', 'shared', 'links', {}).then(function (links) {
      Object.keys(newLinks).forEach(function (k) { links[k] = newLinks[k]; });
      var ids = [];
      d.checklists.forEach(function (cl) { cl.checkItems.forEach(function (it) { ids.push(it.id); }); });
      return t.set('card', 'shared', 'links', Core.pruneLinks(links, ids));
    });
  }

  // Creates one TO DO card for (item, member); resolves with its shortLink.
  // The link to the epic is attached in the same request (urlSource); a separate call is only a fallback.
  function createTodoCard(t, d, item, checklist, memberId, pos) {
    return api(t, 'POST', '/cards', {
      idList: d.cfg.todoListId,
      name: Core.todoCardName(item.name, checklist.name),
      desc: Core.todoCardDesc(d.card, checklist.name),
      idMembers: memberId,
      due: item.due || undefined,
      pos: pos != null ? pos : (d.cfg.position === 'bottom' ? 'bottom' : 'top'),
      urlSource: d.card.url,
    }).then(function (created) {
      if (created.badges && created.badges.attachments > 0) return created.shortLink;
      return api(t, 'POST', '/cards/' + created.id + '/attachments', { url: d.card.url, name: d.card.name })
        .catch(function () { /* link back is nice-to-have */ })
        .then(function () { return created.shortLink; });
    });
  }

  // Positions for n new cards that keep the checklist order in the TO DO list even when the cards
  // are created in parallel. Resolves with null if the list can't be read (then cards go one by one).
  function positionsFor(t, d, n) {
    return api(t, 'GET', '/lists/' + d.cfg.todoListId + '/cards', { fields: 'pos' }).then(function (cards) {
      var ps = (cards || []).map(function (c) { return Number(c.pos); }).filter(function (p) { return p > 0; });
      var out = [];
      for (var i = 0; i < n; i++) {
        if (d.cfg.position === 'bottom') out.push((ps.length ? Math.max.apply(null, ps) : 0) + 65536 * (i + 1));
        else out.push((ps.length ? Math.min.apply(null, ps) : 65536 * (n + 1)) * (i + 1) / (n + 1));
      }
      return out;
    }, function () { return null; });
  }

  function addToTodo(t, d, itemId, memberId) {
    var f = findItem(d, itemId);
    if (!f) return Promise.reject(new Error('Item not found. Refresh the block (⟳).'));
    var err = todoListError(d);
    if (err) return Promise.reject(err);
    return createTodoCard(t, d, f.item, f.checklist, memberId).then(function (shortLink) {
      var nl = {};
      nl[Core.linkKey(itemId, memberId)] = shortLink;
      return saveLinks(t, d, nl);
    });
  }

  // Menu entries for "Add all to TO DO": one per checklist that has something to add, plus
  // "All tasks" when more than one does. [{ key: 'all' | checklistId, text, jobs }]
  function addAllOptions(d) {
    var groups = d.checklists
      .map(function (cl) { return { key: cl.id, text: cl.name, jobs: pendingInChecklist(d, cl) }; })
      .filter(function (g) { return g.jobs.length; });
    if (groups.length > 1) {
      var all = [];
      groups.forEach(function (g) { all = all.concat(g.jobs); });
      groups.unshift({ key: 'all', text: 'All tasks', jobs: all });
    }
    return groups;
  }

  // Jobs for a menu choice, recomputed from fresh data ("all" also works when only one checklist is left).
  function jobsFor(d, key) {
    var opts = addAllOptions(d);
    var hit = opts.filter(function (o) { return o.key === key; })[0];
    if (!hit && key === 'all' && opts.length === 1) hit = opts[0];
    return hit ? hit.jobs : [];
  }

  // Creates cards for a list of jobs from pendingInChecklist(); resolves with the number created.
  // Up to 3 cards are created at a time; onProgress(done, total) is called after every card.
  function addMany(t, d, jobs, onProgress) {
    var err = todoListError(d);
    if (err) return Promise.reject(err);
    if (!jobs.length) return Promise.resolve(0);
    var unsaved = {};
    var saving = Promise.resolve();
    var n = 0;
    // Link saves run one after another, so parallel cards don't overwrite each other's links.
    function flush() {
      var nl = unsaved;
      unsaved = {};
      saving = saving.then(function () { return saveLinks(t, d, nl); });
      return saving;
    }
    return positionsFor(t, d, jobs.length).then(function (pos) {
      var list = jobs.slice();
      var width = 3;
      if (!pos) {
        // No positions: one by one; with "top" placement in reverse to keep the checklist order.
        width = 1;
        if (d.cfg.position !== 'bottom') list.reverse();
      }
      var next = 0;
      var failed = null;
      function worker() {
        if (failed || next >= list.length) return Promise.resolve();
        var i = next++;
        var j = list[i];
        return createTodoCard(t, d, j.item, j.checklist, j.memberId, pos ? pos[i] : null).then(function (shortLink) {
          unsaved[Core.linkKey(j.item.id, j.memberId)] = shortLink;
          n++;
          if (onProgress) onProgress(n, list.length);
          // Save links in small batches, so nothing is lost if the board is closed half-way.
          if (n % 5 === 0) flush();
          return worker();
        }, function (e) { failed = failed || e; });
      }
      var workers = [];
      for (var w = 0; w < Math.min(width, list.length); w++) workers.push(worker());
      return Promise.all(workers).then(function () {
        return flush().then(function () {
          if (failed) throw failed;
          return n;
        });
      });
    });
  }

  root.EpicTodo = {
    api: api,
    batch: batch,
    moveHistory: moveHistory,
    load: load,
    linkedCard: linkedCard,
    findItem: findItem,
    pendingInChecklist: pendingInChecklist,
    todoListError: todoListError,
    addToTodo: addToTodo,
    addMany: addMany,
    addAllOptions: addAllOptions,
    jobsFor: jobsFor,
  };
})(this);
