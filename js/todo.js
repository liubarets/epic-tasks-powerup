/* global EpicCore, EpicAuth */
// Shared "TO DO cards" logic: loading the epic, link validity, creating cards.
// Used by the card-back section (section.js) and by the "Add all to TO DO" header button (client.js).
(function (root) {
  'use strict';
  var Core = root.EpicCore;

  function api(t, method, path, params) { return root.EpicAuth.request(t, method, path, params); }

  function fetchCards(t, shortLinks) {
    var out = {};
    var chunks = [];
    for (var i = 0; i < shortLinks.length; i += 10) chunks.push(shortLinks.slice(i, i + 10));
    return Promise.all(chunks.map(function (chunk) {
      var urls = chunk.map(function (s) { return '/cards/' + s; }).join(',');
      return api(t, 'GET', '/batch', { urls: urls }).then(function (res) {
        (res || []).forEach(function (r, j) { out[chunk[j]] = (r && r['200']) || null; });
      });
    })).then(function () { return out; });
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
      var d = { card: r[0], board: r[1], me: r[2], lists: r[3], cfg: r[4] || {}, links: r[5] || {} };
      d.listName = {};
      d.lists.forEach(function (l) { d.listName[l.id] = l.name; });
      return api(t, 'GET', '/cards/' + d.card.id + '/checklists', {
        checkItems: 'all',
        checkItem_fields: 'name,state,pos,due,idMember',
        fields: 'name,pos',
      }).then(function (checklists) {
        checklists.sort(Core.byPos);
        checklists.forEach(function (cl) { cl.checkItems.sort(Core.byPos); });
        d.checklists = checklists;
        var shortLinks = Object.keys(d.links).map(function (k) { return d.links[k]; })
          .filter(function (v, i, a) { return v && a.indexOf(v) === i; });
        return fetchCards(t, shortLinks).then(function (cards) {
          d.linked = cards;
          d.alive = aliveLinks(d);
          return d;
        });
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
  function createTodoCard(t, d, item, checklist, memberId) {
    return api(t, 'POST', '/cards', {
      idList: d.cfg.todoListId,
      name: Core.todoCardName(item.name, checklist.name),
      desc: Core.todoCardDesc(d.card, checklist.name),
      idMembers: memberId,
      due: item.due || undefined,
      pos: d.cfg.position === 'bottom' ? 'bottom' : 'top',
    }).then(function (created) {
      return api(t, 'POST', '/cards/' + created.id + '/attachments', { url: d.card.url, name: d.card.name })
        .catch(function () { /* link back is nice-to-have */ })
        .then(function () { return created.shortLink; });
    });
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

  // Creates cards for a list of jobs from pendingInChecklist(); resolves with the number created.
  function addMany(t, d, jobs) {
    var err = todoListError(d);
    if (err) return Promise.reject(err);
    jobs = jobs.slice();
    // With "top" placement each new card lands above the previous one,
    // so create in reverse to keep the checklist order in the TO DO list.
    if (d.cfg.position !== 'bottom') jobs.reverse();
    var newLinks = {};
    var n = 0;
    return jobs.reduce(function (p, j) {
      return p.then(function () {
        return createTodoCard(t, d, j.item, j.checklist, j.memberId).then(function (shortLink) {
          newLinks[Core.linkKey(j.item.id, j.memberId)] = shortLink;
          n++;
        });
      });
    }, Promise.resolve()).then(function () {
      return saveLinks(t, d, newLinks).then(function () { return n; });
    }, function (e) {
      // Keep links to the cards created before the failure.
      return saveLinks(t, d, newLinks).then(function () { throw e; });
    });
  }

  root.EpicTodo = {
    api: api,
    load: load,
    linkedCard: linkedCard,
    findItem: findItem,
    pendingInChecklist: pendingInChecklist,
    todoListError: todoListError,
    addToTodo: addToTodo,
    addMany: addMany,
  };
})(this);
